// Sheet bảng tự do (GRID) chưa chọn cột "Thành tiền" mà có cột tên "Thành tiền" → tự chọn cột đó, để đầu mục có
// tổng và cuối bảng có dòng TỔNG CỘNG (27/10/2026). Chạy 1 lần: npx tsx --env-file=.env scripts/detect-grid-amount.ts
import { prisma } from "../src/lib/prisma";
import { detectAmountCol } from "../src/lib/grid-amount";

async function main() {
  const sheets = await prisma.projectSheet.findMany({ where: { kind: "GRID", amountCol: null }, select: { id: true, name: true, colTitles: true } });
  for (const s of sheets) {
    const col = detectAmountCol(JSON.parse(s.colTitles) as string[]);
    if (col === null) continue;
    await prisma.projectSheet.update({ where: { id: s.id }, data: { amountCol: col } });
    console.log(`[detect-grid-amount] ${s.name}: cột ${col + 1}`);
  }
}
main().catch((e) => {
  console.error("[detect-grid-amount]", e);
  process.exit(1);
});
