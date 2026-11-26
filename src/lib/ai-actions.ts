"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

type R = { ok: true } | { ok: false; error: string };

// 👍 / 👎 cho câu trả lời của trợ lý (chỉ chủ cuộc hội thoại)
export async function rateAiMessageAction(messageId: string, rating: number): Promise<R> {
  const s = await auth();
  if (!s?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  const m = await prisma.aiMessage.findFirst({ where: { id: messageId, role: "assistant", chat: { userId: s.user.id } } });
  if (!m) return { ok: false, error: "Không tìm thấy câu trả lời" };
  await prisma.aiMessage.update({ where: { id: messageId }, data: { rating: rating > 0 ? 1 : rating < 0 ? -1 : 0 } });
  return { ok: true };
}

async function needAdmin() {
  const s = await auth();
  if (!s?.user?.id || s.user.role !== "ADMIN") throw new Error("Chỉ quản trị mới xử lý được phiếu yêu cầu");
  return s.user;
}

// Quản trị duyệt / từ chối / đánh dấu xong phiếu. Duyệt phiếu = cho phép sửa code; trợ lý không tự sửa gì.
export async function decideAiTicketAction(id: string, status: "APPROVED" | "REJECTED" | "DONE", note: string): Promise<R> {
  try {
    await needAdmin();
    if (status === "REJECTED" && !note.trim()) return { ok: false, error: "Nhập lý do từ chối để người dùng biết" };
    const t = await prisma.aiTicket.findUnique({ where: { id } });
    if (!t) return { ok: false, error: "Không tìm thấy phiếu" };
    await prisma.aiTicket.update({ where: { id }, data: { status, adminNote: note.trim().slice(0, 2000), decidedAt: new Date(), seenByUser: false } });
    revalidatePath("/admin/yeu-cau");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Có lỗi xảy ra" };
  }
}

// Người tạo phiếu đã xem kết quả xử lý (tắt chấm báo)
export async function markAiTicketsSeenAction(): Promise<void> {
  const s = await auth();
  if (!s?.user?.id) return;
  await prisma.aiTicket.updateMany({ where: { userId: s.user.id, seenByUser: false }, data: { seenByUser: true } });
}

// Phiếu của chính người dùng (hiện trong khung trợ lý): trạng thái + ghi chú của quản trị
export async function myAiTicketsAction() {
  const s = await auth();
  if (!s?.user?.id) return [];
  const rows = await prisma.aiTicket.findMany({ where: { userId: s.user.id }, orderBy: { createdAt: "desc" }, take: 15, select: { code: true, title: true, status: true, adminNote: true, createdAt: true } });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}
