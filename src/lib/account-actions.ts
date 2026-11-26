"use server";

import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Người dùng tự đổi mật khẩu của mình (phải nhập đúng mật khẩu hiện tại). Không cần quyền phân hệ nào.
export async function changeOwnPasswordAction(current: string, next: string): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  const u = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, passwordHash: true } });
  if (!u) return { ok: false, error: "Không tìm thấy tài khoản" };
  if (!(await bcrypt.compare(current, u.passwordHash))) return { ok: false, error: "Mật khẩu hiện tại không đúng" };
  if (next.length < 8) return { ok: false, error: "Mật khẩu mới phải từ 8 ký tự" };
  if (next === current) return { ok: false, error: "Mật khẩu mới phải khác mật khẩu hiện tại" };
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(next, 10) } });
  return { ok: true };
}
