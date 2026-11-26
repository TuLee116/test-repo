"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getPriceUser, releasePriceFile } from "@/lib/gia-doi";

// XOÁ DÀNH RIÊNG CHO QUẢN TRỊ: xoá hồ sơ trình giá ở MỌI trạng thái (kể cả đã trình / đã duyệt) — gỡ luôn giá đã ghi vào sổ giá;
// xoá cả hợp đồng kèm toàn bộ hồ sơ (tổ đội + thầu phụ) và sổ giá. Mỗi lần xoá ghi nhật ký ProcLog entity "XOA".
type R = { ok: true; info?: string } | { ok: false; error: string };

async function admin() {
  const u = await getPriceUser();
  return u?.isAdmin ? u : null;
}
const note = (entityId: string, action: string, userName: string, n: string) => prisma.procLog.create({ data: { entity: "XOA", entityId, action, userName, note: n } });

// Xoá 1 hồ sơ giá đội: sổ giá ghi từ hồ sơ, file gốc dùng chung (chuyển cho hồ sơ khác), nhật ký; lần trình sau trỏ về hồ sơ này thì cắt liên kết
async function dropPrice(id: string) {
  await prisma.approvedPrice.deleteMany({ where: { submissionId: id } });
  await releasePriceFile(id);
  await prisma.priceSubmission.updateMany({ where: { parentId: id }, data: { parentId: null } });
  await prisma.priceSubmission.delete({ where: { id } });
  await prisma.procLog.deleteMany({ where: { entity: "GIA", entityId: id } });
}
async function dropSub(id: string) {
  await prisma.approvedPrice.deleteMany({ where: { submissionId: id, kind: "TP" } });
  await prisma.subProposal.updateMany({ where: { parentId: id }, data: { parentId: null } });
  await prisma.subProposal.delete({ where: { id } });
  await prisma.procLog.deleteMany({ where: { entity: "TPH", entityId: id } });
}

export async function adminDeletePricesAction(ids: string[]): Promise<R> {
  const u = await admin();
  if (!u) return { ok: false, error: "Chỉ quản trị được xoá hồ sơ đã trình / đã duyệt" };
  if (!ids.length) return { ok: false, error: "Chưa chọn hồ sơ nào" };
  const subs = await prisma.priceSubmission.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, status: true, contractId: true, crewName: true, batch: true } });
  try {
    for (const s of subs) {
      await dropPrice(s.id);
      await note(s.contractId ?? "-", "Xoá hồ sơ giá đội", u.name, `${s.code} (${s.status}) · đội ${s.crewName || "-"} · đợt ${s.batch || "-"}`);
    }
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Lỗi khi xoá, một số hồ sơ có thể đã xoá — tải lại trang để xem" };
  }
  revalidatePath("/gia-doi", "layout");
  return { ok: true, info: `Đã xoá ${subs.length} hồ sơ` };
}

export async function adminDeleteSubAction(id: string): Promise<R> {
  const u = await admin();
  if (!u) return { ok: false, error: "Chỉ quản trị được xoá hồ sơ đã trình / đã duyệt" };
  const p = await prisma.subProposal.findUnique({ where: { id }, select: { code: true, status: true, contractId: true } });
  if (!p) return { ok: false, error: "Không tìm thấy hồ sơ" };
  await dropSub(id);
  await note(p.contractId ?? "-", "Xoá hồ sơ thầu phụ", u.name, `${p.code} (${p.status})`);
  revalidatePath("/gia-doi", "layout");
  return { ok: true };
}

// Xoá hợp đồng + toàn bộ hồ sơ + sổ giá: phải gõ đúng số HĐ (chưa có số thì gõ tên công trình)
export async function adminDeleteContractAction(id: string, typed: string): Promise<R> {
  const u = await admin();
  if (!u) return { ok: false, error: "Chỉ quản trị được xoá hợp đồng kèm hồ sơ" };
  const c = await prisma.costContract.findUnique({ where: { id }, select: { name: true, contractNo: true } });
  if (!c) return { ok: false, error: "Không tìm thấy hợp đồng" };
  const want = (c.contractNo || c.name).trim();
  if (typed.trim().replace(/\s+/g, " ").toLowerCase() !== want.replace(/\s+/g, " ").toLowerCase()) return { ok: false, error: `Gõ chưa đúng "${want}" — chưa xoá gì` };
  const [ps, ss] = await Promise.all([
    prisma.priceSubmission.findMany({ where: { contractId: id }, select: { id: true } }),
    prisma.subProposal.findMany({ where: { contractId: id }, select: { id: true } }),
  ]);
  try {
    for (const s of ps) await dropPrice(s.id);
    for (const s of ss) await dropSub(s.id);
    await prisma.costContract.delete({ where: { id } });
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Lỗi khi xoá, tải lại trang để xem phần đã xoá" };
  }
  await note(id, "Xoá hợp đồng", u.name, `${c.contractNo || "(chưa có số)"} · ${c.name} · ${ps.length} hồ sơ giá đội, ${ss.length} hồ sơ thầu phụ`);
  revalidatePath("/gia-doi", "layout");
  return { ok: true, info: `Đã xoá hợp đồng cùng ${ps.length} hồ sơ giá đội, ${ss.length} hồ sơ thầu phụ` };
}
