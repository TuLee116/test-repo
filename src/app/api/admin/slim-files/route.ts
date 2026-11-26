import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAccess } from "@/lib/access";
import { slimXlsx } from "@/lib/xlsx-slim";
import { getFile, putFile } from "@/lib/file-store";

// QUẢN TRỊ: thu gọn các file Excel gốc đã lưu trong CSDL (bỏ sheet thừa, hình ảnh). Mở đường dẫn này khi đã đăng nhập bằng tài khoản quản trị.
// Mỗi file chỉ giữ sheet của chính hồ sơ + các hồ sơ dùng chung file. Chạy lại nhiều lần vẫn an toàn.
export async function GET() {
  const a = await getAccess();
  if (!a?.isAdmin) return NextResponse.json({ ok: false, error: "Chỉ quản trị" }, { status: 403 });
  let before = 0;
  let after = 0;
  let done = 0;
  let failed = 0;

  const subs = await prisma.priceSubmission.findMany({ select: { id: true, sheetName: true, fileFromId: true } });
  const own = await prisma.priceSubmission.findMany({ where: { OR: [{ fileData: { not: null } }, { fileKey: { not: null } }] }, select: { id: true } });
  for (const { id } of own) {
    try {
      const keep = subs.filter((s) => s.id === id || s.fileFromId === id).map((s) => s.sheetName).filter(Boolean) as string[];
      const row = await prisma.priceSubmission.findUnique({ where: { id }, select: { fileData: true, fileKey: true } });
      const file = row ? row.fileData ?? (await getFile(row.fileKey)) : null;
      if (!file || !keep.length) continue;
      const slim = await slimXlsx(file, keep);
      before += file.length;
      after += slim.length;
      if (slim.length < file.length) await prisma.priceSubmission.update({ where: { id }, data: { fileData: null, fileKey: await putFile(slim) } });
      done++;
    } catch {
      failed++;
    }
  }

  const sp = await prisma.subProposal.findMany({ where: { OR: [{ fileData: { not: null } }, { fileKey: { not: null } }] }, select: { id: true } });
  for (const { id } of sp) {
    try {
      const row = await prisma.subProposal.findUnique({ where: { id }, select: { fileData: true, fileKey: true, sheetName: true } });
      const file = row ? row.fileData ?? (await getFile(row.fileKey)) : null;
      if (!row || !file || !row.sheetName) continue;
      const slim = await slimXlsx(file, [row.sheetName]);
      before += file.length;
      after += slim.length;
      if (slim.length < file.length) await prisma.subProposal.update({ where: { id }, data: { fileData: null, fileKey: await putFile(slim) } });
      done++;
    } catch {
      failed++;
    }
  }
  const mb = (n: number) => Math.round((n / 1048576) * 100) / 100;
  return NextResponse.json({ ok: true, files: done, failed, beforeMB: mb(before), afterMB: mb(after) });
}
