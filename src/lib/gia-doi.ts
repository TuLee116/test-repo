import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getFile } from "@/lib/file-store";
import { categoryRole } from "@/lib/gia-doi-calc";
import { parseAreas, parseCodes } from "@/lib/perms";

export * from "@/lib/gia-doi-calc";

// Phân hệ ĐỆ TRÌNH GIÁ ĐỘI (nội bộ phòng ĐT-KS-TT): vai trò, nhãn, phép tính dùng chung.
// Luồng: QSTT tải file Excel đề xuất của BCH → kiểm tra / ghi chú → trình 1 trong 3 Trưởng phòng (theo hạng mục)
// → TP duyệt từng dòng (sửa đơn giá) rồi Duyệt / Không duyệt cả hồ sơ → trả về QSTT → QSTT gửi mail kết quả.

export const PRICE_ROLES = [
  { value: "QSTT", label: "QS thanh toán - tải file đề xuất, kiểm tra, trình duyệt, gửi mail", short: "QSTT" },
  { value: "QSDT", label: "QS đấu thầu - nhập / cập nhật DT-CP hợp đồng (sổ giá)", short: "QSĐT" },
  { value: "TP_KC", label: "Trưởng phòng duyệt hạng mục Kết cấu", short: "TP Kết cấu" },
  { value: "TP_HTPQ", label: "Trưởng phòng duyệt hạng mục Hoàn thiện Phú Quốc", short: "TP HT Phú Quốc" },
  { value: "TP_HTKV", label: "Trưởng phòng duyệt hạng mục Hoàn thiện các khu vực còn lại", short: "TP HT khu vực khác" },
  { value: "PTG", label: "Phó Tổng - phê duyệt giá thầu phụ nhánh B, xem để nắm nhánh A", short: "Phó Tổng" },
] as const;
export type PriceRole = (typeof PRICE_ROLES)[number]["value"];

// roles = quyền TRÌNH GIÁ TỔ ĐỘI, sub = quyền TRÌNH GIÁ THẦU PHỤ (tick riêng ở Người dùng); view* = chỉ được xem;
// areas = khu vực làm việc (null = tất cả). Code thầu phụ dùng asSub(u) để "roles" là quyền thầu phụ.
export type PriceUser = { id: string; name: string; isAdmin: boolean; roles: Set<PriceRole>; sub: Set<PriceRole>; viewPrice: boolean; viewSub: boolean; exportSub: boolean; areas: string[] | null };

export function parsePriceRoles(s: string): Set<PriceRole> {
  const valid = new Set<string>(PRICE_ROLES.map((r) => r.value));
  return new Set(s.split(",").map((x) => x.trim()).filter((x) => valid.has(x)) as PriceRole[]);
}

export async function getPriceUser(): Promise<PriceUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const u = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, name: true, role: true, priceRoles: true, subRoles: true, apps: true, areas: true } });
  if (!u) return null;
  const on = u.apps.split(",").includes("PRICE");
  const isAdmin = u.role === "ADMIN";
  const areas = parseAreas(u.areas);
  return {
    id: u.id,
    name: u.name,
    isAdmin,
    roles: on ? parsePriceRoles(u.priceRoles) : new Set<PriceRole>(),
    sub: on ? parsePriceRoles(u.subRoles) : new Set<PriceRole>(),
    viewPrice: on && parseCodes(u.priceRoles, "price").length > 0,
    viewSub: on && parseCodes(u.subRoles, "sub").length > 0,
    exportSub: on && parseCodes(u.subRoles, "sub").includes("EXPORT"),
    areas: isAdmin || !areas.length ? null : areas,
  };
}

// Quyền thầu phụ đặt vào chỗ "roles" để dùng chung canPrice / canReviewCategory / priceTaskWhere
export const asSub = (u: PriceUser): PriceUser => ({ ...u, roles: u.sub });
// được vào phân hệ tổ đội / thầu phụ (kể cả chỉ xem)
export const canSeePrice = (u: PriceUser) => u.isAdmin || u.viewPrice;
export const canSeeSub = (u: PriceUser) => u.isAdmin || u.viewSub;
// xuất file tổng hợp đệ trình thầu phụ (quyền tick riêng "EXPORT" ở Người dùng → Sửa quyền)
export const canExportSub = (u: PriceUser) => u.isAdmin || u.exportSub;
// hợp đồng / tờ trình thuộc khu vực của mình (hợp đồng chưa chọn khu vực / chưa gắn hợp đồng: ai cũng thấy)
export const inPriceAreas = (u: PriceUser, area: string | null | undefined) => !u.areas || !area || u.areas.includes(area);
export const ownAreaWhere = (u: PriceUser) => (u.areas ? { area: { in: [...u.areas, ""] } } : {});
// hồ sơ giá đội: có hợp đồng → khu vực của hợp đồng; CHƯA gắn hợp đồng (chưa biết khu vực) → chỉ NGƯỜI TẠO thấy (người bị giới hạn khu vực không thấy hồ sơ nháp của khu vực khác)
export const contractAreaWhere = (u: PriceUser) => (u.areas ? { OR: [{ contractId: null, createdById: u.id }, { contract: { area: { in: [...u.areas, ""] } } }] } : {});
// kiểm tra 1 hồ sơ giá đội có trong phạm vi khu vực của người dùng (dùng khi xem / xử lý hồ sơ)
export const inSubmissionScope = (u: PriceUser, s: { contractId: string | null; createdById: string }, contractArea: string | null | undefined) =>
  !u.areas || (s.contractId ? !contractArea || u.areas.includes(contractArea) : s.createdById === u.id);
// hồ sơ thầu phụ: có hợp đồng → khu vực hợp đồng; chưa có hợp đồng (đang trình HĐ / báo giá) → khu vực chọn trên hồ sơ
export const subAreaWhere = (u: PriceUser) =>
  u.areas ? { OR: [{ contractId: null, area: { in: [...u.areas, ""] } }, { contract: { area: { in: [...u.areas, ""] } } }] } : {};

export function canPrice(u: PriceUser, ...roles: PriceRole[]): boolean {
  return u.isAdmin || roles.some((r) => u.roles.has(r));
}

export const isTP = (u: PriceUser) => u.isAdmin || [...u.roles].some((r) => r.startsWith("TP_"));
// Trưởng phòng được duyệt hồ sơ của hạng mục này
export const canReviewCategory = (u: PriceUser, category: string) => {
  const r = categoryRole(category);
  return u.isAdmin || (!!r && u.roles.has(r));
};

export async function nextPriceCode(): Promise<string> {
  const head = `GD${String(new Date().getFullYear()).slice(2)}-`;
  const last = await prisma.priceSubmission.findFirst({ where: { code: { startsWith: head } }, select: { code: true }, orderBy: { code: "desc" } });
  return head + String(last ? Number(last.code.slice(head.length)) + 1 : 1).padStart(4, "0");
}

export async function logPrice(entityId: string, action: string, userName: string, note = "") {
  await prisma.procLog.create({ data: { entity: "GIA", entityId, action, userName, note } });
}


// File Excel gốc của hồ sơ: file nhiều sheet chỉ lưu 1 bản ở hồ sơ đầu tiên, các hồ sơ khác trỏ tới (fileFromId)
// File nằm ở KHO FILE (fileKey, từ 23/11/2026); hồ sơ cũ chưa chuyển thì còn ở fileData
export async function priceFileOf(s: { fileData?: Uint8Array | null; fileKey?: string | null; fileFromId: string | null }): Promise<Uint8Array | null> {
  if (s.fileData) return s.fileData;
  if (s.fileKey) return getFile(s.fileKey);
  if (!s.fileFromId) return null;
  const src = await prisma.priceSubmission.findUnique({ where: { id: s.fileFromId }, select: { fileData: true, fileKey: true } });
  return src?.fileData ?? (await getFile(src?.fileKey)) ?? null;
}
// trỏ file cho hồ sơ mới tạo từ hồ sơ này (trình lại...) — không chép thêm bản file
export const sharedFileRef = (s: { id: string; fileData?: Uint8Array | null; fileKey?: string | null; fileFromId: string | null }) => ({ fileData: null, fileKey: null, fileFromId: s.fileData || s.fileKey ? s.id : s.fileFromId });
// trước khi xoá hồ sơ đang giữ file gốc: chuyển file sang 1 hồ sơ đang trỏ tới nó, các hồ sơ còn lại trỏ sang hồ sơ đó
export async function releasePriceFile(id: string) {
  const users = await prisma.priceSubmission.findMany({ where: { fileFromId: id }, select: { id: true }, orderBy: { createdAt: "asc" } });
  if (!users.length) return;
  const me = await prisma.priceSubmission.findUnique({ where: { id }, select: { fileKey: true, fileFromId: true } });
  if (!me) return;
  const heir = users[0].id;
  if (me.fileKey) {
    await prisma.priceSubmission.update({ where: { id: heir }, data: { fileKey: me.fileKey, fileFromId: null } });
    await prisma.priceSubmission.updateMany({ where: { fileFromId: id, id: { not: heir } }, data: { fileFromId: heir } });
  } else await prisma.priceSubmission.updateMany({ where: { fileFromId: id }, data: { fileFromId: me.fileFromId } });
}
