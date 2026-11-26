import ExcelJS from "exceljs";
import { loadSheets } from "./xlsx-subset";

// Bản chụp CÓ CẤU TRÚC của 1 sheet Excel (DT-CP / BOQ / CHI TIẾT của file DT-CP cũ) để vẽ lại theo giao diện phần mềm (sheet-view-model.ts):
// mọi dòng, mọi cột có dữ liệu như file; ô gộp (colspan / rowspan); số kèm kiểu hiển thị (số lẻ, %); cột / dòng ẩn; độ rộng cột.
// Chỉ phụ thuộc exceljs (không dùng alias @/) để chạy thử độc lập bằng node.

// Ô: null = trống · chuỗi / số = giá trị · object khi có thêm thông tin
//   v giá trị · d số chữ số lẻ khi hiện · p = phần trăm (v là tỷ lệ, hiện v×100%) · b đậm · i nghiêng
//   cs / rs = gộp ngang / dọc (ô gốc) · s = ô nằm trong vùng gộp (không vẽ)
export type SnapCell = null | string | number | { v?: string | number; d?: number; p?: 1; b?: 1; i?: 1; cs?: number; rs?: number; s?: 1 };
export type SheetSnap = { v: 2; cols: { w: number; hidden?: boolean }[]; rows: { c: SnapCell[]; hidden?: boolean }[] };

const MAX_COLS = 80;
const EMPTY_RUN = 500; // dừng sau từng ấy dòng trống liên tiếp (định dạng thừa của Excel)

const colNum = (letters: string) => letters.split("").reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0);

// số chữ số lẻ + phần trăm từ mã định dạng số của Excel
export function numFmtInfo(fmt: string | undefined): { d?: number; p?: boolean } {
  if (!fmt || /^general$/i.test(fmt)) return {};
  const first = fmt.split(";")[0];
  const p = first.includes("%");
  const m = /0\.(0+|#+)/.exec(first.replace(/\[[^\]]*\]/g, ""));
  const d = m ? m[1].length : /[0#]/.test(first.replace(/\[[^\]]*\]/g, "")) ? 0 : undefined;
  return { d, p: p || undefined };
}

function cellValue(cell: ExcelJS.Cell): string | number | null {
  const v = cell.value as unknown;
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim() || null;
  if (v instanceof Date) return v.toLocaleDateString("vi-VN", { timeZone: "UTC" });
  if (typeof v === "object") {
    const o = v as { richText?: { text: string }[]; result?: unknown; text?: unknown; error?: string };
    if (o.richText) return o.richText.map((t) => t.text).join("").replace(/\s+/g, " ").trim() || null;
    if ("result" in o) {
      const r = o.result;
      if (typeof r === "number") return Number.isFinite(r) ? r : null;
      if (typeof r === "string") return r.replace(/\s+/g, " ").trim() || null;
      if (r instanceof Date) return r.toLocaleDateString("vi-VN", { timeZone: "UTC" });
      return null;
    }
    if (typeof o.text === "string") return o.text.replace(/\s+/g, " ").trim() || null;
  }
  return null;
}

export function snapshotSheet(ws: ExcelJS.Worksheet): SheetSnap {
  // vùng gộp
  const merges: { r1: number; c1: number; r2: number; c2: number }[] = [];
  for (const a of (ws.model as unknown as { merges?: string[] }).merges ?? []) {
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(a);
    if (m) merges.push({ c1: colNum(m[1]), r1: Number(m[2]), c2: colNum(m[3]), r2: Number(m[4]) });
  }
  const masterAt = new Map<string, (typeof merges)[number]>();
  const covered = new Set<string>();
  for (const g of merges)
    for (let r = g.r1; r <= g.r2; r++)
      for (let c = g.c1; c <= g.c2; c++) {
        if (r === g.r1 && c === g.c1) masterAt.set(`${r},${c}`, g);
        else covered.add(`${r},${c}`);
      }

  const nCols = Math.min(Math.max(ws.columnCount, 1), MAX_COLS);
  const rows: SheetSnap["rows"] = [];
  let lastRow = 0;
  let lastCol = 0;
  for (let r = 1; r <= ws.rowCount; r++) {
    if (r - lastRow > EMPTY_RUN) break;
    const row = ws.getRow(r);
    const c: SnapCell[] = [];
    for (let k = 1; k <= nCols; k++) {
      if (covered.has(`${r},${k}`)) {
        c.push({ s: 1 });
        continue;
      }
      const cell = row.getCell(k);
      const v = cellValue(cell);
      const g = masterAt.get(`${r},${k}`);
      if (v == null && !g) {
        c.push(null);
        continue;
      }
      const { d, p } = typeof v === "number" ? numFmtInfo(cell.numFmt) : ({} as { d?: number; p?: boolean });
      const b = cell.font?.bold ? 1 : undefined;
      const i = cell.font?.italic ? 1 : undefined;
      const cs = g && g.c2 > g.c1 ? Math.min(g.c2, nCols) - g.c1 + 1 : undefined;
      const rs = g && g.r2 > g.r1 ? g.r2 - g.r1 + 1 : undefined;
      if (typeof v === "string" && !b && !i && !cs && !rs) c.push(v);
      else if (typeof v === "number" && d === undefined && !p && !b && !i && !cs && !rs) c.push(v);
      else c.push({ v: v ?? undefined, d, p: p ? 1 : undefined, b, i, cs, rs });
      if (v != null) {
        lastRow = r;
        lastCol = Math.max(lastCol, k + (cs ? cs - 1 : 0));
      }
    }
    rows.push({ c, hidden: row.hidden || undefined });
  }
  const used = Math.min(Math.max(lastCol, 1), nCols);
  const cols = Array.from({ length: used }, (_, i) => {
    const col = ws.getColumn(i + 1);
    return { w: col.width && col.width > 0 ? col.width : 9, hidden: col.hidden || undefined };
  });
  return { v: 2, cols, rows: rows.slice(0, lastRow).map((x) => ({ ...x, c: x.c.slice(0, used) })) };
}

export async function snapshotSheetsV2(buf: ArrayBuffer, names: string[], wbIn?: ExcelJS.Workbook): Promise<{ name: string; snap: SheetSnap }[]> {
  const wb = wbIn ?? (await loadSheets(buf, names));
  const out: { name: string; snap: SheetSnap }[] = [];
  for (const name of names) {
    const ws = wb.getWorksheet(name);
    if (ws) out.push({ name, snap: snapshotSheet(ws) });
  }
  return out;
}

// Dữ liệu chụp bản cũ (mảng giá trị thô, chưa có ô gộp / độ rộng cột) → cùng định dạng mới (v2) để vẽ và chỉnh sửa được
export function toSnapV2(raw: unknown): SheetSnap {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && (raw as SheetSnap).v === 2) return raw as SheetSnap;
  const rows = (Array.isArray(raw) ? raw : []) as (string | number | null)[][];
  const width = Math.max(1, ...rows.map((r) => r.length));
  return { v: 2, cols: Array.from({ length: width }, (_, i) => ({ w: i === 1 ? 50 : 14 })), rows: rows.map((r) => ({ c: Array.from({ length: width }, (_, j) => (r[j] ?? null) as SnapCell) })) };
}
