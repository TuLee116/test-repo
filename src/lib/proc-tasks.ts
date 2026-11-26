import { prisma } from "@/lib/prisma";
import { can, projectScope, selectedPriceOf, type ProcUser } from "@/lib/proc";

// Các dòng đề nghị đã duyệt còn khối lượng chưa lên đơn hàng (đơn huỷ không tính)
export async function pendingRequestItems(u: ProcUser, projectId?: string) {
  const items = await prisma.materialRequestItem.findMany({
    where: { request: { status: "APPROVED", ...projectScope(u), ...(projectId ? { projectId } : {}) } },
    include: { request: { include: { project: { select: { id: true, name: true, packageName: true } } } }, poItems: { include: { order: { select: { status: true } } } } },
    orderBy: [{ request: { code: "asc" } }, { orderIndex: "asc" }],
  });
  return items
    .map((it) => {
      const ordered = it.poItems.filter((p) => p.order.status !== "CANCELLED").reduce((s, p) => s + p.quantity, 0);
      return { ...it, ordered, remaining: it.quantity - ordered };
    })
    .filter((it) => it.remaining > 1e-9);
}

// Dòng hàng đã nhận chưa lên công nợ, kèm đơn giá đã chọn trong bảng so sánh
export async function unbilledReceiptLines(u: ProcUser, filter: { projectId?: string; supplierId?: string } = {}) {
  const lines = await prisma.goodsReceiptLine.findMany({
    where: {
      payableLine: null,
      receipt: { ...(filter.supplierId ? { supplierId: filter.supplierId } : {}), order: { ...projectScope(u), ...(filter.projectId ? { projectId: filter.projectId } : {}) } },
    },
    include: {
      receipt: { include: { supplier: { select: { id: true, name: true } } } },
      item: { include: { order: { include: { project: { select: { id: true, name: true, packageName: true } }, quotations: { include: { lines: true, supplier: true } } } } } },
    },
    orderBy: { receipt: { receivedDate: "asc" } },
  });
  return lines.map((l) => {
    const sp = selectedPriceOf(l.item, l.item.order.quotations);
    const unitPrice = sp?.unitPrice ?? 0;
    const vatRate = sp?.vatRate ?? 0;
    return { ...l, unitPrice, vatRate, amount: l.quantity * unitPrice * (1 + vatRate) };
  });
}

// Số việc đang chờ người dùng xử lý theo từng bước của quy trình
export async function getTaskCounts(u: ProcUser) {
  const scope = projectScope(u);
  const zero = Promise.resolve(0);
  const [reqToApprove, reqMine, toOrder, poDraft, poQuoting, poPending, poApproved, poOrdered, unbilled, paySent] = await Promise.all([
    can(u, "CHT") ? prisma.materialRequest.count({ where: { status: "SUBMITTED", ...scope } }) : zero,
    can(u, "GS", "CHT") ? prisma.materialRequest.count({ where: { status: { in: ["DRAFT", "REJECTED"] }, createdById: u.id } }) : zero,
    can(u, "CBVT") ? pendingRequestItems(u).then((x) => x.length) : zero,
    can(u, "CBVT") ? prisma.purchaseOrder.count({ where: { status: "DRAFT" } }) : zero,
    can(u, "KTVT") ? prisma.purchaseOrder.count({ where: { status: "QUOTING" } }) : zero,
    can(u, "PTGD") ? prisma.purchaseOrder.count({ where: { status: "PENDING" } }) : zero,
    can(u, "CBVT") ? prisma.purchaseOrder.count({ where: { status: "APPROVED" } }) : zero,
    can(u, "GS", "CHT", "CBVT") ? prisma.purchaseOrder.count({ where: { status: "ORDERED", ...scope } }) : zero,
    can(u, "CBVT") ? prisma.goodsReceiptLine.count({ where: { payableLine: null } }) : zero,
    can(u, "KT") ? prisma.payable.count({ where: { status: { in: ["SENT", "PARTIAL"] } } }) : zero,
  ]);
  return { reqToApprove, reqMine, toOrder, poDraft, poQuoting, poPending, poApproved, poOrdered, unbilled, paySent };
}
