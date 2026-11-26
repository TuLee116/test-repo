import { auth } from "@/auth";
import { parseAreas } from "@/lib/perms";
import { prisma } from "@/lib/prisma";

// Phân hệ Mua vật tư: vai trò, quyền, nhãn trạng thái và các phép tính dùng chung.
// Vai trò lưu ở User.procRoles (đọc lại từ DB mỗi request để admin đổi quyền là có hiệu lực ngay, không cần đăng nhập lại).

export const PROC_ROLES = [
  { value: "GS", label: "Giám sát hiện trường (BCH)", short: "Giám sát" },
  { value: "CHT", label: "Chỉ huy trưởng trở lên (BCH) - duyệt đề nghị", short: "CHT" },
  { value: "CBVT", label: "Cán bộ vật tư - lên đơn hàng, mua hàng, lên công nợ", short: "Cán bộ VT" },
  { value: "KTVT", label: "Kế toán vật tư - báo giá, bảng so sánh", short: "Kế toán VT" },
  { value: "PTGD", label: "Phó tổng giám đốc thường trực - duyệt bảng so sánh", short: "PTGĐ" },
  { value: "KT", label: "Phòng kế toán - thanh toán NCC", short: "Kế toán" },
] as const;
export type ProcRole = (typeof PROC_ROLES)[number]["value"];

export type ProcUser = {
  id: string;
  name: string;
  isAdmin: boolean;
  roles: Set<ProcRole>;
  // null = thấy mọi dự án; mảng = chỉ các dự án mình thuộc BCH (người chỉ có vai trò GS/CHT)
  projectIds: string[] | null;
};

export function parseRoles(s: string): Set<ProcRole> {
  const valid = new Set<string>(PROC_ROLES.map((r) => r.value));
  return new Set(s.split(",").map((x) => x.trim()).filter((x) => valid.has(x)) as ProcRole[]);
}

export async function getProcUser(): Promise<ProcUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const u = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, name: true, role: true, procRoles: true, apps: true, areas: true } });
  if (!u) return null;
  // vai trò chỉ có hiệu lực khi tài khoản được tick chương trình "Mua vật tư"
  const roles = u.apps.split(",").includes("PROC") ? parseRoles(u.procRoles) : new Set<ProcRole>();
  const isAdmin = u.role === "ADMIN";
  const siteOnly = !isAdmin && [...roles].every((r) => r === "GS" || r === "CHT");
  let projectIds = siteOnly ? (await prisma.procMember.findMany({ where: { userId: u.id }, select: { projectId: true } })).map((m) => m.projectId) : null;
  // khu vực làm việc: chỉ thấy dự án thuộc khu vực của mình (dự án chưa chọn khu vực: ai cũng thấy)
  const areas = parseAreas(u.areas);
  if (!isAdmin && areas.length) {
    const inArea = (await prisma.project.findMany({ where: { area: { in: [...areas, ""] } }, select: { id: true } })).map((p) => p.id);
    projectIds = projectIds === null ? inArea : projectIds.filter((id) => inArea.includes(id));
  }
  return { id: u.id, name: u.name, isAdmin, roles, projectIds };
}

export function can(u: ProcUser, ...roles: ProcRole[]): boolean {
  return u.isAdmin || roles.some((r) => u.roles.has(r));
}

export function canSeeProject(u: ProcUser, projectId: string): boolean {
  return u.projectIds === null || u.projectIds.includes(projectId);
}

// Điều kiện where theo dự án được xem (dùng cho findMany)
export function projectScope(u: ProcUser): { projectId?: { in: string[] } } {
  return u.projectIds === null ? {} : { projectId: { in: u.projectIds } };
}

// Danh sách dự án (gói thầu DT-CP) người dùng được chọn trong phân hệ
export async function visibleProjects(u: ProcUser) {
  const ps = await prisma.project.findMany({
    where: u.projectIds === null ? {} : { id: { in: u.projectIds } },
    select: { id: true, name: true, packageName: true },
    orderBy: { name: "asc" },
  });
  return ps.map((p) => ({ id: p.id, name: p.name, packageName: p.packageName ?? "", label: p.packageName ? `${p.name} — ${p.packageName}` : p.name }));
}

export const REQ_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "Nháp", cls: "bg-slate-100 text-slate-700" },
  SUBMITTED: { label: "Chờ CHT duyệt", cls: "bg-amber-100 text-amber-800" },
  APPROVED: { label: "Đã duyệt", cls: "bg-emerald-100 text-emerald-800" },
  REJECTED: { label: "Bị trả lại", cls: "bg-red-100 text-red-700" },
};

export const PO_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "Đang lên đơn", cls: "bg-slate-100 text-slate-700" },
  QUOTING: { label: "KT vật tư lấy báo giá", cls: "bg-sky-100 text-sky-800" },
  PENDING: { label: "Chờ PTGĐ duyệt", cls: "bg-amber-100 text-amber-800" },
  APPROVED: { label: "Đã duyệt - chờ đặt hàng", cls: "bg-emerald-100 text-emerald-800" },
  ORDERED: { label: "Đã đặt hàng - chờ giao", cls: "bg-indigo-100 text-indigo-800" },
  DONE: { label: "Đã nhận đủ", cls: "bg-emerald-600 text-white" },
  CANCELLED: { label: "Đã huỷ", cls: "bg-slate-200 text-slate-500 line-through" },
};

export const PAY_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "Nháp", cls: "bg-slate-100 text-slate-700" },
  SENT: { label: "Đã gửi kế toán - chờ chi", cls: "bg-amber-100 text-amber-800" },
  PARTIAL: { label: "Đã chi một phần", cls: "bg-sky-100 text-sky-800" },
  PAID: { label: "Đã thanh toán đủ", cls: "bg-emerald-100 text-emerald-800" },
};

// Mã chứng từ tăng dần theo năm: YC26-0001, DH26-0001, NH26-0001, CN26-0001
export async function nextCode(prefix: "YC" | "DH" | "NH" | "CN"): Promise<string> {
  const head = `${prefix}${String(new Date().getFullYear()).slice(2)}-`;
  const where = { code: { startsWith: head } };
  const select = { code: true } as const;
  const orderBy = { code: "desc" } as const;
  const last =
    prefix === "YC"
      ? await prisma.materialRequest.findFirst({ where, select, orderBy })
      : prefix === "DH"
        ? await prisma.purchaseOrder.findFirst({ where, select, orderBy })
        : prefix === "NH"
          ? await prisma.goodsReceipt.findFirst({ where, select, orderBy })
          : await prisma.payable.findFirst({ where, select, orderBy });
  const n = last ? Number(last.code.slice(head.length)) + 1 : 1;
  return head + String(n).padStart(4, "0");
}

export async function logProc(entity: "REQ" | "PO" | "RCV" | "PAY", entityId: string, action: string, userName: string, note = "") {
  await prisma.procLog.create({ data: { entity, entityId, action, userName, note } });
}

export function fmtMoney(n: number): string {
  return Math.round(n).toLocaleString("vi-VN");
}

export { fmtQty } from "./fmt-qty";

export function fmtDate(d: Date | null | undefined): string {
  return d ? d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "";
}

export function fmtDateTime(d: Date): string {
  return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });
}

// Dòng PO: báo giá được chọn → đơn giá trước VAT + VAT% + NCC
export type SelectedPrice = { quoteId: string; supplierId: string; supplierName: string; unitPrice: number; vatRate: number };

export function selectedPriceOf(
  item: { id: string; selectedQuoteId: string | null },
  quotes: { id: string; supplierId: string; vatRate: number; supplier: { name: string }; lines: { itemId: string; unitPrice: number }[] }[],
): SelectedPrice | null {
  const q = quotes.find((x) => x.id === item.selectedQuoteId);
  const line = q?.lines.find((l) => l.itemId === item.id);
  if (!q || !line || !(line.unitPrice > 0)) return null;
  return { quoteId: q.id, supplierId: q.supplierId, supplierName: q.supplier.name, unitPrice: line.unitPrice, vatRate: q.vatRate };
}

// total gồm cả dòng "Cân đối đủ hóa đơn" (invoiceAdjust, đã gồm VAT) để khớp số tiền trên hoá đơn NCC
export function payableTotals(p: { lines: { quantity: number; unitPrice: number; vatRate: number }[]; payments: { amount: number }[]; invoiceAdjust?: number }) {
  const beforeVat = p.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const total = p.lines.reduce((s, l) => s + l.quantity * l.unitPrice * (1 + l.vatRate), 0) + (p.invoiceAdjust ?? 0);
  const paid = p.payments.reduce((s, x) => s + x.amount, 0);
  const adjust = p.invoiceAdjust ?? 0;
  return { beforeVat, vat: total - adjust - beforeVat, adjust, total, paid, remaining: total - paid };
}
