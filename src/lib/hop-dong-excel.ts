import ExcelJS from "exceljs";
import { parsePastedNumber } from "@/lib/parse-number";
import { lineKeyOf, type CostKind, type Version } from "@/lib/hop-dong-calc";
import { assertSheetsSize, listSheets, loadSheets, openZip } from "@/lib/xlsx-subset";

// Đọc file DT-CP Excel CŨ của hợp đồng (trước khi có phần mềm). Mỗi công trình đặt tên / bố trí sheet hơi khác nhau, nên:
//  1. analyzeDtcpWorkbook: tự ĐOÁN sheet nào là DT-CP / Nhân Công / Thầu Phụ / Vật Tư / Thiết Bị + đoán cột, kèm xem trước
//  2. người dùng xác nhận / chọn lại sheet, cột → parseDtcpWorkbook đọc các dòng theo lựa chọn đó.
// Đơn giá theo THỜI ĐIỂM: cột "ĐƠN GIÁ TĐ1", "ĐƠN GIÁ TĐ2"... (TĐ = thời điểm DT-CP); chỉ 1 cột "ĐƠN GIÁ" thì lưu ở thời điểm "0".

// 7 SHEET CƠ BẢN của DT-CP: DT-CP, BOQ (có thể nhiều sheet), CHI TIẾT, TH Vật Tư, TH Nhân Công, TH Thiết Bị, TH Thầu Phụ.
// Mọi chi phí ở sheet DT-CP phải được link từ 6 sheet còn lại; link ra sheet khác = DT-CP chưa tổng hợp đầy đủ (xem dtcpLinks).
export type Role = "DTCP" | "BOQ" | "CT" | CostKind;
export const ROLES: { value: Role; label: string }[] = [
  { value: "DTCP", label: "DT-CP (bảng tổng hợp)" },
  { value: "BOQ", label: "BOQ" },
  { value: "CT", label: "CHI TIẾT" },
  { value: "VT", label: "TH Vật Tư" },
  { value: "NC", label: "TH Nhân Công" },
  { value: "TB", label: "TH Thiết Bị" },
  { value: "TP", label: "TH Thầu Phụ" },
];

export type ColMap = { stt?: number; name?: number; unit?: number; qty?: number; amount?: number; note?: number; prices: Record<string, number> };
export type SheetInfo = {
  name: string;
  lazy?: boolean; // sheet chưa đọc nội dung (không phải 7 sheet cơ bản): chỉ đọc khi người dùng chọn dùng
  guess: Role | null;
  sure: boolean; // đoán chắc (tên sheet + có dòng tiêu đề đúng)
  headerRow: number; // 0 = không thấy dòng tiêu đề
  columns: { col: number; text: string }[]; // các ô của dòng tiêu đề (để người dùng chọn lại cột)
  colMap: ColMap;
  preview: string[][];
};
export type Analysis = { sheets: SheetInfo[]; versions: Version[]; head: { name: string; packageName: string; contractNo: string } };
export type SheetChoice = { sheet: string; headerRow: number; colMap: ColMap };
export type ParsedLine = { kind: CostKind; key: string; level: "GROUP" | "SUB" | "ITEM"; stt: string; name: string; unit: string; qty: number | null; prices: Record<string, number>; amount: number | null; note: string; sourceRow: number; vatPct?: number | null };

export const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

export function text(c: ExcelJS.Cell): string {
  const v = c.value as unknown;
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as { richText?: { text: string }[]; result?: unknown; text?: string; error?: string };
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if ("result" in o) return o.result == null || typeof o.result === "object" ? "" : String(o.result);
    if (o.text) return o.text;
    if (v instanceof Date) return v.toLocaleDateString("vi-VN");
    return "";
  }
  return String(v);
}
export function num(c: ExcelJS.Cell): number | null {
  const v = c.value as unknown;
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && v && "result" in v) {
    const r = (v as { result?: unknown }).result;
    return typeof r === "number" && Number.isFinite(r) ? r : typeof r === "string" ? parsePastedNumber(r) : null;
  }
  return parsePastedNumber(text(c));
}

function guessRole(sheetName: string): Role | null {
  const n = norm(sheetName);
  if (/^(TH )?DT ?-? ?CP\b|^DTCP/.test(n) && !n.includes("CHI TIET")) return "DTCP";
  if (n.includes("CHI TIET")) return "CT";
  if (/\bBOQ\b/.test(n) || /^\d+\s*[.)-]\s*(KET CAU|BIEN PHAP|HOAN THIEN|PHAN THAN|PHAN THO|CO DIEN|MEP|HAM|NGAM)/.test(n)) return "BOQ";
  if (n.includes("NHAN CONG")) return "NC";
  if (n.includes("THAU PHU")) return "TP";
  if (n.includes("THIET BI")) return "TB";
  if (n.includes("VAT TU")) return "VT";
  return null;
}

// Nhận diện chữ tiêu đề cột — so dạng "gọn" (bỏ dấu, bỏ khoảng trắng/dấu chấm/xuống dòng): "S T T", "Đ.V.T", "Khối\nlượng"...
const key = (s: string) => norm(s).replace(/[^A-Z0-9]/g, "");
type HeadKind = "stt" | "name" | "unit" | "qty" | "price" | "amount" | "note";
function headKind(raw: string): HeadKind | null {
  if (!raw || raw.includes(":") || raw.length > 60) return null; // bỏ dòng letterhead "Trụ sở chính: ..."
  const k = key(raw);
  if (/^(STT|TT|SOTT|SOTHUTU)$/.test(k)) return "stt";
  if (/^(DVT|DONVI|DV)/.test(k)) return "unit";
  if (/^(DONGIA|DG\d*$|DGTD)/.test(k)) return "price";
  if (/^(THANHTIEN|GIATRI|TONGTIEN|TONGCONG|TONGGIATRI|TONGTHANHTIEN|TONGCHIPHI|TONGKINHPHI)/.test(k)) return "amount"; // gồm "Tổng thành tiền"
  if (/^(KHOILUONG|SOLUONG|KL|SL)/.test(k)) return "qty";
  if (/^(GHICHU)/.test(k)) return "note";
  if (/^(NOIDUNG|TEN|DIENGIAI|MOTA|HANGMUC|CONGVIEC|CONGTAC|VATTU|VATLIEU|NHANCONG|THIETBI|CHUNGLOAI|LOAI)/.test(k)) return "name";
  return null;
}

// Dòng tiêu đề bảng TH: dò 60 dòng đầu, chấm điểm theo số loại cột nhận ra (STT, nội dung, ĐVT, KL, đơn giá, thành tiền).
// Lấy dòng điểm cao nhất (cần có cột nội dung + ít nhất 2 loại khác, hoặc 4 loại bất kỳ). Dòng tầng dưới (ĐƠN GIÁ/THÀNH TIỀN) cộng vào dòng trên.
export function findHeader(ws: ExcelJS.Worksheet): number {
  const kindsOf = (r: number) => {
    const s = new Set<HeadKind>();
    ws.getRow(r).eachCell((c) => {
      const k = headKind(text(c).replace(/\s+/g, " ").trim());
      if (k) s.add(k);
    });
    return s;
  };
  const last = Math.min(ws.rowCount, 60);
  let best = 0;
  let bestScore = 0;
  let prev = kindsOf(1);
  for (let r = 1; r <= last; r++) {
    const cur = prev;
    const next = r < last ? kindsOf(r + 1) : new Set<HeadKind>();
    prev = next;
    if (!cur.size) continue;
    const all = new Set([...cur, ...[...next].filter((k) => k === "price" || k === "amount" || k === "qty")]);
    const ok = (all.has("name") && all.size >= 3) || all.size >= 4;
    if (ok && all.size > bestScore) {
      best = r;
      bestScore = all.size;
    }
  }
  return best;
}

// Tiêu đề bảng có thể 2 TẦNG: tầng trên "THỜI ĐIỂM 1" / "THỜI ĐIỂM 2" (ô gộp), tầng dưới "ĐƠN GIÁ" / "THÀNH TIỀN".
// Trả về từng cột: tầng trên + tầng dưới (nếu khác), đọc cả ô gộp.
function headerTiers(ws: ExcelJS.Worksheet, hr: number): { col: number; top: string; sub: string }[] {
  if (!hr) return [];
  const n = Math.min(Math.max(ws.columnCount, 1), 60);
  const subRow = ws.getRow(hr + 1);
  // có tầng dưới khi dòng ngay dưới tiêu đề có chữ ĐƠN GIÁ / THÀNH TIỀN và không có số liệu
  let isSub = false;
  for (let c = 1; c <= n; c++) {
    const cell = subRow.getCell(c);
    if (typeof cell.value === "number") {
      isSub = false;
      break;
    }
    const hk = headKind(text(cell).replace(/\s+/g, " ").trim());
    if (hk === "price" || hk === "amount" || hk === "qty") isSub = true;
  }
  const out: { col: number; top: string; sub: string }[] = [];
  for (let c = 1; c <= n; c++) {
    const top = text(ws.getRow(hr).getCell(c)).replace(/\s+/g, " ").trim();
    const sub = isSub ? text(subRow.getCell(c)).replace(/\s+/g, " ").trim() : "";
    if (top || sub) out.push({ col: c, top, sub: sub && norm(sub) !== norm(top) ? sub : "" });
  }
  return out;
}

export function detectColumns(ws: ExcelJS.Worksheet, hr: number): ColMap {
  const m: ColMap = { prices: {} };
  if (!hr) return m;
  const amountBy: Record<string, number> = {};
  for (const { col, top, sub } of headerTiers(ws, hr)) {
    const t = norm(top);
    const s = norm(sub);
    // số thời điểm ở tầng trên hoặc tầng dưới: "THỜI ĐIỂM 2", "TĐ2", "ĐƠN GIÁ TĐ2"
    const v = `${t} ${s}`.match(/(?:\bTD|THOI DIEM)\s*(\d+)/);
    // tầng dưới (nếu có) quyết định loại cột cho ĐƠN GIÁ / THÀNH TIỀN / KL; tầng trên cho các cột còn lại
    const ks = headKind(sub);
    const kt = headKind(top);
    const k = ks === "price" || ks === "amount" || ks === "qty" ? ks : kt;
    if (k === "stt") m.stt ??= col;
    else if (k === "name") m.name ??= col;
    else if (k === "unit") m.unit ??= col;
    else if (k === "qty") m.qty ??= col;
    else if (k === "note") m.note ??= col;
    else if (k === "price") m.prices[v ? v[1] : "0"] ??= col;
    else if (k === "amount") {
      if (v) amountBy[v[1]] ??= col;
      else m.amount ??= col;
    }
  }
  // thành tiền theo thời điểm: lấy cột của thời điểm mới nhất
  const vs = Object.keys(amountBy).map(Number).sort((a, b) => b - a);
  if (m.amount == null && vs.length) m.amount = amountBy[String(vs[0])];
  // không thấy tiêu đề nội dung: lấy cột có nhiều chữ dài nhất trong 30 dòng dữ liệu đầu
  if (m.name == null) {
    const score: Record<number, number> = {};
    const used = new Set([m.stt, m.unit, m.qty, m.amount, m.note, ...Object.values(m.prices)]);
    for (let r = hr + 1; r <= Math.min(ws.rowCount, hr + 30); r++)
      ws.getRow(r).eachCell((c, col) => {
        const t = text(c).trim();
        if (!used.has(col) && t.length >= 8 && num(c) == null) score[col] = (score[col] ?? 0) + 1;
      });
    const top = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
    if (top) m.name = Number(top[0]);
  }
  return m;
}

function headerCells(ws: ExcelJS.Worksheet, hr: number) {
  return headerTiers(ws, hr).map((h) => ({ col: h.col, text: h.sub ? `${h.top} – ${h.sub}` : h.top }));
}

// Xem trước: giữ đúng vị trí cột (ô trống vẫn giữ chỗ) để khớp với chữ cột A, B, C...
function preview(ws: ExcelJS.Worksheet, hr: number): string[][] {
  const rows: string[][] = [];
  const from = hr ? hr : 1;
  const n = Math.min(Math.max(ws.columnCount, 1), 14);
  for (let r = from; r <= ws.rowCount && rows.length < 7; r++) {
    const cells: string[] = [];
    for (let c = 1; c <= n; c++) {
      const t = text(ws.getRow(r).getCell(c)).replace(/\s+/g, " ").trim();
      cells.push(t.length > 32 ? `${t.slice(0, 32)}…` : t);
    }
    if (cells.some(Boolean)) rows.push(cells);
  }
  // bỏ các cột trống ở cuối
  let last = 0;
  for (const row of rows) row.forEach((t, i) => t && (last = Math.max(last, i + 1)));
  return rows.map((row) => row.slice(0, last));
}

// Các THỜI ĐIỂM của DT-CP: tiêu đề "THỜI ĐIỂM 1", "THỜI ĐIỂM 2 (Đã duyệt)"... trong sheet DT-CP
function detectVersions(ws: ExcelJS.Worksheet | undefined): Version[] {
  const out: Version[] = [];
  if (!ws) return out;
  for (let r = 1; r <= Math.min(ws.rowCount, 25); r++)
    ws.getRow(r).eachCell((c) => {
      const raw = text(c).replace(/\s+/g, " ").trim();
      const m = norm(raw).match(/THOI DIEM\s*(\d+)/);
      if (m && !out.some((v) => v.n === Number(m[1]))) out.push({ n: Number(m[1]), label: raw, approved: norm(raw).includes("DA DUYET") });
    });
  return out.sort((a, b) => a.n - b.n);
}

function detectHead(ws: ExcelJS.Worksheet | undefined) {
  const head = { name: "", packageName: "", contractNo: "" };
  if (!ws) return head;
  for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
    const raw = text(ws.getRow(r).getCell(1)) || text(ws.getRow(r).getCell(2));
    const i = raw.indexOf(":");
    if (i < 0) continue;
    const label = norm(raw.slice(0, i));
    const v = raw.slice(i + 1).trim();
    if (label.includes("DU AN") || label.includes("CONG TRINH")) head.name ||= v;
    else if (label.includes("GOI THAU")) head.packageName ||= v;
    else if (label.includes("SO HD") || label.includes("HOP DONG")) head.contractNo ||= v;
  }
  return head;
}

async function load(buf: ArrayBuffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

// Chỉ đọc nội dung các sheet CẦN (đoán được vai trò theo tên + sheet người dùng từng chọn — include); sheet khác chỉ liệt kê tên (lazy), đọc khi chọn dùng
function infoOf(ws: ExcelJS.Worksheet, guess: Role | null): SheetInfo {
  const hr = findHeader(ws);
  const colMap = detectColumns(ws, hr);
  const sure = !!guess && (guess === "DTCP" || guess === "BOQ" || guess === "CT" || (!!hr && !!colMap.name && Object.keys(colMap.prices).length > 0));
  return { name: ws.name, guess, sure, headerRow: hr, columns: headerCells(ws, hr), colMap, preview: preview(ws, hr) };
}

export async function analyzeDtcpWorkbook(buf: ArrayBuffer, include: string[] = []): Promise<Analysis> {
  const zip = await openZip(buf);
  const all = (await listSheets(zip)).filter((s) => s.state === "visible");
  const taken = new Set<Role>();
  const guessOf = new Map<string, Role | null>();
  for (const s of all) {
    let g = guessRole(s.name);
    // mỗi loại chỉ đoán 1 sheet (sheet đầu tiên khớp tên), riêng BOQ có thể nhiều sheet
    if (g && g !== "BOQ" && taken.has(g)) g = null;
    if (g) taken.add(g);
    guessOf.set(s.name, g);
  }
  let need = all.filter((s) => guessOf.get(s.name) || include.includes(s.name));
  if (!need.length) need = all.slice(0, 3);
  assertSheetsSize(zip, need);
  const wb = await loadSheets(buf, need.map((s) => s.name));
  const sheets: SheetInfo[] = all.map((s) => {
    const ws = wb.getWorksheet(s.name);
    return ws ? infoOf(ws, guessOf.get(s.name) ?? null) : { name: s.name, lazy: true, guess: null, sure: false, headerRow: 0, columns: [], colMap: { prices: {} }, preview: [] };
  });
  const dt = sheets.find((s) => s.guess === "DTCP");
  const dtWs = dt ? wb.getWorksheet(dt.name) : undefined;
  return { sheets, versions: detectVersions(dtWs), head: detectHead(dtWs ?? wb.worksheets[0]) };
}

// Đọc nội dung 1 sheet (khi người dùng chọn dùng sheet chưa đọc)
export async function sheetInfo(buf: ArrayBuffer, sheet: string): Promise<SheetInfo | null> {
  const wb = await loadSheets(buf, [sheet]);
  const ws = wb.getWorksheet(sheet);
  return ws ? infoOf(ws, null) : null;
}

const ROMAN = /^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV)$/;

export async function parseDtcpWorkbook(buf: ArrayBuffer, choices: Partial<Record<CostKind, SheetChoice>>, wbIn?: ExcelJS.Workbook): Promise<ParsedLine[]> {
  const wb = wbIn ?? (await loadSheets(buf, Object.values(choices).map((c) => c?.sheet ?? "").filter(Boolean)));
  const out: ParsedLine[] = [];
  for (const [kind, ch] of Object.entries(choices) as [CostKind, SheetChoice][]) {
    const ws = ch && wb.getWorksheet(ch.sheet);
    if (!ws || !ch.colMap.name) continue;
    const m = ch.colMap;
    const seen = new Map<string, number>();
    for (let r = (ch.headerRow || 0) + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const name = text(row.getCell(m.name!)).replace(/\s+/g, " ").trim();
      if (!name) continue;
      if (norm(name).startsWith("TONG CONG")) break;
      if (norm(name) === "NOI DUNG") continue; // dòng tiêu đề lặp
      const stt = m.stt ? text(row.getCell(m.stt)).trim() : "";
      const unit = m.unit ? text(row.getCell(m.unit)).trim() : "";
      const qty = m.qty ? num(row.getCell(m.qty)) : null;
      const prices: Record<string, number> = {};
      for (const [v, col] of Object.entries(m.prices)) {
        const p = num(row.getCell(col));
        if (p != null) prices[v] = p;
      }
      const amount = m.amount ? num(row.getCell(m.amount)) : null;
      const s = stt.toUpperCase();
      // dòng khoán gọn (lot) chỉ có THÀNH TIỀN, không ĐVT / đơn giá / KL vẫn là dòng chi phí (ITEM), không phải tiêu đề
      const hasNum = qty != null || Object.keys(prices).length > 0 || (amount != null && amount !== 0);
      const level: ParsedLine["level"] = ROMAN.test(s) || /^[A-Z]\d+$/.test(s) ? "SUB" : /^[A-Z]$/.test(s) ? "GROUP" : hasNum || unit ? "ITEM" : "SUB";
      let key = lineKeyOf(name, unit);
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      if (n > 1) key = `${key}#${n}`;
      out.push({ kind, key, level, stt, name, unit, qty, prices, amount, note: m.note ? text(row.getCell(m.note)).trim() : "", sourceRow: r });
    }
  }
  return out;
}

// ---- Bản chụp sheet (DT-CP / BOQ / CHI TIẾT) để xem trên phần mềm ----
export type SheetSnap = { name: string; rows: (string | number | null)[][]; truncated: boolean };
// Chụp ĐẦY ĐỦ mọi dòng / cột có dữ liệu (không cắt). Chỉ chặn việc quét vô tận do định dạng thừa của Excel (hàng / cột trống hàng vạn ô):
// dừng sau 1.000 dòng trống liên tiếp, quét tối đa 300 cột.
const SNAP_EMPTY_RUN = 1000;
const SNAP_COLS = 300;

export async function snapshotSheets(buf: ArrayBuffer, names: string[]): Promise<SheetSnap[]> {
  const wb = await load(buf);
  const out: SheetSnap[] = [];
  for (const name of names) {
    const ws = wb.getWorksheet(name);
    if (!ws) continue;
    const nCols = Math.min(Math.max(ws.columnCount, 1), SNAP_COLS);
    const nRows = ws.rowCount;
    const rows: (string | number | null)[][] = [];
    let lastRow = 0;
    let lastCol = 0;
    for (let r = 1; r <= nRows; r++) {
      if (r - lastRow > SNAP_EMPTY_RUN) break;
      const row: (string | number | null)[] = [];
      for (let c = 1; c <= nCols; c++) {
        const cell = ws.getRow(r).getCell(c);
        const v = cell.value as unknown;
        let x: string | number | null = null;
        if (typeof v === "number") x = v;
        else if (v != null) {
          if (typeof v === "object" && v && "result" in v && typeof (v as { result?: unknown }).result === "number") x = (v as { result: number }).result;
          else {
            const t = text(cell).replace(/\s+/g, " ").trim();
            x = t === "" ? null : t;
          }
        }
        row.push(x);
        if (x != null) {
          lastRow = r;
          lastCol = Math.max(lastCol, c);
        }
      }
      rows.push(row);
    }
    out.push({ name, rows: rows.slice(0, lastRow).map((r) => r.slice(0, lastCol)), truncated: false });
  }
  return out;
}

// ---- Kiểm tra liên kết của sheet DT-CP ----
// Mọi chi phí ở DT-CP phải link từ 6 sheet cơ bản còn lại (BOQ, CHI TIẾT, TH Vật Tư / Nhân Công / Thiết Bị / Thầu Phụ).
//  - refs: các sheet mà công thức trong DT-CP trỏ tới (kể cả file Excel ngoài) → sheet nào ngoài 6 sheet cơ bản = chưa tổng hợp đầy đủ (CHẶN nhập)
//  - consts: ô THÀNH TIỀN nhập tay thành số cứng (không có công thức) → chỉ CẢNH BÁO
export type LinkRef = { sheet: string; external: boolean; count: number; cells: string[] };
export type LinkReport = { refs: LinkRef[]; consts: { cell: string; value: number }[] };

export async function dtcpLinks(buf: ArrayBuffer, sheet: string, wbIn?: ExcelJS.Workbook): Promise<LinkReport> {
  const wb = wbIn ?? (await loadSheets(buf, [sheet]));
  const ws = wb.getWorksheet(sheet);
  const map = new Map<string, LinkRef>();
  const consts: { cell: string; value: number }[] = [];
  if (!ws) return { refs: [], consts };
  const me = norm(sheet);
  const nCols = Math.min(Math.max(ws.columnCount, 1), 60);
  const nRows = Math.min(ws.rowCount, 1500);
  const REF = /(?:'((?:[^']|'')+)'|([A-Za-z0-9_.À-ỹ]+))!/g;
  const amountCols: number[] = [];
  let headerRow = 0;
  for (let r = 1; r <= Math.min(nRows, 40) && !amountCols.length; r++) {
    for (let c = 1; c <= nCols; c++) if (norm(text(ws.getRow(r).getCell(c))).startsWith("THANH TIEN")) amountCols.push(c);
    if (amountCols.length) headerRow = r;
  }
  for (let r = 1; r <= nRows; r++) {
    for (let c = 1; c <= nCols; c++) {
      const cell = ws.getRow(r).getCell(c);
      const v = cell.value as unknown;
      if (v == null || typeof v !== "object") {
        if (typeof v === "number" && r > headerRow && amountCols.includes(c) && Math.abs(v) >= 1000 && consts.length < 40) consts.push({ cell: cell.address, value: v });
        continue;
      }
      const o = v as { formula?: string; sharedFormula?: string };
      const f = o.formula ?? o.sharedFormula;
      if (!f) continue;
      const stripped = f.replace(/"[^"]*"/g, '""');
      let m: RegExpExecArray | null;
      REF.lastIndex = 0;
      while ((m = REF.exec(stripped))) {
        let name = (m[1] ?? m[2] ?? "").replace(/''/g, "'");
        const external = /^\[\d+\]/.test(name);
        name = name.replace(/^\[\d+\]/, "");
        if (!external && norm(name) === me) continue;
        const key = `${external ? "ext:" : ""}${norm(name)}`;
        const cur = map.get(key) ?? { sheet: name, external, count: 0, cells: [] };
        cur.count++;
        if (cur.cells.length < 6 && !cur.cells.includes(cell.address)) cur.cells.push(cell.address);
        map.set(key, cur);
      }
    }
  }
  return { refs: [...map.values()].sort((a, b) => b.count - a.count), consts };
}

// Sheet bị công thức DT-CP trỏ tới nhưng KHÔNG thuộc 6 sheet cơ bản đã chọn (hoặc là file Excel ngoài)
export function linkViolations(report: LinkReport, allowed: string[]): LinkRef[] {
  const ok = new Set(allowed.filter(Boolean).map(norm));
  return report.refs.filter((r) => r.external || !ok.has(norm(r.sheet)));
}

export async function sheetColumns(buf: ArrayBuffer, sheet: string, headerRow: number) {
  const wb = await loadSheets(buf, [sheet]);
  const ws = wb.getWorksheet(sheet);
  if (!ws) return { columns: [], colMap: { prices: {} } as ColMap, preview: [] as string[][] };
  return { columns: headerCells(ws, headerRow), colMap: detectColumns(ws, headerRow), preview: preview(ws, headerRow) };
}
