// CHUYỂN FILE GỐC (Excel) đang nằm trong CSDL ra KHO FILE (src/lib/file-store.ts) — chạy 1 lần (23/11/2026), chạy lại vẫn an toàn.
// Mỗi hồ sơ: ghi file ra kho → lưu fileKey → xoá bản trong CSDL. Đọc lại file từ kho để so khớp trước khi xoá.
//   npx tsx scripts/move-files-out.ts
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getFile, putFile } from "../src/lib/file-store";

const same = (a: Uint8Array, b: Uint8Array | null) => !!b && a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

(async () => {
  let n = 0;
  let bytes = 0;
  for (const { id } of await prisma.priceSubmission.findMany({ where: { fileData: { not: null } }, select: { id: true } })) {
    const r = await prisma.priceSubmission.findUnique({ where: { id }, select: { fileData: true } });
    if (!r?.fileData) continue;
    const key = await putFile(r.fileData);
    if (!same(r.fileData, await getFile(key))) throw new Error(`File hồ sơ giá đội ${id} ghi ra kho bị sai`);
    await prisma.priceSubmission.update({ where: { id }, data: { fileKey: key, fileData: null } });
    n++;
    bytes += r.fileData.length;
  }
  for (const { id } of await prisma.subProposal.findMany({ where: { fileData: { not: null } }, select: { id: true } })) {
    const r = await prisma.subProposal.findUnique({ where: { id }, select: { fileData: true } });
    if (!r?.fileData) continue;
    const key = await putFile(r.fileData);
    if (!same(r.fileData, await getFile(key))) throw new Error(`File hồ sơ thầu phụ ${id} ghi ra kho bị sai`);
    await prisma.subProposal.update({ where: { id }, data: { fileKey: key, fileData: null } });
    n++;
    bytes += r.fileData.length;
  }
  for (const { id } of await prisma.costFile.findMany({ where: { data: { not: null } }, select: { id: true } })) {
    const r = await prisma.costFile.findUnique({ where: { id }, select: { data: true } });
    if (!r?.data) continue;
    const key = await putFile(r.data);
    if (!same(r.data, await getFile(key))) throw new Error(`File DT-CP hợp đồng ${id} ghi ra kho bị sai`);
    await prisma.costFile.update({ where: { id }, data: { fileKey: key, data: null } });
    n++;
    bytes += r.data.length;
  }
  console.log(`[move-files-out] XONG: chuyển ${n} file (${(bytes / 1048576).toFixed(1)} MB) ra kho file`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error("[move-files-out] LỖI:", e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
