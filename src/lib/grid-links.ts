import { prisma } from "@/lib/prisma";
import { createEvaluator, isSubtotalFormula } from "@/lib/grid-formula";
import { headingBlockEnd } from "@/lib/grid-heading";
import { getGridSources } from "@/lib/sheet-links";
import { getProjectWithBoq } from "@/lib/project-data";
import { extraAmountCols, groupTitleOf } from "@/lib/grid-amount";

export type GridLinkOption = { value: string; label: string; short: string };
// Mỗi sheet bảng tự do (do người dùng thêm) cùng các nguồn liên kết của nó; options rỗng khi chưa chọn cột "Thành tiền"
export type GridSheetInfo = { id: string; name: string; cols: string[]; amountCol: number | null; options: { value: string; label: string }[] };

// Giá trị các nguồn liên kết từ sheet bảng tự do (GRID) có chọn cột "Thành tiền": tổng cả sheet ("grid:<id>")
// và subtotal từng đầu mục ("gridh:<metaId>"). Sheet có thêm cột "Thành tiền" khác (VD Trực tiếp phí / Chủ đầu tư)
// thì mỗi cột đó cũng là nguồn riêng: "gridc:<id>:<cột>", "gridhc:<metaId>:<cột>". Dùng chung cho DT-CP và sheet BOQ.
export async function getGridLinkValues(projectId: string, project?: Parameters<typeof getGridSources>[0]): Promise<{ values: Record<string, number>; options: GridLinkOption[]; sheets: GridSheetInfo[] }> {
  const values: Record<string, number> = {};
  const options: GridLinkOption[] = [];
  const sheets: GridSheetInfo[] = [];
  const allGrids = await prisma.projectSheet.findMany({ where: { projectId, kind: "GRID" }, orderBy: { orderIndex: "asc" }, include: { cells: true, metas: true } });
  // nguồn cho hàm LINK("khoá") trong công thức: chỉ tính khi có bảng nào dùng tới
  let sources: Record<string, number> | undefined;
  if (allGrids.some((g) => g.cells.some((c) => /LINK\(/i.test(c.value)))) {
    const proj = project ?? (await getProjectWithBoq(projectId));
    sources = proj ? (await getGridSources(proj)).values : undefined;
  }
  for (const g of allGrids) {
    const info: GridSheetInfo = { id: g.id, name: g.name, cols: JSON.parse(g.colTitles) as string[], amountCol: g.amountCol, options: [] };
    sheets.push(info);
    if (g.amountCol === null) continue;
    const raw = new Map(g.cells.map((c) => [`${c.row}:${c.col}`, c.value]));
    const ev = createEvaluator((r, c) => raw.get(`${r}:${c}`) ?? "", g.rowCount, info.cols.length, sources);
    const headingRows = new Set(g.metas.map((m) => m.row));
    const amount = (r: number, col: number) => {
      if (headingRows.has(r) || isSubtotalFormula(raw.get(`${r}:${col}`) ?? "")) return 0;
      const v = ev.valueOf(r, col);
      return typeof v === "number" ? v : 0;
    };
    const headerRows = JSON.parse(g.headerRows) as string[][];
    const extras = extraAmountCols(info.cols, g.amountCol, headerRows);
    // cột chính giữ khoá cũ (grid: / gridh:) để liên kết đã chọn trước đây không đổi
    const cols = [
      { col: g.amountCol, label: extras.length ? `${info.cols[g.amountCol].trim() || "Thành tiền"}${groupTitleOf(headerRows, g.amountCol) ? ` (${groupTitleOf(headerRows, g.amountCol)})` : ""}` : "Thành tiền", sheetKey: `grid:${g.id}`, headKey: (mid: string) => `gridh:${mid}` },
      ...extras.map((x) => ({ col: x.col, label: x.label, sheetKey: `gridc:${g.id}:${x.col}`, headKey: (mid: string) => `gridhc:${mid}:${x.col}` })),
    ];
    const sortedMetas = [...g.metas].sort((x, y) => x.row - y.row);
    for (const c of cols) {
      const colLabel = extras.length ? ` — cột ${c.label}` : "";
      let sum = 0;
      for (let r = 0; r < g.rowCount; r++) sum += amount(r, c.col);
      values[c.sheetKey] = sum;
      options.push({ value: c.sheetKey, label: `Sheet "${g.name}" — tổng cột ${c.label}`, short: `${g.name}${extras.length ? ` · ${c.label}` : ""}` });
      info.options.push({ value: c.sheetKey, label: `Tổng cả sheet (cột ${c.label})` });
      for (let mi = 0; mi < sortedMetas.length; mi++) {
        const m = sortedMetas[mi];
        // đầu mục cha cộng cả các dòng nằm trong đầu mục con của nó
        const end = headingBlockEnd(sortedMetas, mi, g.rowCount);
        let sub = 0;
        for (let r = m.row + 1; r < end; r++) sub += amount(r, c.col);
        values[c.headKey(m.id)] = sub;
        options.push({ value: c.headKey(m.id), label: `Sheet "${g.name}" › đầu mục "${m.title}"${colLabel}`, short: `${g.name} › ${m.title}${extras.length ? ` · ${c.label}` : ""}` });
        info.options.push({ value: c.headKey(m.id), label: `Đầu mục "${m.title}"${colLabel}` });
      }
    }
  }
  return { values, options, sheets };
}
