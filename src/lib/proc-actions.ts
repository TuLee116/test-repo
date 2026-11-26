"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getMaterialBudget, getRequestDefaults, type BudgetRow } from "@/lib/proc-budget";
import { can, canSeeProject, getProcUser, logProc, nextCode, parseRoles, payableTotals, selectedPriceOf, type ProcRole, type ProcUser } from "@/lib/proc";

// Server action của phân hệ Mua vật tư. Luôn TRẢ VỀ {ok, error} thay vì throw (bản production giấu message lỗi).
export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

class ProcError extends Error {}
function fail(msg: string): never {
  throw new ProcError(msg);
}

async function run(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const id = await fn();
    revalidatePath("/mua-vat-tu", "layout");
    return id ? { ok: true, id } : { ok: true };
  } catch (e) {
    if (e instanceof ProcError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Lỗi hệ thống, thử lại hoặc báo quản trị." };
  }
}

async function need(...roles: ProcRole[]): Promise<ProcUser> {
  const u = await getProcUser();
  if (!u) fail("Chưa đăng nhập");
  if (roles.length && !can(u!, ...roles)) fail("Bạn không có quyền thực hiện thao tác này");
  return u!;
}

function needProject(u: ProcUser, projectId: string) {
  if (!canSeeProject(u, projectId)) fail("Bạn không thuộc Ban Chỉ Huy của dự án này");
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown) => String(v ?? "").trim();
const dateOrNull = (v: unknown) => (str(v) ? new Date(str(v)) : null);

// ---------------- Phân quyền ----------------
export async function setUserProcRolesAction(userId: string, roles: string[]) {
  return run(async () => {
    const u = await need();
    if (!u.isAdmin) fail("Chỉ quản trị được phân quyền");
    await prisma.user.update({ where: { id: userId }, data: { procRoles: [...parseRoles(roles.join(","))].join(",") } });
  });
}

export async function setProjectMembersAction(projectId: string, userIds: string[]) {
  return run(async () => {
    const u = await need();
    if (!u.isAdmin) fail("Chỉ quản trị được phân quyền");
    await prisma.$transaction([
      prisma.procMember.deleteMany({ where: { projectId } }),
      prisma.procMember.createMany({ data: [...new Set(userIds)].map((userId) => ({ projectId, userId })) }),
    ]);
  });
}

// ---------------- Nhà cung cấp ----------------
export type SupplierInput = { name: string; taxCode: string; address: string; contact: string; phone: string; email: string; bankAccount: string; bankName: string; note: string };

export async function saveSupplierAction(id: string | null, data: SupplierInput) {
  return run(async () => {
    await need("CBVT", "KTVT", "KT");
    const clean = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, str(v)])) as SupplierInput;
    if (!clean.name) fail("Chưa nhập tên nhà cung cấp");
    if (id) await prisma.supplier.update({ where: { id }, data: clean });
    else return (await prisma.supplier.create({ data: clean })).id;
  });
}

export async function deleteSupplierAction(id: string) {
  return run(async () => {
    await need("CBVT", "KTVT");
    const used = await prisma.quotation.count({ where: { supplierId: id } });
    if (used) fail("Nhà cung cấp đã có báo giá trong đơn hàng, không xoá được");
    await prisma.supplier.delete({ where: { id } });
  });
}

// ---------------- Đề nghị mua vật tư (BCH) ----------------
export type RequestItemInput = {
  resourceId: string | null;
  name: string;
  spec: string;
  unit: string;
  quantity: number;
  note: string;
  contractQty: number | null;
  finalQty: number | null;
  forecastQty: number | null;
};
export type RequestInput = { projectId: string; title: string; neededDate: string; note: string; contractNo: string; category: string; area: string; items: RequestItemInput[] };
const numOrNull = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export async function saveRequestAction(id: string | null, data: RequestInput) {
  return run(async () => {
    const u = await need("GS", "CHT");
    needProject(u, data.projectId);
    const items = data.items
      .map((it, i) => ({
        resourceId: it.resourceId || null,
        name: str(it.name),
        spec: str(it.spec),
        unit: str(it.unit),
        quantity: num(it.quantity),
        note: str(it.note),
        contractQty: numOrNull(it.contractQty),
        finalQty: numOrNull(it.finalQty),
        forecastQty: numOrNull(it.forecastQty),
        orderIndex: i,
      }))
      .filter((it) => it.name);
    if (!items.length) fail("Phiếu đề nghị chưa có vật tư nào");
    if (items.some((it) => !(it.quantity > 0))) fail("Có dòng vật tư chưa nhập khối lượng");
    const head = { title: str(data.title), neededDate: dateOrNull(data.neededDate), note: str(data.note), contractNo: str(data.contractNo), category: str(data.category), area: str(data.area) };
    if (id) {
      const cur = await prisma.materialRequest.findUnique({ where: { id } });
      if (!cur) fail("Không tìm thấy phiếu");
      if (cur!.status !== "DRAFT" && cur!.status !== "REJECTED") fail("Phiếu đã gửi duyệt, không sửa được");
      await prisma.$transaction([
        prisma.materialRequestItem.deleteMany({ where: { requestId: id } }),
        prisma.materialRequest.update({ where: { id }, data: { ...head, items: { create: items } } }),
      ]);
      await logProc("REQ", id, "Sửa phiếu", u.name);
      return id;
    }
    const req = await prisma.materialRequest.create({
      data: { ...head, code: await nextCode("YC"), projectId: data.projectId, createdById: u.id, createdByName: u.name, items: { create: items } },
    });
    await logProc("REQ", req.id, "Lập phiếu", u.name);
    return req.id;
  });
}

// Khối lượng vật tư theo BOQ của dự án vừa chọn trên phiếu đề nghị (không chuyển trang, giữ nguyên nội dung đang nhập)
export async function loadBudgetAction(
  projectId: string,
): Promise<{ ok: true; budget: BudgetRow[]; defaults: Awaited<ReturnType<typeof getRequestDefaults>> } | { ok: false; error: string }> {
  const u = await getProcUser();
  if (!u) return { ok: false, error: "Chưa đăng nhập" };
  if (!canSeeProject(u, projectId)) return { ok: false, error: "Bạn không thuộc Ban Chỉ Huy của dự án này" };
  const [budget, defaults] = await Promise.all([getMaterialBudget(projectId), getRequestDefaults(projectId)]);
  return { ok: true, budget, defaults };
}

export async function submitRequestAction(id: string) {
  return run(async () => {
    const u = await need("GS", "CHT");
    const r = await prisma.materialRequest.findUnique({ where: { id } });
    if (!r) fail("Không tìm thấy phiếu");
    needProject(u, r!.projectId);
    if (r!.status !== "DRAFT" && r!.status !== "REJECTED") fail("Phiếu đã gửi duyệt");
    await prisma.materialRequest.update({ where: { id }, data: { status: "SUBMITTED", submittedAt: new Date(), rejectReason: "" } });
    await logProc("REQ", id, "Trình CHT duyệt", u.name);
  });
}

export async function approveRequestAction(id: string) {
  return run(async () => {
    const u = await need("CHT");
    const r = await prisma.materialRequest.findUnique({ where: { id } });
    if (!r) fail("Không tìm thấy phiếu");
    needProject(u, r!.projectId);
    if (r!.status !== "SUBMITTED") fail("Phiếu không ở trạng thái chờ duyệt");
    await prisma.materialRequest.update({ where: { id }, data: { status: "APPROVED", approvedAt: new Date(), approvedByName: u.name } });
    await logProc("REQ", id, "CHT duyệt - chuyển cán bộ vật tư", u.name);
  });
}

export async function rejectRequestAction(id: string, reason = "") {
  return run(async () => {
    const u = await need("CHT");
    const r = await prisma.materialRequest.findUnique({ where: { id } });
    if (!r) fail("Không tìm thấy phiếu");
    needProject(u, r!.projectId);
    if (r!.status !== "SUBMITTED") fail("Phiếu không ở trạng thái chờ duyệt");
    if (!str(reason)) fail("Cần ghi lý do trả lại");
    await prisma.materialRequest.update({ where: { id }, data: { status: "REJECTED", rejectReason: str(reason) } });
    await logProc("REQ", id, "Trả lại", u.name, str(reason));
  });
}

export async function deleteRequestAction(id: string) {
  return run(async () => {
    const u = await need("GS", "CHT");
    const r = await prisma.materialRequest.findUnique({ where: { id } });
    if (!r) fail("Không tìm thấy phiếu");
    if (r!.status === "SUBMITTED" || r!.status === "APPROVED") fail("Phiếu đã gửi duyệt / đã duyệt, không xoá được");
    if (!u.isAdmin && r!.createdById !== u.id) fail("Chỉ người lập phiếu được xoá");
    await prisma.materialRequest.delete({ where: { id } });
  });
}

// ---------------- Đơn hàng (Cán bộ vật tư) ----------------
export async function createOrderAction(data: { projectId: string; title: string; deliveryPlace: string; note: string; items: { requestItemId: string; quantity: number }[] }) {
  return run(async () => {
    const u = await need("CBVT");
    const picked = data.items.filter((x) => num(x.quantity) > 0);
    if (!picked.length) fail("Chưa chọn dòng vật tư nào");
    const reqItems = await prisma.materialRequestItem.findMany({ where: { id: { in: picked.map((x) => x.requestItemId) } }, include: { request: true } });
    if (reqItems.some((r) => r.request.status !== "APPROVED" || r.request.projectId !== data.projectId)) fail("Có dòng không thuộc phiếu đã duyệt của dự án này");
    const byId = new Map(reqItems.map((r) => [r.id, r]));
    const po = await prisma.purchaseOrder.create({
      data: {
        code: await nextCode("DH"),
        projectId: data.projectId,
        title: str(data.title),
        deliveryPlace: str(data.deliveryPlace),
        note: str(data.note),
        createdById: u.id,
        createdByName: u.name,
        items: {
          create: picked.map((x, i) => {
            const r = byId.get(x.requestItemId)!;
            return { requestItemId: r.id, name: r.name, spec: r.spec, unit: r.unit, quantity: num(x.quantity), note: r.note, orderIndex: i };
          }),
        },
      },
    });
    await logProc("PO", po.id, "Lên đơn hàng", u.name, `${picked.length} dòng vật tư`);
    return po.id;
  });
}

export async function updateOrderAction(
  orderId: string,
  data: { title: string; deliveryPlace: string; note: string; items: { id: string; name: string; spec: string; unit: string; quantity: number; note: string }[] },
) {
  return run(async () => {
    const u = await need("CBVT", "KTVT");
    const po = await prisma.purchaseOrder.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!po) fail("Không tìm thấy đơn hàng");
    if (po!.status !== "DRAFT" && po!.status !== "QUOTING") fail("Đơn hàng đã trình duyệt, không sửa được");
    const keep = new Set(data.items.map((x) => x.id));
    const removed = po!.items.filter((x) => !keep.has(x.id));
    if (data.items.some((x) => !(num(x.quantity) > 0))) fail("Có dòng chưa nhập số lượng");
    await prisma.$transaction([
      prisma.purchaseOrder.update({ where: { id: orderId }, data: { title: str(data.title), deliveryPlace: str(data.deliveryPlace), note: str(data.note) } }),
      prisma.purchaseOrderItem.deleteMany({ where: { id: { in: removed.map((x) => x.id) } } }),
      ...data.items.map((x) => prisma.purchaseOrderItem.update({ where: { id: x.id }, data: { name: str(x.name), spec: str(x.spec), unit: str(x.unit), quantity: num(x.quantity), note: str(x.note) } })),
    ]);
    await logProc("PO", orderId, "Sửa đơn hàng", u.name);
  });
}

export async function sendToQuotingAction(orderId: string) {
  return run(async () => {
    const u = await need("CBVT");
    const po = await prisma.purchaseOrder.findUnique({ where: { id: orderId } });
    if (po?.status !== "DRAFT") fail("Đơn hàng không ở trạng thái đang lên đơn");
    await prisma.purchaseOrder.update({ where: { id: orderId }, data: { status: "QUOTING" } });
    await logProc("PO", orderId, "Chuyển kế toán vật tư lấy báo giá", u.name);
  });
}

async function quotingOrder(orderId: string) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: orderId } });
  if (!po) fail("Không tìm thấy đơn hàng");
  if (po!.status !== "QUOTING" && po!.status !== "DRAFT") fail("Đơn hàng đã trình duyệt, không sửa báo giá được");
  return po!;
}

export async function addQuotationAction(orderId: string, supplierId: string) {
  return run(async () => {
    const u = await need("KTVT");
    await quotingOrder(orderId);
    if (await prisma.quotation.findUnique({ where: { orderId_supplierId: { orderId, supplierId } } })) fail("Nhà cung cấp này đã có trong bảng so sánh");
    const q = await prisma.quotation.create({ data: { orderId, supplierId } });
    await logProc("PO", orderId, "Thêm báo giá NCC", u.name, (await prisma.supplier.findUnique({ where: { id: supplierId } }))?.name ?? "");
    return q.id;
  });
}

export type QuoteInput = { vatRate: number; deliveryTerms: string; paymentTerms: string; note: string; quoteDate: string; prices: Record<string, number> };

// Lưu cả bảng so sánh 1 lần: đơn giá/điều kiện từng NCC + NCC được chọn cho từng dòng
export async function saveComparisonAction(orderId: string, data: { quotes: (QuoteInput & { id: string })[]; selections: Record<string, string | null> }) {
  return run(async () => {
    const u = await need("KTVT");
    await quotingOrder(orderId);
    const own = new Set((await prisma.quotation.findMany({ where: { orderId }, select: { id: true } })).map((q) => q.id));
    const items = new Set((await prisma.purchaseOrderItem.findMany({ where: { orderId }, select: { id: true } })).map((i) => i.id));
    if (data.quotes.some((q) => !own.has(q.id))) fail("Báo giá không thuộc đơn hàng này");
    await prisma.$transaction([
      ...data.quotes.flatMap((q) => [
        prisma.quotation.update({
          where: { id: q.id },
          data: { vatRate: num(q.vatRate), deliveryTerms: str(q.deliveryTerms), paymentTerms: str(q.paymentTerms), note: str(q.note), ...(dateOrNull(q.quoteDate) ? { quoteDate: dateOrNull(q.quoteDate)! } : {}) },
        }),
        ...Object.entries(q.prices)
          .filter(([itemId]) => items.has(itemId))
          .map(([itemId, price]) =>
            prisma.quotationLine.upsert({
              where: { quotationId_itemId: { quotationId: q.id, itemId } },
              create: { quotationId: q.id, itemId, unitPrice: num(price) },
              update: { unitPrice: num(price) },
            }),
          ),
      ]),
      ...Object.entries(data.selections)
        .filter(([itemId, qid]) => items.has(itemId) && (qid === null || own.has(qid)))
        .map(([itemId, qid]) => prisma.purchaseOrderItem.update({ where: { id: itemId }, data: { selectedQuoteId: qid } })),
    ]);
    await logProc("PO", orderId, "Cập nhật bảng so sánh", u.name);
  });
}

export async function deleteQuotationAction(quoteId: string) {
  return run(async () => {
    const u = await need("KTVT");
    const q = await prisma.quotation.findUnique({ where: { id: quoteId }, include: { supplier: true } });
    if (!q) fail("Không tìm thấy báo giá");
    await quotingOrder(q!.orderId);
    await prisma.$transaction([
      prisma.purchaseOrderItem.updateMany({ where: { orderId: q!.orderId, selectedQuoteId: quoteId }, data: { selectedQuoteId: null } }),
      prisma.quotation.delete({ where: { id: quoteId } }),
    ]);
    await logProc("PO", q!.orderId, "Bỏ báo giá NCC", u.name, q!.supplier.name);
  });
}

export async function submitOrderAction(orderId: string) {
  return run(async () => {
    const u = await need("KTVT");
    const po = await prisma.purchaseOrder.findUnique({ where: { id: orderId }, include: { items: true, quotations: { include: { lines: true, supplier: true } } } });
    if (po?.status !== "QUOTING") fail("Đơn hàng không ở bước lấy báo giá");
    const missing = po!.items.filter((it) => !selectedPriceOf(it, po!.quotations));
    if (missing.length) fail(`Còn ${missing.length} dòng chưa chọn nhà cung cấp (hoặc NCC được chọn chưa có đơn giá): ${missing.map((m) => m.name).slice(0, 3).join(", ")}`);
    await prisma.purchaseOrder.update({ where: { id: orderId }, data: { status: "PENDING", submittedAt: new Date(), submittedByName: u.name } });
    await logProc("PO", orderId, "Trình PTGĐ duyệt bảng so sánh", u.name);
  });
}

export async function approveOrderAction(orderId: string, note = "") {
  return run(async () => {
    const u = await need("PTGD");
    const po = await prisma.purchaseOrder.findUnique({ where: { id: orderId } });
    if (po?.status !== "PENDING") fail("Đơn hàng không ở trạng thái chờ duyệt");
    await prisma.purchaseOrder.update({ where: { id: orderId }, data: { status: "APPROVED", approvedAt: new Date(), approvedByName: u.name, approvalNote: str(note), rejectReason: "" } });
    await logProc("PO", orderId, "PTGĐ duyệt", u.name, str(note));
  });
}

export async function rejectOrderAction(orderId: string, reason = "") {
  return run(async () => {
    const u = await need("PTGD");
    const po = await prisma.purchaseOrder.findUnique({ where: { id: orderId } });
    if (po?.status !== "PENDING") fail("Đơn hàng không ở trạng thái chờ duyệt");
    if (!str(reason)) fail("Cần ghi lý do trả lại");
    await prisma.purchaseOrder.update({ where: { id: orderId }, data: { status: "QUOTING", rejectReason: str(reason) } });
    await logProc("PO", orderId, "PTGĐ trả lại - làm lại báo giá", u.name, str(reason));
  });
}

export async function markOrderedAction(orderId: string) {
  return run(async () => {
    const u = await need("CBVT");
    const po = await prisma.purchaseOrder.findUnique({ where: { id: orderId } });
    if (po?.status !== "APPROVED") fail("Đơn hàng chưa được PTGĐ duyệt");
    await prisma.purchaseOrder.update({ where: { id: orderId }, data: { status: "ORDERED", orderedAt: new Date() } });
    await logProc("PO", orderId, "Đã đặt hàng với NCC", u.name);
  });
}

export async function cancelOrderAction(orderId: string, reason = "") {
  return run(async () => {
    const u = await need("CBVT");
    const po = await prisma.purchaseOrder.findUnique({ where: { id: orderId }, include: { _count: { select: { receipts: true } } } });
    if (!po) fail("Không tìm thấy đơn hàng");
    if (po!._count.receipts) fail("Đơn hàng đã có phiếu nhận hàng, không huỷ được");
    await prisma.purchaseOrder.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
    await logProc("PO", orderId, "Huỷ đơn hàng", u.name, str(reason));
  });
}

export async function closeOrderAction(orderId: string) {
  return run(async () => {
    const u = await need("CBVT");
    const po = await prisma.purchaseOrder.findUnique({ where: { id: orderId } });
    if (po?.status !== "ORDERED") fail("Đơn hàng chưa ở bước giao hàng");
    await prisma.purchaseOrder.update({ where: { id: orderId }, data: { status: "DONE" } });
    await logProc("PO", orderId, "Đóng đơn hàng (không giao thêm)", u.name);
  });
}

// ---------------- Nhận hàng (BCH báo số lượng thực nhận) ----------------
export async function createReceiptAction(data: { orderId: string; supplierId: string; receivedDate: string; deliveryNoteNo: string; note: string; lines: { itemId: string; quantity: number; note: string }[] }) {
  return run(async () => {
    const u = await need("GS", "CHT", "CBVT");
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: data.orderId },
      include: { items: { include: { receiptLines: true } }, quotations: { include: { lines: true, supplier: true } } },
    });
    if (!po) fail("Không tìm thấy đơn hàng");
    needProject(u, po!.projectId);
    if (po!.status !== "ORDERED") fail("Đơn hàng chưa đặt hàng hoặc đã nhận đủ");
    const lines = data.lines.filter((l) => num(l.quantity) > 0);
    if (!lines.length) fail("Chưa nhập số lượng nhận");
    for (const l of lines) {
      const it = po!.items.find((x) => x.id === l.itemId);
      if (!it || selectedPriceOf(it, po!.quotations)?.supplierId !== data.supplierId) fail("Có dòng không thuộc nhà cung cấp này");
    }
    const r = await prisma.goodsReceipt.create({
      data: {
        code: await nextCode("NH"),
        orderId: po!.id,
        supplierId: data.supplierId,
        receivedDate: dateOrNull(data.receivedDate) ?? new Date(),
        deliveryNoteNo: str(data.deliveryNoteNo),
        note: str(data.note),
        createdById: u.id,
        createdByName: u.name,
        lines: { create: lines.map((l) => ({ itemId: l.itemId, quantity: num(l.quantity), note: str(l.note) })) },
      },
    });
    await logProc("PO", po!.id, `Nhận hàng ${r.code}`, u.name, `${lines.length} dòng`);
    // Nhận đủ mọi dòng → đơn hàng hoàn tất
    const after = await prisma.purchaseOrderItem.findMany({ where: { orderId: po!.id }, include: { receiptLines: true } });
    if (after.every((it) => it.receiptLines.reduce((s, x) => s + x.quantity, 0) >= it.quantity - 1e-9)) {
      await prisma.purchaseOrder.update({ where: { id: po!.id }, data: { status: "DONE" } });
      await logProc("PO", po!.id, "Đã nhận đủ hàng", u.name);
    }
    return r.id;
  });
}

export async function deleteReceiptAction(receiptId: string) {
  return run(async () => {
    const u = await need("GS", "CHT", "CBVT");
    const r = await prisma.goodsReceipt.findUnique({ where: { id: receiptId }, include: { order: true, lines: { include: { payableLine: true } } } });
    if (!r) fail("Không tìm thấy phiếu nhận");
    needProject(u, r!.order.projectId);
    if (r!.lines.some((l) => l.payableLine)) fail("Phiếu nhận đã đưa vào công nợ, không xoá được");
    if (!can(u, "CBVT") && r!.createdById !== u.id) fail("Chỉ người lập hoặc cán bộ vật tư được xoá");
    await prisma.goodsReceipt.delete({ where: { id: receiptId } });
    if (r!.order.status === "DONE") await prisma.purchaseOrder.update({ where: { id: r!.orderId }, data: { status: "ORDERED" } });
    await logProc("PO", r!.orderId, `Xoá phiếu nhận ${r!.code}`, u.name);
  });
}

// ---------------- Công nợ từng đợt (Cán bộ vật tư → Phòng kế toán) ----------------
export async function createPayableAction(data: { projectId: string; supplierId: string; title: string; dueDate: string; note: string; receiptLineIds: string[] }) {
  return run(async () => {
    const u = await need("CBVT");
    if (!data.receiptLineIds.length) fail("Chưa chọn dòng hàng đã nhận");
    const lines = await prisma.goodsReceiptLine.findMany({
      where: { id: { in: data.receiptLineIds } },
      include: { payableLine: true, receipt: true, item: { include: { order: { include: { quotations: { include: { lines: true, supplier: true } } } } } } },
    });
    for (const l of lines) {
      if (l.payableLine) fail("Có dòng đã nằm trong công nợ khác");
      if (l.receipt.supplierId !== data.supplierId || l.item.order.projectId !== data.projectId) fail("Có dòng không thuộc NCC / dự án đã chọn");
    }
    const p = await prisma.payable.create({
      data: {
        code: await nextCode("CN"),
        projectId: data.projectId,
        supplierId: data.supplierId,
        title: str(data.title),
        dueDate: dateOrNull(data.dueDate),
        note: str(data.note),
        createdById: u.id,
        createdByName: u.name,
        lines: {
          create: lines.map((l) => {
            const sp = selectedPriceOf(l.item, l.item.order.quotations);
            return { receiptLineId: l.id, quantity: l.quantity, unitPrice: sp?.unitPrice ?? 0, vatRate: sp?.vatRate ?? 0 };
          }),
        },
      },
    });
    await logProc("PAY", p.id, "Lập công nợ", u.name, `${lines.length} dòng`);
    return p.id;
  });
}

// Thông tin in trên Bảng kê chi tiết công nợ: đợt thanh toán, cân đối đủ hoá đơn, trừ tạm ứng (chỉ sửa khi còn nháp)
export async function updatePayablePrintAction(id: string, data: { periodFrom: string; periodTo: string; invoiceAdjust: number; advanceDeduct: number }) {
  return run(async () => {
    const u = await need("CBVT");
    const p = await prisma.payable.findUnique({ where: { id } });
    if (p?.status !== "DRAFT") fail("Chỉ sửa được công nợ nháp (rút lại nếu đã gửi)");
    await prisma.payable.update({
      where: { id },
      data: { periodFrom: dateOrNull(data.periodFrom), periodTo: dateOrNull(data.periodTo), invoiceAdjust: num(data.invoiceAdjust), advanceDeduct: num(data.advanceDeduct) },
    });
    await logProc("PAY", id, "Sửa thông tin bảng kê", u.name);
  });
}

export async function sendPayableAction(id: string) {
  return run(async () => {
    const u = await need("CBVT");
    const p = await prisma.payable.findUnique({ where: { id } });
    if (p?.status !== "DRAFT") fail("Công nợ đã gửi");
    await prisma.payable.update({ where: { id }, data: { status: "SENT", sentAt: new Date() } });
    await logProc("PAY", id, "Gửi phòng kế toán", u.name);
  });
}

export async function recallPayableAction(id: string) {
  return run(async () => {
    const u = await need("CBVT");
    const p = await prisma.payable.findUnique({ where: { id }, include: { _count: { select: { payments: true } } } });
    if (p?.status !== "SENT" || p._count.payments) fail("Chỉ rút lại được công nợ đã gửi mà kế toán chưa chi");
    await prisma.payable.update({ where: { id }, data: { status: "DRAFT", sentAt: null } });
    await logProc("PAY", id, "Rút lại để sửa", u.name);
  });
}

export async function deletePayableAction(id: string) {
  return run(async () => {
    await need("CBVT");
    const p = await prisma.payable.findUnique({ where: { id } });
    if (p?.status !== "DRAFT") fail("Chỉ xoá được công nợ nháp");
    await prisma.payable.delete({ where: { id } });
  });
}

async function refreshPayableStatus(id: string) {
  const p = await prisma.payable.findUnique({ where: { id }, include: { lines: true, payments: true } });
  if (!p) return;
  const t = payableTotals(p);
  const status = t.paid <= 0 ? "SENT" : t.remaining > 0.5 ? "PARTIAL" : "PAID";
  if (status !== p.status) await prisma.payable.update({ where: { id }, data: { status } });
}

export async function addPaymentAction(payableId: string, data: { amount: number; paidDate: string; note: string }) {
  return run(async () => {
    const u = await need("KT");
    const p = await prisma.payable.findUnique({ where: { id: payableId } });
    if (!p || p.status === "DRAFT") fail("Công nợ chưa được gửi sang kế toán");
    if (!(num(data.amount) > 0)) fail("Số tiền phải lớn hơn 0");
    await prisma.payment.create({ data: { payableId, amount: num(data.amount), paidDate: dateOrNull(data.paidDate) ?? new Date(), note: str(data.note), createdByName: u.name } });
    await refreshPayableStatus(payableId);
    await logProc("PAY", payableId, "Ghi nhận đã chi", u.name, `${Math.round(num(data.amount)).toLocaleString("vi-VN")}đ ${str(data.note)}`);
  });
}

export async function deletePaymentAction(paymentId: string) {
  return run(async () => {
    const u = await need("KT");
    const pm = await prisma.payment.delete({ where: { id: paymentId } });
    await refreshPayableStatus(pm.payableId);
    await logProc("PAY", pm.payableId, "Xoá lần chi", u.name, `${Math.round(pm.amount).toLocaleString("vi-VN")}đ`);
  });
}
