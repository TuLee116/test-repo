import { prisma } from "@/lib/prisma";
import type { GridNote } from "@/app/(app)/ExcelGrid";

// GHI CHÚ Ô (dùng ở trang server): đọc danh sách ghi chú của 1 hồ sơ — GD = giá đội, TPH = thầu phụ
export type NoteEntity = "GD" | "TPH";

const fmt = (d: Date) => d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });

export const noteView = (n: { id: string; rowKey: string; colKey: string; text: string; userName: string; userId: string; createdAt: Date }, uid: string, admin = false): GridNote => ({
  id: n.id,
  row: n.rowKey,
  col: n.colKey,
  text: n.text,
  user: n.userName,
  at: fmt(n.createdAt),
  mine: admin || n.userId === uid,
});

export async function listCellNotes(entity: NoteEntity, entityId: string, uid: string, admin = false): Promise<GridNote[]> {
  const ns = await prisma.cellNote.findMany({ where: { entity, entityId }, orderBy: { createdAt: "asc" } });
  return ns.map((n) => noteView(n, uid, admin));
}
