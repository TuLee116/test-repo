"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { runDbBackup } from "@/lib/db-backup";

// QUẢN TRỊ bấm "Sao lưu ngay" (Quản trị → Người dùng → Sao lưu dữ liệu)
export async function backupNowAction() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") throw new Error("Chỉ quản trị viên mới sao lưu được");
  await runDbBackup(`bấm tay — ${session.user.name ?? "quản trị"}`);
  revalidatePath("/admin/users");
}
