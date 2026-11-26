"use server";

import { prisma } from "@/lib/prisma";
import { asSub, canSeePrice, canSeeSub, getPriceUser, type PriceUser } from "@/lib/gia-doi";
import type { GridNote } from "@/app/(app)/ExcelGrid";
import { noteView, type NoteEntity } from "@/lib/cell-notes";

// GHI CHÚ Ô ở bảng trình giá đội (GD) / giá thầu phụ (TPH) — lưu ngay, ai xem được hồ sơ thì ghi chú được; chỉ xoá ghi chú của mình (quản trị xoá mọi ghi chú)
type Entity = NoteEntity;

async function access(entity: Entity, entityId: string): Promise<PriceUser> {
  const u = await getPriceUser();
  if (!u) throw new Error("Chưa đăng nhập");
  if (entity === "GD") {
    if (!canSeePrice(u)) throw new Error("Không có quyền xem hồ sơ giá đội");
    if (!(await prisma.priceSubmission.findUnique({ where: { id: entityId }, select: { id: true } }))) throw new Error("Không tìm thấy hồ sơ");
  } else {
    if (!canSeeSub(asSub(u))) throw new Error("Không có quyền xem hồ sơ thầu phụ");
    if (!(await prisma.subProposal.findUnique({ where: { id: entityId }, select: { id: true } }))) throw new Error("Không tìm thấy hồ sơ");
  }
  return u;
}

export async function addCellNoteAction(entity: Entity, entityId: string, row: string, col: string, text: string): Promise<{ ok: true; note: GridNote } | { ok: false; error: string }> {
  try {
    const u = await access(entity, entityId);
    const t = String(text ?? "").trim().slice(0, 2000);
    if (!t) return { ok: false, error: "Ghi chú trống" };
    if (!row || row.startsWith("new:")) return { ok: false, error: "Dòng mới thêm chưa lưu — bấm Lưu nháp trước rồi mới ghi chú được" };
    const n = await prisma.cellNote.create({ data: { entity, entityId, rowKey: String(row).slice(0, 100), colKey: String(col).slice(0, 100), text: t, userId: u.id, userName: u.name } });
    return { ok: true, note: noteView(n, u.id, u.isAdmin) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Không lưu được ghi chú" };
  }
}

export async function deleteCellNoteAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const n = await prisma.cellNote.findUnique({ where: { id } });
    if (!n) return { ok: true };
    const u = await access(n.entity as Entity, n.entityId);
    if (n.userId !== u.id && !u.isAdmin) return { ok: false, error: "Chỉ xoá được ghi chú của mình" };
    await prisma.cellNote.delete({ where: { id } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Không xoá được ghi chú" };
  }
}
