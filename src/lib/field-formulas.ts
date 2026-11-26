import { createEvaluator, isSubtotalFormula } from "@/lib/grid-formula";
import { extraAmountCols } from "@/lib/grid-amount";
import { computeBoqAmounts, type BoqAmountItem } from "@/lib/boq-amounts";
import { computeBoqTree } from "@/lib/boq-tree";
import { linkKeysOf, type GridSourceOption } from "@/lib/grid-sources-shared";
import { headingBlockEnd } from "@/lib/grid-heading";

// Công thức gõ vào ô số của TH Vật Tư / Nhân Công / Thiết Bị / Thầu Phụ (bảng FieldFormula): LINK tới giá trị BOQ
// (boq_work, từng đầu mục, kể cả sheet BOQ bổ sung) và sheet tự do (tổng / từng đầu mục) — chỉ những nguồn KHÔNG
// phụ thuộc đơn giá / chi phí, nên không bao giờ tính vòng. Sheet tự do có lấy số từ chi phí thì hiện nhưng không chọn được.
export type FormulaCtx = {
  formulas: Map<string, string>; // khoá fkey(...) → công thức
  errs: Map<string, string>; // khoá → mã lỗi (nếu công thức lỗi)
  sources: Record<string, number>;
  options: GridSourceOption[];
};

export const fkey = (kind: "price" | "manual" | "sub", targetId: string, field: string) => `${kind}:${targetId}:${field}`;

type BoqSrcItem = BoqAmountItem & { rawDescription: string; sheetId?: string | null };

export function boqOnlySources(items: BoqSrcItem[], sheetNames: Map<string, string> = new Map()): { values: Record<string, number>; options: GridSourceOption[] } {
  const values: Record<string, number> = {};
  const options: GridSourceOption[] = [];
  const amounts = computeBoqAmounts(items, () => 0, {});
  values["boq_work"] = items.filter((b) => !b.isHeading).reduce((s, b) => s + (amounts.get(b.id)?.quotedTotal ?? 0), 0);
  options.push({ value: "boq_work", label: "Giá trị gói thầu — tổng Báo giá CĐT các công tác", group: "BOQ" });
  const bySheet = new Map<string, BoqSrcItem[]>();
  for (const b of items) bySheet.set(b.sheetId ?? "", [...(bySheet.get(b.sheetId ?? "") ?? []), b]);
  for (const list of bySheet.values()) {
    const tree = computeBoqTree(list);
    for (const h of list) {
      if (!h.isHeading) continue;
      const ids = tree.scope.get(h.id) ?? [];
      if (!ids.length) continue;
      values[`boqh:${h.id}`] = ids.reduce((s, id) => s + (amounts.get(id)?.quotedTotal ?? 0), 0);
      // đầu mục của sheet BOQ bổ sung (Prelim, BPTC...) nằm trong nhóm mang tên sheet đó
      const group = (h.sheetId && sheetNames.get(h.sheetId)) || "BOQ";
      options.push({ value: `boqh:${h.id}`, label: `Đầu mục ${h.stt ? `${h.stt} ` : ""}${h.rawDescription}`.trim(), group });
    }
  }
  return { values, options };
}

export function evalFieldFormula(formula: string, sources: Record<string, number>): { v: number; err: string } {
  const ev = createEvaluator((r, c) => (r === 0 && c === 0 ? formula : ""), 1, 1, sources);
  const v = ev.valueOf(0, 0);
  if (typeof v === "number") return { v, err: "" };
  if (typeof v === "string" && v.startsWith("#")) return { v: 0, err: v };
  return { v: 0, err: "#VALUE!" };
}

export type GridSheetSrc = { id: string; name: string; colTitles: string; headerRows?: string; rowCount: number; amountCol: number | null; cells: { row: number; col: number; value: string }[]; metas: { id: string; row: number; title: string; stt: string | null; level: number }[] };

// Giá trị sheet tự do (tổng cột Thành tiền + từng đầu mục) tính chỉ với nguồn BOQ. Sheet có LINK tới nguồn khác
// (chi phí VL/NC/M, TH...) → không đưa giá trị (tránh tính vòng), chỉ hiện để người dùng biết lý do.
function gridOnlySources(grids: GridSheetSrc[], boqValues: Record<string, number>, values: Record<string, number>, options: GridSourceOption[]) {
  for (const g of grids) {
    if (g.amountCol === null) continue;
    const blocked = g.cells.some((c) => linkKeysOf(c.value).some((k) => !(k in boqValues)));
    if (blocked) {
      options.push({ value: `grid:${g.id}`, label: "Tổng cả sheet (cột Thành tiền)", group: g.name, disabled: "Sheet này có lấy số từ chi phí (TH Vật Tư / Nhân Công / Thiết Bị / Thầu Phụ...) nên không dùng được ở đây — sẽ tính vòng" });
      continue;
    }
    const titles = JSON.parse(g.colTitles) as string[];
    const raw = new Map(g.cells.map((c) => [`${c.row}:${c.col}`, c.value]));
    const ev = createEvaluator((r, c) => raw.get(`${r}:${c}`) ?? "", g.rowCount, titles.length, boqValues);
    const headingRows = new Set(g.metas.map((m) => m.row));
    const amount = (r: number, col: number) => {
      if (headingRows.has(r) || isSubtotalFormula(raw.get(`${r}:${col}`) ?? "")) return 0;
      const v = ev.valueOf(r, col);
      return typeof v === "number" ? v : 0;
    };
    // cột Thành tiền chính (grid: / gridh:) + các cột Thành tiền khác (gridc: / gridhc:) - giống grid-links.ts
    const extras = extraAmountCols(titles, g.amountCol, JSON.parse(g.headerRows || "[]") as string[][]);
    const cols = [{ col: g.amountCol, label: "", sheetKey: `grid:${g.id}`, headKey: (mid: string) => `gridh:${mid}` }, ...extras.map((x) => ({ col: x.col, label: ` — cột ${x.label}`, sheetKey: `gridc:${g.id}:${x.col}`, headKey: (mid: string) => `gridhc:${mid}:${x.col}` }))];
    const sorted = [...g.metas].sort((x, y) => x.row - y.row);
    for (const c of cols) {
      let sum = 0;
      for (let r = 0; r < g.rowCount; r++) sum += amount(r, c.col);
      values[c.sheetKey] = sum;
      options.push({ value: c.sheetKey, label: c.label ? `Tổng cả sheet${c.label}` : "Tổng cả sheet (cột Thành tiền)", group: g.name });
      sorted.forEach((m, mi) => {
        const end = headingBlockEnd(sorted, mi, g.rowCount);
        let sub = 0;
        for (let r = m.row + 1; r < end; r++) sub += amount(r, c.col);
        values[c.headKey(m.id)] = sub;
        options.push({ value: c.headKey(m.id), label: `Đầu mục "${m.title}"${c.label}`, group: g.name });
      });
    }
  }
}

export function buildFormulaCtx(
  rows: { kind: string; targetId: string; field: string; formula: string }[],
  boqItems: BoqSrcItem[],
  sheets: { boqSheets?: { id: string; name: string }[]; grids?: GridSheetSrc[] } = {}
): FormulaCtx {
  const { values, options } = boqOnlySources(boqItems, new Map((sheets.boqSheets ?? []).map((s) => [s.id, s.name])));
  gridOnlySources(sheets.grids ?? [], { ...values }, values, options);
  const formulas = new Map(rows.map((r) => [fkey(r.kind as "price", r.targetId, r.field), r.formula]));
  return { formulas, errs: new Map(), sources: values, options };
}

// Giá trị của 1 ô số: công thức (nếu có) thay cho số đã lưu; lỗi công thức → 0 và ghi vào ctx.errs
export function resolveField(ctx: FormulaCtx, key: string, stored: number): number {
  const f = ctx.formulas.get(key);
  if (!f || !f.trim().startsWith("=")) return stored;
  const r = evalFieldFormula(f.trim(), ctx.sources);
  if (r.err) ctx.errs.set(key, r.err);
  return r.v;
}

export function applyManualFormulas<T extends { id: string; quantity: number; unitPrice: number }>(items: T[], ctx: FormulaCtx): T[] {
  return items.map((m) => ({ ...m, quantity: resolveField(ctx, fkey("manual", m.id, "quantity"), m.quantity), unitPrice: resolveField(ctx, fkey("manual", m.id, "unitPrice"), m.unitPrice) }));
}
