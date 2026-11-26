// Đổi mã tài nguyên riêng của dự án dạng cũ (PJ-xxxx-...) sang mã ngắn TMN + 5 chữ số. Mọi liên kết dùng id nên không ảnh hưởng số liệu.
// Chạy: npx tsx --env-file=.env scripts/rename-project-codes.ts
import { prisma } from "../src/lib/prisma";
import { fmtTmnCode, nextTmnNumber } from "../src/lib/resource-code";

async function main() {
  const rows = await prisma.resource.findMany({ where: { code: { startsWith: "PJ-" } }, select: { id: true }, orderBy: [{ projectId: "asc" }, { name: "asc" }] });
  let n = await nextTmnNumber();
  await prisma.$transaction(rows.map((r) => prisma.resource.update({ where: { id: r.id }, data: { code: fmtTmnCode(n++) } })));
  console.log(`[rename-project-codes] Đã đổi ${rows.length} mã`);
}

main().finally(() => prisma.$disconnect());
