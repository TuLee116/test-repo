import ExcelJS from "exceljs";
import { fixXlsx } from "@/lib/excel-fix";
import { applyStandardStyle } from "@/lib/excel-style";
import { PRICE_TEMPLATE_B64 } from "@/lib/price-template";
import { applyRowEdits, colHidden, rowHidden, sheetVisible } from "@/lib/excel-rows";
export { shiftFormulaRows } from "@/lib/excel-rows";
import { parsePastedNumber } from "@/lib/parse-number";
import { apprAmountOf, approvedPriceOf, categoryLabel, hasFormula, opinionOf, savedTotals } from "@/lib/gia-doi-calc";
import { XL_TARGET_FIELDS, XL_TOTAL_FIELDS, type XlSheetData } from "@/lib/gia-doi-xl-import";

// Đọc / xuất file Excel "ĐỀ XUẤT ĐƠN GIÁ TỔ ĐỘI" theo mẫu phòng (Mẫu ĐTKSTT- ĐXĐGĐ 01/2020), 2 trường hợp:
//  - IN : sheet "ĐƠN GIÁ ĐỘI TRÌNH DUYỆT"   (CĐT | GIÁ CƠ SỞ ĐỀ XUẤT | GIÁ ĐỀ XUẤT CỦA CÔNG TRÌNH)
//  - OUT: sheet "ĐỀ XUẤT ĐƠN GIÁ NGOÀI HĐ PL" (CĐT dự kiến | Đơn giá DT-CP | GIÁ ĐỀ XUẤT CỦA CÔNG TRÌNH | GIÁ ĐỀ XUẤT CỦA P.ĐT-TT)
// Cột được nhận theo CHỮ TIÊU ĐỀ (không theo vị trí cố định) nên file chèn / bớt cột vẫn đọc đúng.

export type HeadField = "projectName" | "contractNo" | "projectCode" | "itemName" | "quoteStatus" | "batch";
export type LineField =
  | "stt" | "content" | "unit" | "qty" | "cdtPrice" | "cdtAmount" | "basePrice" | "baseAmount" | "baseNote"
  | "siteOpinion" | "sitePrice" | "siteAmount" | "siteNote" | "ptOpinion" | "ptPrice" | "ptAmount" | "ptNote";

export type ParsedLine = {
  sourceRow: number;
  level: "GROUP" | "SUB" | "ITEM" | "NOTE";
  stt: string;
  content: string;
  unit: string;
  qty: number | null;
  cdtPrice: number | null;
  cdtAmount: number | null;
  basePrice: number | null;
  baseAmount: number | null;
  baseNote: string;
  siteOpinion: string;
  sitePrice: number | null;
  siteAmount: number | null;
  siteNote: string;
  ptOpinion: string;
  ptPrice: number | null;
  ptAmount: number | null;
  ptNote: string;
};

export type ParsedSheet = {
  sheetName: string;
  kind: "IN" | "OUT";
  head: Record<HeadField, string> & { batchDate: string };
  headRows: Record<string, number>; // field đầu file / "header" / "total" / "opinion" → số dòng
  colMap: Partial<Record<LineField, number>>;
  lines: ParsedLine[];
  itemCount: number;
  xl: XlSheetData; // công thức Excel gốc (A1) của các ô số + dòng TỔNG CỘNG — đổi sang dạng của phần mềm lúc lưu hồ sơ
};

const NUM_FIELDS = ["qty", "cdtPrice", "cdtAmount", "basePrice", "baseAmount", "sitePrice", "siteAmount", "ptPrice", "ptAmount"] as const;
const TEXT_FIELDS = ["baseNote", "siteOpinion", "siteNote", "ptOpinion", "ptNote"] as const;

export const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

function cellText(c: ExcelJS.Cell): string {
  const v = c.value as unknown;
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as { richText?: { text: string }[]; result?: unknown; text?: string };
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if ("result" in o) return o.result == null ? "" : String(o.result);
    if (o.text) return o.text;
    if (v instanceof Date) return v.toLocaleDateString("vi-VN");
    return "";
  }
  return String(v);
}

function cellNum(c: ExcelJS.Cell): number | null {
  const v = c.value as unknown;
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "object" && v && "result" in v) {
    const r = (v as { result?: unknown }).result;
    return typeof r === "number" ? r : typeof r === "string" ? parsePastedNumber(r) : null;
  }
  return parsePastedNumber(cellText(c));
}

// Chữ giữ chỗ trong mẫu ("………………", "....") coi như trống
const clean = (s: string) => (/^[\s.…_-]*$/.test(s) ? "" : s.replace(/[.…]{3,}/g, "").trim());

const ROMAN = /^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV)$/;

function mapColumns(ws: ExcelJS.Worksheet, r: number): Partial<Record<LineField, number>> {
  const m: Partial<Record<LineField, number>> = {};
  const set = (f: LineField, c: number) => {
    if (m[f] == null) m[f] = c;
  };
  const top = ws.getRow(r);
  const sub = ws.getRow(r + 1);
  const n = Math.max(ws.columnCount, 30);
  for (let c = 1; c <= n; c++) {
    if (colHidden(ws, c)) continue;
    const t = norm(cellText(top.getCell(c)));
    const s = norm(cellText(sub.getCell(c)));
    if (!t && !s) continue;
    if (t === "STT") set("stt", c);
    else if (t.startsWith("NOI DUNG")) set("content", c);
    else if (t === "DVT") set("unit", c);
    // mẫu có cột "Khối lượng" đề xuất riêng (sau khối Chủ đầu tư): khối lượng của dòng = cột này, không phải KL hợp đồng CĐT
    else if (t.startsWith("KHOI LUONG")) m.qty = c;
    else if (t.includes("CHU DAU TU")) {
      if (s.includes("KHOI LUONG")) set("qty", c);
      else if (s.includes("DON GIA")) set("cdtPrice", c);
      else if (s.includes("THANH TIEN")) set("cdtAmount", c);
    } else if (t.includes("GIA CO SO")) {
      if (s.includes("DON GIA")) set("basePrice", c);
      else if (s.includes("THANH TIEN")) set("baseAmount", c);
      else if (s.includes("GHI CHU")) set("baseNote", c);
    } else if (t.includes("CONG TRINH")) {
      if (s.includes("Y KIEN")) set("siteOpinion", c);
      else if (s.includes("DON GIA")) set("sitePrice", c);
      else if (s.includes("THANH TIEN")) set("siteAmount", c);
      else if (s.includes("GHI CHU")) set("siteNote", c);
    } else if (t.includes("DT-TT") || t.includes("DT TT")) {
      if (s.includes("Y KIEN")) set("ptOpinion", c);
      else if (s.includes("DON GIA")) set("ptPrice", c);
      else if (s.includes("THANH TIEN")) set("ptAmount", c);
      else if (s.includes("GHI CHU")) set("ptNote", c);
    } else if (t.includes("DT-CP") || t.includes("DTCP")) set("basePrice", c);
  }
  return m;
}

function parseSheet(ws: ExcelJS.Worksheet): ParsedSheet | null {
  // dòng tiêu đề bảng: có ô "STT" và ô "NỘI DUNG"
  let hr = 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 60) && !hr; r++) {
    if (rowHidden(ws, r)) continue;
    const texts: string[] = [];
    ws.getRow(r).eachCell((c, col) => {
      if (!colHidden(ws, col)) texts.push(norm(cellText(c)));
    });
    if (texts.includes("STT") && texts.some((t) => t.startsWith("NOI DUNG"))) hr = r;
  }
  if (!hr) return null;
  const colMap = mapColumns(ws, hr);
  if (!colMap.content) return null;
  const kind: "IN" | "OUT" = colMap.ptPrice != null || colMap.ptOpinion != null || norm(ws.name).includes("NGOAI") ? "OUT" : "IN";

  // thông tin đầu file: các dòng "NHÃN : giá trị" phía trên bảng
  const head = { projectName: "", contractNo: "", projectCode: "", itemName: "", quoteStatus: "", batch: "", batchDate: "" };
  const headRows: Record<string, number> = { header: hr };
  // Mỗi dòng có thể có nhiều cặp "NHÃN : giá trị" (VD cột C-D là "CÔNG TRÌNH" | ": CHUNG CƯ ÁNH DƯƠNG") → đọc mọi cặp từ trái
  // qua phải, cặp sau có giá trị thì ghi đè cặp trước. Dòng / cột ẩn (VD cột A ẩn còn sót "CÔNG TRÌNH : Công Viên 2B-1") bỏ qua.
  const fieldOf = (label: string): HeadField | null =>
    label.includes("TINH TRANG")
      ? "quoteStatus"
      : label.includes("MA SO")
        ? "projectCode"
        : label.includes("HOP DONG")
          ? "contractNo"
          : label.includes("HANG MUC")
            ? "itemName"
            : label === "DOT"
              ? "batch"
              : label.includes("CONG TRINH")
                ? "projectName"
                : null;
  const lastCol = Math.min(Math.max(ws.columnCount, 6), 20);
  for (let r = 1; r < hr; r++) {
    if (rowHidden(ws, r)) continue;
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= lastCol; c++) {
      const cell = row.getCell(c);
      cells[c] = colHidden(ws, c) || (cell.isMerged && cell.master !== cell) ? "" : cellText(cell).trim();
    }
    for (let c = 1; c <= lastCol; c++) {
      const raw = cells[c];
      if (!raw || raw.length > 80) continue;
      const i = raw.indexOf(":");
      const f = fieldOf(norm(i >= 0 ? raw.slice(0, i) : raw));
      if (!f) continue;
      let value = i >= 0 ? raw.slice(i + 1).trim() : "";
      let valCol = c; // cột chứa giá trị (cùng ô với nhãn "NHÃN : giá trị", hoặc ô kế bên)
      if (!value) {
        // giá trị ở ô kế bên (có thể bắt đầu bằng dấu ":")
        for (let k = c + 1; k <= lastCol; k++) {
          if (!cells[k]) continue;
          if (fieldOf(norm(cells[k].split(":")[0])) && cells[k].indexOf(":") !== 0) break; // gặp nhãn khác
          value = cells[k].replace(/^s*:s*/, "").trim();
          valCol = k;
          break;
        }
      }
      headRows[f] = r;
      headRows[`${f}:col`] = c;
      headRows[`${f}:val`] = valCol;
      if (f === "batch") {
        const m = value.match(/^(.*?)(s*Ng[aà]ys*:?s*(.*?))s*$/i);
        const bv = clean(m ? m[1] : value);
        if (bv || !head.batch) head.batch = bv;
        const bd = clean(m ? m[2] : "");
        if (bd || !head.batchDate) head.batchDate = bd;
      } else {
        const v = clean(value);
        if (v) head[f] = v;
      }
    }
  }

  const lines: ParsedLine[] = [];
  const xl: XlSheetData = { lines: {} };
  const formulaOf = (c: ExcelJS.Cell | null) => (c && typeof c.formula === "string" && c.formula ? c.formula : "");
  const get = (row: ExcelJS.Row, f: LineField) => (colMap[f] ? row.getCell(colMap[f]!) : null);
  for (let r = hr + 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const content = cellText(get(row, "content")!).trim();
    if (norm(content).startsWith("TONG CONG")) {
      headRows.total = r;
      const tf: NonNullable<XlSheetData["total"]>["formulas"] = {};
      for (const f of XL_TOTAL_FIELDS) {
        const fx = formulaOf(get(row, f));
        if (fx) tf[f] = fx;
      }
      const tv = (f: (typeof XL_TOTAL_FIELDS)[number]) => {
        const c = get(row, f);
        return c ? cellNum(c) : null;
      };
      xl.total = { row: r, formulas: tf, amounts: { cdt: tv("cdtAmount"), base: tv("baseAmount"), site: tv("siteAmount") } };
      break;
    }
    if (rowHidden(ws, r)) continue; // dòng ẩn: không đọc
    const stt = colMap.stt ? cellText(row.getCell(colMap.stt)).trim() : "";
    const l: ParsedLine = {
      sourceRow: r,
      level: "ITEM",
      stt,
      content,
      unit: colMap.unit ? cellText(row.getCell(colMap.unit)).trim() : "",
      qty: null, cdtPrice: null, cdtAmount: null, basePrice: null, baseAmount: null, baseNote: "",
      siteOpinion: "", sitePrice: null, siteAmount: null, siteNote: "", ptOpinion: "", ptPrice: null, ptAmount: null, ptNote: "",
    };
    for (const f of NUM_FIELDS) {
      const c = get(row, f);
      if (c) l[f] = cellNum(c);
    }
    for (const f of TEXT_FIELDS) {
      const c = get(row, f);
      if (c) l[f] = cellText(c).trim();
    }
    const hasNum = NUM_FIELDS.some((f) => l[f] != null);
    if (!content && !hasNum) continue; // dòng trống / chỉ có số thứ tự
    // chữ HOA (A, B / I, II) mới là ĐẦU MỤC LỚN; chữ thường a, b, i, ii là dòng công việc con (trước đây đổi hết sang chữ hoa nên a, b bị nhận nhầm là đầu mục)
    const s = stt.trim();
    const lf: Partial<Record<(typeof XL_TARGET_FIELDS)[number], string>> = {};
    for (const f of XL_TARGET_FIELDS) {
      const fx = formulaOf(get(row, f));
      if (fx) lf[f] = fx;
    }
    if (Object.keys(lf).length) xl.lines[r] = lf;
    l.level = ROMAN.test(s) ? "SUB" : /^[A-Z]$/.test(s) ? "GROUP" : !stt && !l.unit && l.qty == null ? "NOTE" : "ITEM";
    lines.push(l);
  }
  // ô "Ý kiến của Phòng ĐT-KS-TT" ở chân bảng (để ghi ý kiến QSTT / TP khi xuất)
  for (let r = (headRows.total ?? hr) + 1; r <= ws.rowCount; r++) {
    ws.getRow(r).eachCell((c, col) => {
      if (!headRows.opinion && norm(cellText(c)).includes("Y KIEN CUA PHONG")) {
        headRows.opinion = r;
        headRows.opinionCol = col;
      }
    });
  }
  const itemCount = lines.filter((l) => l.level === "ITEM").length;
  return { sheetName: ws.name, kind, head, headRows, colMap, lines, itemCount, xl };
}

// Đọc file: trả về các sheet đúng mẫu CÓ dữ liệu (ít nhất 1 dòng công việc). Sheet bị ẩn bỏ qua.
export async function parsePriceWorkbook(buf: ArrayBuffer): Promise<ParsedSheet[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb.worksheets
    .filter(sheetVisible)
    .map(parseSheet)
    .filter((s): s is ParsedSheet => !!s && s.itemCount > 0);
}

// ---------- Xuất lại file Excel đúng mẫu kèm kết quả duyệt ----------
type ExportSub = {
  kind: string;
  sheetName: string;
  fileData: Uint8Array | null;
  colMap: string;
  headRows: string;
  projectName: string;
  contractNo: string;
  projectCode: string;
  itemName: string;
  quoteStatus: string;
  batch: string;
  batchDate: string;
  category: string;
  status: string;
  qsNote: string;
  tpNote: string;
  reviewedByName: string;
  totalFormulas?: string; // công thức dòng TỔNG CỘNG (QSTT / Trưởng phòng sửa tay)
  totalAmounts?: string; // TỔNG CỘNG đã lưu
  lines: (Omit<ParsedLine, "level"> & { level: string; qsNote: string; tpPrice: number | null; tpOk: boolean; tpNote: string; formulas?: string; tpAmount?: number | null })[];
};

type ExLine = ExportSub["lines"][number];

// QSTT đã thêm / xoá dòng trên phần mềm → sửa sheet gốc cho khớp (xem applyRowEdits trong src/lib/excel-rows.ts)
function layoutEditedLines(ws: ExcelJS.Worksheet, lines: ExLine[], colMap: Partial<Record<LineField, number>>, hr: Record<string, number>): (ExLine & { isNew?: boolean })[] {
  // mọi dòng của bảng gốc (công tác, đầu mục lớn, dòng chữ): dòng nào QSTT xoá thì xoá số + ẩn dòng trong file xuất ra
  const origItemRows = (parseSheet(ws)?.lines ?? []).map((o) => o.sourceRow);
  return applyRowEdits(ws, lines, { origItemRows, clearCols: [colMap.qty, colMap.cdtPrice, colMap.basePrice, colMap.sitePrice, colMap.ptPrice], hr, hrKeys: ["total", "opinion"] });
}

const HEAD_LABEL: Record<string, string> = {
  projectName: "CÔNG TRÌNH",
  contractNo: "THUỘC HỢP ĐỒNG VỚI CDT SỐ",
  projectCode: "MÃ SỐ DỰ ÁN",
  itemName: "HẠNG MỤC",
  quoteStatus: "TÌNH TRẠNG BÁO GIÁ",
  batch: "ĐỢT",
};

export async function buildPriceWorkbook(sub: ExportSub, opts: { standard?: boolean } = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  if (!sub.fileData) throw new Error("Hồ sơ không còn file gốc");
  await wb.xlsx.load(sub.fileData.buffer.slice(sub.fileData.byteOffset, sub.fileData.byteOffset + sub.fileData.byteLength) as ArrayBuffer);
  // chỉ giữ sheet của hồ sơ này
  for (const w of [...wb.worksheets]) if (w.name !== sub.sheetName) wb.removeWorksheet(w.id);
  const ws = wb.getWorksheet(sub.sheetName);
  if (!ws) throw new Error("Không thấy sheet trong file gốc");
  const colMap = JSON.parse(sub.colMap) as Partial<Record<LineField, number>>;
  const hr = JSON.parse(sub.headRows) as Record<string, number>;
  // vị trí cột của nhãn / giá trị thông tin đầu file (mẫu khác nhau đặt nhãn ở cột A hoặc cột F...) — đọc lại từ file gốc để hồ sơ cũ cũng đúng
  {
    const fresh = parseSheet(ws)?.headRows ?? {};
    for (const k of Object.keys(fresh)) if (k.includes(":")) hr[k] = fresh[k];
  }
  // chữ thường a, b, i, ii không phải đầu mục lớn (hồ sơ cũ đã lưu nhầm là GROUP / SUB)
  const lowerStt = (x: string) => /[a-z]/.test(x) && !/[A-Z]/.test(x);
  const lines = layoutEditedLines(ws, sub.lines, colMap, hr).map((l) => ((l.level === "GROUP" || l.level === "SUB") && lowerStt(l.stt ?? "") ? { ...l, level: "ITEM" } : l));

  // thông tin đầu file (QSTT có thể đã bổ sung)
  for (const [f, label] of Object.entries(HEAD_LABEL)) {
    const r = hr[f];
    if (!r) continue;
    const lc = hr[`${f}:col`] ?? 1;
    const vc = hr[`${f}:val`] ?? lc;
    const v = f === "batch" ? `${sub.batch}  (Ngày ${sub.batchDate || "…..............."})` : (sub as unknown as Record<string, string>)[f];
    if (vc !== lc) {
      // nhãn và giá trị ở 2 ô riêng (VD nhãn cột F, giá trị cột G): chỉ ghi vào ô giá trị, KHÔNG chèn thêm chữ ở cột A (làm chồng chữ lên nhãn có sẵn)
      const vcell = ws.getRow(r).getCell(vc);
      if (!vcell.formula) vcell.value = `: ${v || "…………………………."}`;
      continue;
    }
    const cell = ws.getRow(r).getCell(lc);
    const raw = cellText(cell);
    const i = raw.indexOf(":");
    cell.value = `${i >= 0 ? raw.slice(0, i) : `                                 ${label}`}:  ${v || "…………………………."}`;
  }

  // ghi lại số liệu các dòng (giữ công thức thành tiền có sẵn trong file)
  const writable = [...NUM_FIELDS.filter((f) => !f.endsWith("Amount")), ...TEXT_FIELDS, "content", "unit"] as const;
  for (const l of lines) {
    const row = ws.getRow(l.sourceRow);
    for (const f of writable) {
      const c = colMap[f as LineField];
      if (!c) continue;
      const cell = row.getCell(c);
      if (cell.formula) continue;
      const v = (l as unknown as Record<string, unknown>)[f];
      if (v === null || v === "") continue;
      cell.value = v as ExcelJS.CellValue;
    }
    if (colMap.stt && l.stt && !row.getCell(colMap.stt).formula) row.getCell(colMap.stt).value = l.stt; // STT (QSTT thêm / sửa)
    // thành tiền / tổng nhóm QSTT đã sửa bằng công thức → ghi số đã tính đè lên công thức cũ trong file
    for (const f of ["cdtAmount", "baseAmount", "siteAmount"] as const) {
      const c = colMap[f];
      const v = l[f];
      if (c && hasFormula(l, f) && typeof v === "number") row.getCell(c).value = v;
    }
  }
  const savedT = savedTotals(sub.totalAmounts);
  const totalF = (() => {
    try {
      return JSON.parse(sub.totalFormulas || "{}") as Record<string, string>;
    } catch {
      return {} as Record<string, string>;
    }
  })();
  // dòng TỔNG CỘNG: ô QSTT đã sửa công thức → ghi số tổng đã tính
  if (hr.total) {
    for (const [f, k] of [["cdtAmount", "cdt"], ["baseAmount", "base"], ["siteAmount", "site"]] as const) {
      const c = colMap[f];
      if (c && totalF[f] && savedT[k] != null) ws.getRow(hr.total).getCell(c).value = savedT[k]!;
    }
  }

  // Kết quả Phòng Đấu thầu - Thanh toán (Trưởng phòng duyệt): 4 cột (Ý kiến | Đơn giá | Thành tiền | Ghi chú)
  //  - mẫu ngoài HĐ: ghi THẲNG vào khối "GIÁ ĐỀ XUẤT CỦA P.ĐT-TT" có sẵn (khối này chính là giá TP duyệt)
  //  - mẫu trong HĐ (hoặc file thiếu khối P.ĐT-TT): thêm khối "KHỐI KT-KH" bên phải bảng
  const last = Math.max(...Object.values(colMap).filter((x): x is number => typeof x === "number"));
  const h = hr.header;
  const ptCols = [colMap.ptOpinion, colMap.ptPrice, colMap.ptAmount, colMap.ptNote];
  const inPlace = sub.kind === "OUT" && ptCols.every((c) => c != null);
  const tc: number[] = inPlace ? (ptCols as number[]) : [last + 1, last + 2, last + 3, last + 4];
  if (inPlace) {
    const top = ws.getRow(h).getCell(tc[0]);
    top.value = "GIÁ DUYỆT CỦA KHỐI KT-KH";
  } else {
    const refTop = ws.getRow(h).getCell(last);
    const refSub = ws.getRow(h + 1).getCell(last);
    ws.mergeCells(h, tc[0], h, tc[3]);
    const topCell = ws.getRow(h).getCell(tc[0]);
    topCell.value = "GIÁ DUYỆT CỦA KHỐI KT-KH";
    topCell.style = { ...refTop.style };
    ["Ý kiến\n(Đồng ý / điều chỉnh)", "Đơn giá duyệt", "Thành tiền duyệt", "Ghi chú QSTT / TP"].forEach((t, i) => {
      const c = ws.getRow(h + 1).getCell(tc[i]);
      c.value = t;
      c.style = { ...refSub.style };
    });
    [12, 14, 16, 30].forEach((w, i) => (ws.getColumn(tc[i]).width = w));
  }
  wb.calcProperties.fullCalcOnLoad = true; // Excel tính lại các công thức thành tiền có sẵn khi mở file
  const numFmt = "#,##0";
  const total = { v: 0 };
  // tổng theo nhóm (A, B / I, II): cộng các dòng công việc bên dưới tới nhóm kế tiếp cùng cấp
  const amounts = lines.map((l) => (l.level === "ITEM" ? apprAmountOf(sub.kind, l) : null));
  const redCells = new Set<string>(); // ô đơn giá được Trưởng phòng điều chỉnh (chữ đỏ)
  lines.forEach((l, i) => {
    const row = ws.getRow(l.sourceRow);
    const border = ws.getRow(l.sourceRow).getCell(last).border;
    const put = (k: number, v: ExcelJS.CellValue, fmt?: string, force = false) => {
      const c = row.getCell(tc[k]);
      if (c.formula && !force) return; // giữ công thức có sẵn trong file (VD thành tiền = KL × đơn giá); force = Trưởng phòng đã sửa thành tiền bằng công thức
      c.value = v;
      if (fmt) c.numFmt = fmt;
      if (border) c.border = border;
    };
    if (l.level === "ITEM") {
      const ap = approvedPriceOf(sub.kind, l);
      const a = amounts[i];
      total.v += a ?? 0;
      put(0, opinionOf(sub.kind, l));
      put(1, ap, numFmt);
      put(2, a, numFmt, hasFormula(l, "apprAmount"));
      put(3, [l.qsNote && `QSTT: ${l.qsNote}`, l.tpNote && `TP: ${l.tpNote}`].filter(Boolean).join("; "));
      // Trình bày (anh chốt 17/11/2026): dòng công việc KHÔNG tô màu, mọi chữ màu đen; chỉ ĐƠN GIÁ Trưởng phòng ĐIỀU CHỈNH chữ ĐỎ
      if (opinionOf(sub.kind, l) === "Điều chỉnh") redCells.add(`${l.sourceRow}:${tc[1]}`);
    } else if (l.level === "GROUP" || l.level === "SUB") {
      let s = 0;
      let lastChild = -1;
      for (let j = i + 1; j < lines.length; j++) {
        const lj = lines[j];
        if (lj.level === "GROUP" || (l.level === "SUB" && lj.level === "SUB")) break;
        s += amounts[j] ?? 0;
        lastChild = j;
      }
      const sOv = hasFormula(l, "apprAmount");
      if (sOv) s = l.tpAmount ?? 0; // tổng nhóm Trưởng phòng sửa bằng công thức
      put(0, "");
      put(1, "");
      const sc = row.getCell(tc[2]);
      if (!sOv && lastChild > i && !sc.formula) {
        // công thức SUBTOTAL: tổng cha bỏ qua ô SUBTOTAL con nên không bị cộng đôi (ghi số cứng vào đây làm tổng cha sai)
        const colL = ws.getColumn(tc[2]).letter;
        sc.value = { formula: `SUBTOTAL(9,${colL}${lines[i + 1].sourceRow}:${colL}${lines[lastChild].sourceRow})`, result: s } as ExcelJS.CellFormulaValue;
        sc.numFmt = numFmt;
        if (border) sc.border = border;
      } else put(2, s || null, numFmt, sOv);
      put(3, "");
      row.getCell(tc[2]).font = { ...(row.getCell(tc[2]).font ?? {}), bold: true };
    }
  });
  if (hr.total) {
    const c = ws.getRow(hr.total).getCell(tc[2]);
    const tOv = !!totalF.apprAmount && savedT.appr != null; // TỔNG CỘNG duyệt Trưởng phòng sửa bằng công thức
    if (!c.formula || tOv) c.value = tOv ? savedT.appr! : total.v;
    c.numFmt = numFmt;
    c.font = { bold: true };
  }
  // ---- TRÌNH BÀY: chỉ tô màu dòng tiêu đề, dòng đầu mục lớn (A, I...) và dòng TỔNG CỘNG; dòng công việc bỏ màu nền; mọi chữ đen, đơn giá điều chỉnh chữ đỏ ----
  {
    const lastCol = Math.max(last, ...tc);
    const lastRow = Math.max(hr.total ?? 0, ...lines.map((l) => l.sourceRow));
    const taskRows = new Set(lines.filter((l) => l.level !== "GROUP" && l.level !== "SUB").map((l) => l.sourceRow));
    for (let r = h; r <= lastRow; r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= lastCol; c++) {
        const cell = row.getCell(c);
        if (taskRows.has(r) && r !== hr.total) cell.fill = { type: "pattern", pattern: "none" };
        cell.font = { ...(cell.font ?? {}), color: { argb: redCells.has(`${r}:${c}`) ? "FFFF0000" : "FF000000" } };
      }
    }
  }
  // ---- KẺ KHUNG: viền ngoài bảng giữ nguyên (2 nét như file gốc); các đường kẻ BÊN TRONG chỉ 1 nét ----
  // 2 ô liền kề thường mỗi ô tự có 1 viền (phải của ô trái + trái của ô phải) kiểu khác nhau → Excel vẽ thành 2 nét. Đồng nhất cả 2 phía thành 1 kiểu.
  {
    const lastCol = Math.max(last, ...tc);
    const lastRow = Math.max(hr.total ?? 0, ...lines.map((l) => l.sourceRow));
    const one = (a?: Partial<ExcelJS.Border>, b?: Partial<ExcelJS.Border>): Partial<ExcelJS.Border> | undefined => {
      const cand = [a, b].filter((x): x is Partial<ExcelJS.Border> => !!x?.style);
      if (!cand.length) return undefined;
      const base = cand.find((x) => x.style === "thin" || x.style === "medium" || x.style === "thick") ?? cand[0];
      return base.style === "double" ? { style: "thin", color: base.color } : base;
    };
    for (let r = h; r <= lastRow; r++) {
      for (let c = 1; c <= lastCol; c++) {
        const cell = ws.getRow(r).getCell(c);
        if (c < lastCol) {
          const nx = ws.getRow(r).getCell(c + 1);
          const b = one(cell.border?.right, nx.border?.left);
          if (b) {
            cell.border = { ...cell.border, right: b };
            nx.border = { ...nx.border, left: b };
          }
        }
        if (r < lastRow) {
          const dn = ws.getRow(r + 1).getCell(c);
          const b = one(cell.border?.bottom, dn.border?.top);
          if (b) {
            cell.border = { ...cell.border, bottom: b };
            dn.border = { ...dn.border, top: b };
          }
        }
      }
    }
  }
  // ý kiến của Phòng ĐT-KS-TT ở chân bảng
  if (hr.opinion) {
    const notes = [
      sub.qsNote && `QSTT: ${sub.qsNote}`,
      sub.status === "APPROVED" || sub.status === "REJECTED" ? `${sub.status === "APPROVED" ? "TP đã DUYỆT" : "TP KHÔNG DUYỆT"}${sub.reviewedByName ? ` (${sub.reviewedByName})` : ""}${sub.tpNote ? `: ${sub.tpNote}` : ""}` : "",
    ].filter(Boolean);
    notes.forEach((t, k) => {
      const c = ws.getRow(hr.opinion + 1 + k).getCell(hr.opinionCol ?? 1);
      c.value = `${k + 1}/ ${t}`;
    });
  }
  if (opts.standard) applyStandardStyle(wb); // Times New Roman, canh giữa dọc, số tiền kiểu Comma
  return fixXlsx(await wb.xlsx.writeBuffer());
}

// ================= XUẤT EXCEL TỪ DỮ LIỆU THEO MẪU CHUẨN CỦA PHÒNG (không cần file Excel gốc của BCH) =================
// Dựng "khung" từ mẫu chuẩn nhúng sẵn (src/lib/price-template.ts): giữ nguyên tiêu đề công ty, tiêu đề bảng, chân ký; thân bảng được dựng lại
// đúng số dòng của hồ sơ (đầu mục lớn / dòng công việc / TỔNG CỘNG, công thức thành tiền + SUBTOTAL). Sau đó dùng lại bước ghi số liệu + kết quả duyệt
// như xuất từ file gốc (buildPriceWorkbook). Nhờ vậy file xuất luôn cùng một mẫu, không mang theo lỗi của file BCH, và không phải giữ file gốc lâu dài.
const colNum = (a: string) => a.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const parseRange = (r: string) => {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(r);
  return m ? { c1: colNum(m[1]), r1: Number(m[2]), c2: colNum(m[3]), r2: Number(m[4]) } : null;
};

async function standardSkeleton(sub: ExportSub) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(PRICE_TEMPLATE_B64, "base64") as unknown as ArrayBuffer);
  const wantOut = sub.kind === "OUT";
  const ws = wb.worksheets.find((w) => norm(w.name).includes("NGOAI") === wantOut);
  if (!ws) throw new Error("Không thấy sheet mẫu chuẩn");
  for (const w of [...wb.worksheets]) if (w !== ws) wb.removeWorksheet(w.id);
  const p0 = parseSheet(ws);
  if (!p0 || !p0.headRows.total) throw new Error("Mẫu chuẩn không nhận diện được bảng");
  const hr = p0.headRows;
  const colMap = p0.colMap;
  const oldTotal = hr.total!;
  const lastRowOld = ws.rowCount;
  const nClear = Math.max(ws.columnCount, 20);
  const lastCol = Math.max(...Object.values(colMap).filter((x): x is number => typeof x === "number"));

  // dòng tiêu đề nhóm "THEO HỢP ĐỒNG SỐ…" (mẫu trong HĐ) đứng ngay dưới tiêu đề bảng → giữ, thân bảng bắt đầu sau nó
  const headRow = norm(cellText(ws.getRow(hr.header + 2).getCell(2))).startsWith("THEO HOP DONG") ? hr.header + 2 : 0;
  const first = (headRow || hr.header + 1) + 1;
  if (headRow) ws.getRow(headRow).getCell(2).value = `THEO HỢP ĐỒNG SỐ ${sub.contractNo || "…"}`;

  // chụp dòng TỔNG CỘNG + chân bảng (ký tên, ý kiến) của mẫu để đặt lại sau thân bảng
  const snap = (r: number) => ({
    height: ws.getRow(r).height as number | undefined,
    cells: Array.from({ length: lastCol }, (_, i) => {
      const c = ws.getRow(r).getCell(i + 1);
      return { v: c.value, s: { ...c.style } as ExcelJS.Style };
    }),
  });
  const totalSnap = snap(oldTotal);
  const footer: ReturnType<typeof snap>[] = [];
  for (let r = oldTotal + 1; r <= lastRowOld; r++) footer.push(snap(r));
  const merges = ((ws.model as unknown as { merges?: string[] }).merges ?? []).filter((m) => (parseRange(m)?.r1 ?? 0) >= oldTotal);
  for (const m of merges) ws.unMergeCells(m);
  // xoá thân bảng mẫu + tổng cộng + chân bảng
  for (let r = first; r <= lastRowOld; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= nClear; c++) {
      const cell = row.getCell(c);
      cell.value = null;
      cell.style = {};
    }
    row.height = undefined as unknown as number;
  }

  // dựng thân bảng theo các dòng của hồ sơ
  const lowerStt = (x: string) => /[a-z]/.test(x) && !/[A-Z]/.test(x);
  const levels = sub.lines.map((l) => ((l.level === "GROUP" || l.level === "SUB") && lowerStt(l.stt ?? "") ? "ITEM" : l.level));
  const n = sub.lines.length;
  const newTotal = first + n;
  const letter = (c: number) => ws.getColumn(c).letter;
  const thin = { style: "thin" as const, color: { argb: "FF000000" } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const moneyCols = new Set([colMap.cdtPrice, colMap.cdtAmount, colMap.basePrice, colMap.baseAmount, colMap.sitePrice, colMap.siteAmount, colMap.ptPrice, colMap.ptAmount].filter((x): x is number => !!x));
  const amountCols = [colMap.cdtAmount, colMap.baseAmount, colMap.siteAmount, sub.kind === "OUT" ? colMap.ptAmount : undefined].filter((x): x is number => !!x);
  const priceOf = (amt: number) => (amt === colMap.cdtAmount ? colMap.cdtPrice : amt === colMap.baseAmount ? colMap.basePrice : amt === colMap.siteAmount ? colMap.sitePrice : colMap.ptPrice);
  const textCols = new Set([colMap.content, colMap.baseNote, colMap.siteNote, colMap.ptNote].filter((x): x is number => !!x));
  const centerCols = new Set([colMap.stt, colMap.unit, colMap.siteOpinion, colMap.ptOpinion].filter((x): x is number => !!x));
  const FILL = { GROUP: "FFFCE4D6", SUB: "FFFFF2CC" } as const;
  const qL = colMap.qty ? letter(colMap.qty) : "";
  for (let i = 0; i < n; i++) {
    const r = first + i;
    const lv = levels[i];
    const row = ws.getRow(r);
    const head = lv === "GROUP" || lv === "SUB";
    for (let c = 1; c <= lastCol; c++) {
      const cell = row.getCell(c);
      cell.border = border;
      cell.font = { name: "Times New Roman", size: 11, bold: head };
      cell.alignment = { vertical: "middle", wrapText: textCols.has(c), horizontal: centerCols.has(c) ? "center" : moneyCols.has(c) || c === colMap.qty ? "right" : undefined };
      if (c === colMap.qty) cell.numFmt = "#,##0.00";
      else if (moneyCols.has(c)) cell.numFmt = "#,##0";
      if (head) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[lv as "GROUP" | "SUB"] } };
    }
    if (lv === "ITEM" && qL) {
      for (const amt of amountCols) {
        const pc = priceOf(amt);
        if (pc) row.getCell(amt).value = { formula: `$${qL}${r}*${letter(pc)}${r}` } as ExcelJS.CellFormulaValue;
      }
    } else if (head) {
      // tổng nhóm = SUBTOTAL các dòng con (tổng cha bỏ qua ô SUBTOTAL con nên không cộng đôi)
      let lastChild = -1;
      for (let j = i + 1; j < n; j++) {
        if (levels[j] === "GROUP" || (lv === "SUB" && levels[j] === "SUB")) break;
        lastChild = j;
      }
      if (lastChild > i) for (const amt of amountCols) row.getCell(amt).value = { formula: `SUBTOTAL(9,${letter(amt)}${r + 1}:${letter(amt)}${first + lastChild})` } as ExcelJS.CellFormulaValue;
    }
  }

  // dòng TỔNG CỘNG (giữ kiểu của mẫu) + công thức SUBTOTAL toàn bảng
  const totRow = ws.getRow(newTotal);
  totalSnap.cells.forEach((c, i) => {
    const cell = totRow.getCell(i + 1);
    cell.style = c.s;
    if (i + 1 === 2) cell.value = c.v; // nhãn "TỔNG CỘNG"
  });
  if (totalSnap.height) totRow.height = totalSnap.height;
  if (n > 0) for (const amt of amountCols) totRow.getCell(amt).value = { formula: `SUBTOTAL(9,${letter(amt)}${first}:${letter(amt)}${newTotal - 1})` } as ExcelJS.CellFormulaValue;

  // đặt lại chân bảng (ký tên, ý kiến) ngay dưới dòng tổng cộng, kèm các ô gộp đã dời
  footer.forEach((f, k) => {
    const row = ws.getRow(newTotal + 1 + k);
    f.cells.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.value = c.v;
      cell.style = c.s;
    });
    if (f.height) row.height = f.height;
  });
  const off = newTotal - oldTotal;
  for (const m of merges) {
    const x = parseRange(m);
    if (x) ws.mergeCells(x.r1 + off, x.c1, x.r2 + off, x.c2);
  }

  const data = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  const p2 = parseSheet(ws);
  if (!p2) throw new Error("Khung mẫu sau khi dựng không nhận diện được");
  return { data, colMap: p2.colMap, headRows: p2.headRows, first, levels, sheetName: ws.name };
}

export async function buildPriceWorkbookStandard(sub: ExportSub): Promise<Buffer> {
  const sk = await standardSkeleton(sub);
  const lines = sub.lines.map((l, i) => ({ ...l, level: sk.levels[i], sourceRow: sk.first + i }));
  return buildPriceWorkbook({ ...sub, sheetName: sk.sheetName, fileData: sk.data, colMap: JSON.stringify(sk.colMap), headRows: JSON.stringify(sk.headRows), lines }, { standard: true });
}

// Xuất Excel 1 hồ sơ: ưu tiên mẫu chuẩn (không phụ thuộc file BCH); lỗi bất ngờ thì quay về cách cũ (ghi vào file gốc đã lưu nếu còn)
export async function buildPriceWorkbookAuto(sub: ExportSub): Promise<Buffer> {
  try {
    return await buildPriceWorkbookStandard(sub);
  } catch (e) {
    console.error("[gia-doi-excel] xuất theo mẫu chuẩn lỗi, quay về file gốc:", e);
    if (!sub.fileData) throw e;
    return buildPriceWorkbook(sub);
  }
}
