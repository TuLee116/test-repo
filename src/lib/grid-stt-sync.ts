import { prisma } from "@/lib/prisma";
import { computeAutoStt, effectiveAutoStt } from "@/lib/grid-auto-stt";

// Ghi lại cột STT (cột đầu) của bảng tự do cho khớp với các dòng đã có tên công việc (cột thứ 2). Gọi sau mỗi thay đổi nội dung /
// chèn / xoá / chuyển dòng cột. Bảng không bật tự đánh số thì không làm gì. Trả về true nếu có ô được ghi lại.
export async function syncGridStt(sheetId: string): Promise<boolean> {
  const sheet = await prisma.projectSheet.findUnique({ where: { id: sheetId }, include: { cells: { where: { col: { in: [0, 1] } } }, metas: true } });
  if (!sheet || sheet.kind !== "GRID") return false;
  const titles = JSON.parse(sheet.colTitles) as string[];
  if (!effectiveAutoStt(sheet.autoStt, titles[0], titles.length)) return false;
  const byKey = new Map(sheet.cells.map((c) => [`${c.row}:${c.col}`, c]));
  const want = computeAutoStt(sheet.rowCount, new Set(sheet.metas.map((m) => m.row)), (r) => byKey.get(`${r}:1`)?.value ?? "");
  const ops = [];
  for (const [r, v] of want) {
    const cur = byKey.get(`${r}:0`);
    if ((cur?.value ?? "") === v) continue;
    if (cur) {
      if (v === "" && cur.style === "") ops.push(prisma.gridCell.delete({ where: { id: cur.id } }));
      else ops.push(prisma.gridCell.update({ where: { id: cur.id }, data: { value: v } }));
    } else if (v !== "") ops.push(prisma.gridCell.create({ data: { sheetId, row: r, col: 0, value: v } }));
  }
  if (ops.length) await prisma.$transaction(ops);
  return ops.length > 0;
}
