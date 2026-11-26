import { prisma } from "@/lib/prisma";
import { getMaterialBudget, type BudgetRow } from "@/lib/proc-budget";
import { payableTotals, selectedPriceOf } from "@/lib/proc";

// Số liệu cho 3 biểu mẫu (xem & duyệt trên app) theo mẫu Excel thật của phòng vật tư:
//  1. GIẤY ĐỀ XUẤT VẬT TƯ (BCH lập, phiếu đề nghị)
//  2. BẢNG TỔNG HỢP VẬT TƯ - TRÌNH KÍ ĐƠN HÀNG (đơn hàng trình PTGĐ duyệt)
//  3. BẢNG KÊ CHI TIẾT CÔNG NỢ (công nợ NCC theo đợt)
// Lũy kế tính theo vật tư: cùng resourceId (vật tư trong TH Vật Tư), vật tư ngoài BOQ thì theo tên + ĐVT.

const norm = (s: string) => s.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
const keyOf = (resourceId: string | null | undefined, name: string, unit: string) => (resourceId ? `r:${resourceId}` : `n:${norm(name)}|${norm(unit)}`);

// ---------------- 1. Giấy đề xuất vật tư ----------------
export async function getRequestForm(id: string) {
  const r = await prisma.materialRequest.findUnique({ where: { id }, include: { project: true, items: { orderBy: { orderIndex: "asc" } } } });
  if (!r) return null;
  const [budget, earlier] = await Promise.all([
    getMaterialBudget(r.projectId),
    prisma.materialRequest.findMany({
      where: { projectId: r.projectId, status: { not: "REJECTED" }, createdAt: { lt: r.createdAt }, id: { not: r.id } },
      include: { items: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const budgetById = new Map(budget.map((b) => [b.resourceId, b]));
  const prevQty = new Map<string, number>();
  for (const e of earlier) for (const it of e.items) prevQty.set(keyOf(it.resourceId, it.name, it.unit), (prevQty.get(keyOf(it.resourceId, it.name, it.unit)) ?? 0) + it.quantity);
  const last = earlier[earlier.length - 1];
  const items = r.items.map((it) => {
    const prev = prevQty.get(keyOf(it.resourceId, it.name, it.unit)) ?? 0;
    return {
      id: it.id,
      name: it.name,
      spec: it.spec,
      unit: it.unit,
      dtcpQty: it.resourceId ? (budgetById.get(it.resourceId)?.boqQty ?? null) : null,
      contractQty: it.contractQty,
      finalQty: it.finalQty,
      forecastQty: it.forecastQty,
      prevQty: prev,
      qty: it.quantity,
      cumQty: prev + it.quantity,
      note: it.note,
    };
  });
  return {
    r,
    batchNo: earlier.length + 1, // Đợt số = thứ tự phiếu trong dự án (không tính phiếu bị trả lại)
    date: r.submittedAt ?? r.createdAt,
    prevDate: last ? (last.submittedAt ?? last.createdAt) : null,
    items,
  };
}

// ---------------- 2. Trình kí đơn hàng ----------------
export type OrderFormRow = {
  id: string;
  code: string; // Kí hiệu DTCP
  supplier: string;
  name: string;
  spec: string;
  unit: string;
  dtcpAmount: number | null; // Tổng giá trị vật tư theo bảng dự trù DT-CP
  dtcpPrice: number | null; // Đơn giá theo DTCP (gồm VAT)
  price: number | null; // Đơn giá trình ký (gồm VAT)
  dtcpQty: number | null;
  finalQty: number | null;
  prevQty: number;
  prevAmount: number;
  qty: number;
  payTerms: string;
  notes: string[];
};

export async function getOrderForm(id: string) {
  const o = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      project: true,
      items: { orderBy: { orderIndex: "asc" }, include: { requestItem: { include: { request: { select: { category: true } } } } } },
      quotations: { include: { supplier: true, lines: true } },
    },
  });
  if (!o) return null;
  const [budget, earlier] = await Promise.all([
    getMaterialBudget(o.projectId),
    prisma.purchaseOrder.findMany({
      where: { projectId: o.projectId, status: { not: "CANCELLED" }, createdAt: { lt: o.createdAt }, id: { not: o.id } },
      include: { items: { include: { requestItem: { select: { resourceId: true } } } }, quotations: { include: { supplier: true, lines: true } } },
    }),
  ]);
  const budgetById = new Map<string, BudgetRow>(budget.map((b) => [b.resourceId, b]));
  const prev = new Map<string, { qty: number; amount: number }>();
  for (const e of earlier)
    for (const it of e.items) {
      const k = keyOf(it.requestItem?.resourceId, it.name, it.unit);
      const sp = selectedPriceOf(it, e.quotations);
      const cur = prev.get(k) ?? { qty: 0, amount: 0 };
      cur.qty += it.quantity;
      cur.amount += sp ? it.quantity * sp.unitPrice * (1 + sp.vatRate) : 0;
      prev.set(k, cur);
    }

  const groups: { name: string; rows: OrderFormRow[] }[] = [];
  for (const it of o.items) {
    const rid = it.requestItem?.resourceId ?? null;
    const b = rid ? budgetById.get(rid) : undefined;
    const sp = selectedPriceOf(it, o.quotations);
    const q = sp ? o.quotations.find((x) => x.id === sp.quoteId) : undefined;
    const price = sp ? sp.unitPrice * (1 + sp.vatRate) : null;
    const p = prev.get(keyOf(rid, it.name, it.unit)) ?? { qty: 0, amount: 0 };
    const notes: string[] = [];
    if (it.note) notes.push(it.note);
    if (!b) notes.push("Ngoài DT-CP");
    if (b && p.qty + it.quantity > b.boqQty + 1e-9) notes.push(`Vượt KL DT-CP ${fmtN(p.qty + it.quantity - b.boqQty)}`);
    if (b && price !== null && b.unitPriceVat > 0 && price > b.unitPriceVat * 1.0005) notes.push(`Đơn giá cao hơn DT-CP ${(((price - b.unitPriceVat) / b.unitPriceVat) * 100).toFixed(1).replace(".", ",")}%`);
    const row: OrderFormRow = {
      id: it.id,
      code: b?.code ?? "",
      supplier: sp?.supplierName ?? "",
      name: it.name,
      spec: it.spec,
      unit: it.unit,
      dtcpAmount: b ? b.amountVat : null,
      dtcpPrice: b ? b.unitPriceVat : null,
      price,
      dtcpQty: b ? b.boqQty : null,
      finalQty: it.requestItem?.finalQty ?? null,
      prevQty: p.qty,
      prevAmount: p.amount,
      qty: it.quantity,
      payTerms: q?.paymentTerms ?? "",
      notes,
    };
    const gName = it.requestItem?.request.category || o.title || "Vật tư";
    let g = groups.find((x) => x.name === gName);
    if (!g) groups.push((g = { name: gName, rows: [] }));
    g.rows.push(row);
  }
  return { o, date: o.submittedAt ?? o.createdAt, groups };
}

function fmtN(n: number) {
  return n.toLocaleString("vi-VN", { maximumFractionDigits: 3 });
}

// ---------------- 3. Bảng kê chi tiết công nợ ----------------
export async function getPayableForm(id: string) {
  const cur = await prisma.payable.findUnique({ where: { id }, include: { project: true, supplier: true, payments: { orderBy: { paidDate: "asc" } } } });
  if (!cur) return null;
  // Các đợt công nợ của cùng NCC + dự án tính đến đợt này (đợt trước + đợt này)
  const payables = await prisma.payable.findMany({
    where: { projectId: cur.projectId, supplierId: cur.supplierId, createdAt: { lte: cur.createdAt } },
    orderBy: { createdAt: "asc" },
    include: {
      payments: true,
      lines: {
        include: {
          receiptLine: { include: { receipt: true, item: { include: { order: { include: { quotations: { include: { supplier: true, lines: true } } } } } } } },
        },
      },
    },
  });
  const groups = payables.map((p) => {
    const lines = [...p.lines]
      .sort((a, b) => a.receiptLine.receipt.receivedDate.getTime() - b.receiptLine.receipt.receivedDate.getTime())
      .map((l) => {
        const sp = selectedPriceOf(l.receiptLine.item, l.receiptLine.item.order.quotations);
        const signPrice = sp ? sp.unitPrice * (1 + sp.vatRate) : null;
        const price = l.unitPrice * (1 + l.vatRate);
        return {
          id: l.id,
          date: l.receiptLine.receipt.receivedDate,
          name: l.receiptLine.item.name,
          unit: l.receiptLine.item.unit,
          qty: l.quantity,
          signPrice,
          signAmount: signPrice === null ? null : signPrice * l.quantity,
          price,
          amount: price * l.quantity,
          note: l.receiptLine.note,
        };
      });
    const dates = lines.map((l) => l.date.getTime());
    const t = payableTotals(p);
    return {
      id: p.id,
      code: p.code,
      isCurrent: p.id === cur.id,
      from: p.periodFrom ?? (dates.length ? new Date(Math.min(...dates)) : p.createdAt),
      to: p.periodTo ?? (dates.length ? new Date(Math.max(...dates)) : p.createdAt),
      lines,
      adjust: p.invoiceAdjust,
      total: t.total,
      paid: t.paid,
    };
  });
  const A = groups.reduce((s, g) => s + g.total, 0); // Tổng giá trị mua hàng
  const B = groups.reduce((s, g) => s + g.paid, 0); // Đã tạm ứng / thanh toán (kế toán ghi nhận chi)
  const C = cur.advanceDeduct; // Trừ tạm ứng
  const qtyTotal = groups.reduce((s, g) => s + g.lines.reduce((a, l) => a + l.qty, 0), 0);
  const here = groups.find((g) => g.isCurrent)!;
  return { p: cur, groups, here, A, B, C, D: A - B - C, qtyTotal };
}
