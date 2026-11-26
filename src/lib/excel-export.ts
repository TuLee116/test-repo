import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { boqDirectUnitPrice, subUnitPriceByBoq } from "@/lib/cost";
import { getProjectWithBoq } from "@/lib/project-data";
import { getDtcpData } from "@/lib/dtcp";
import { DTCP_HEAD_ROW, dtcpLayout } from "@/lib/dtcp-layout";
import { loadSheet } from "@/lib/tonghop";
import { loadSubSheet } from "@/lib/thauphu";
import { SHEET_CFG, type SheetKind, type SheetRow } from "@/lib/tonghop-shared";
import { computeBoqTree, summaryKind } from "@/lib/boq-tree";
import { childlessHeadingIds } from "@/lib/boq-amounts";
import { colLetter, createEvaluator, isNumberValue, remapFormula } from "@/lib/grid-formula";
import { parseStyle, type CellStyle } from "@/lib/grid-style";
import { parseMerges } from "@/lib/grid-merge";
import { headingBlockEnd, headingLabels } from "@/lib/grid-heading";
import { exportImageOf } from "@/lib/uploads";
import { extraAmountCols } from "@/lib/grid-amount";
import { QTY_NUMFMT } from "@/lib/fmt-qty";
import { parseCoveredLines, scopeLabel, subCovers, type LineExtra } from "@/lib/sub-portions";
import { unitMismatch } from "@/lib/unit-convert";

// Xuất Excel "sống": mọi sheet của dự án, các ô tiền / tổng / liên kết giữa sheet đều là CÔNG THỨC Excel thật
// (SUM, SUBTOTAL, SUMIF, INDEX/MATCH, tham chiếu ô sheet khác), chỉ các ô nhập liệu gốc là hằng số (chữ xanh):
// khối lượng, đơn giá báo CĐT, định mức, đơn giá tài nguyên, đơn giá thầu phụ, tỷ lệ %, nội dung bảng tự do.
// Người dùng sửa tay 1 ô nhập trong Excel thì toàn bộ sheet liên quan tự tính lại như trên phần mềm.

type Project = NonNullable<Awaited<ReturnType<typeof getProjectWithBoq>>>;
type BoqItem = Project["boqItems"][number];

const SH = {
  dtcp: "DT-CP",
  boq: "BOQ",
  ct: "CHI TIẾT",
  vt: "TH Vật Tư",
  nc: "TH Nhân Công",
  tb: "TH Thiết Bị",
  tp: "TH Thầu Phụ",
};
const KIND_SHEET: Record<SheetKind, string> = { VT: SH.vt, NC: SH.nc, TB: SH.tb };
// Cột của 3 sheet TH (thứ tự giống bảng trên phần mềm, thêm cột Mã ở cuối để CHI TIẾT tra đơn giá)
type ThCols = { name: string; unit: string; qty: string; price: string; amt: string; note: string; code: string; vat?: string; calc?: string; waste?: string; mgmt?: string; days?: string; amtVat?: string };
const TH_COL: Record<SheetKind, ThCols> = {
  VT: { name: "B", unit: "C", waste: "D", qty: "E", price: "F", vat: "G", calc: "H", amt: "I", note: "J", code: "K" },
  NC: { name: "B", unit: "C", qty: "D", price: "E", mgmt: "F", amt: "G", note: "H", code: "I" },
  TB: { name: "B", unit: "C", qty: "D", days: "E", price: "F", calc: "F", amt: "G", vat: "H", amtVat: "I", note: "J", code: "K" },
};
const PREFIX: Record<SheetKind, string> = { VT: "vt", NC: "nt", TB: "tb" };

const q = (name: string) => `'${name.replace(/'/g, "''")}'`;
const L = (n: number) => colLetter(n - 1); // cột 1-based → chữ cái
const abs = (sheet: string, col: string, row: number) => `${q(sheet)}!$${col}$${row}`;
const absRange = (sheet: string, col: string, r1: number, r2: number) => `${q(sheet)}!$${col}$${r1}:$${col}$${r2}`;

// Gộp danh sách số dòng thành "J5:J8,J10" (dùng trong SUM)
function compressRows(col: string, rows: number[]): string {
  const s = [...rows].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    parts.push(i === j ? `${col}${s[i]}` : `${col}${s[i]}:${col}${s[j]}`);
    i = j + 1;
  }
  return parts.join(",");
}

const BLUE = "FF1D4ED8";
const FILL = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const F_HEAD = FILL("FFE2E8F0");
const F_TITLE = FILL("FFFDE047");
const F_SEC = FILL("FFD9E1F2");
const F_HEADING = [FILL("FFFCD34D"), FILL("FFFDE68A"), FILL("FFFEF08A"), FILL("FFFEF9C3")];
const thin = { style: "thin" as const, color: { argb: "FFCBD5E1" } };
const BOX = { top: thin, left: thin, bottom: thin, right: thin };
const dark = { style: "thin" as const, color: { argb: "FF0F172A" } };
const BOX_DARK = { top: dark, left: dark, bottom: dark, right: dark };
const MONEY = "#,##0";
const QTY = QTY_NUMFMT; // khối lượng: luôn 2 số lẻ
// Định dạng theo file chuẩn DT-CP_Tòa DV21: kiểu Comma của Excel (số 0 hiện "-"), toàn bộ Times New Roman canh giữa theo chiều dọc
const ACC = (dec: number) => {
  const d = dec > 0 ? `.${"0".repeat(dec)}` : "";
  return `_(* #,##0${d}_);_(* (#,##0${d});_(* "-"??_);_(@_)`;
};
const ACC0 = ACC(0);
const ACC1 = ACC(1);
const ACC2 = ACC(2);
const FONT_NAME = "Times New Roman";
const RED = "FFFF0000";
const PRICE_BLUE = "FF0070C0"; // cột đơn giá ở các bảng tự do
const CENTER = { horizontal: "center" } as const;
// cột tiền đủ rộng để số lớn không hiện ####
const fitWidth = (std: number, amount: number) => {
  const n = String(Math.round(Math.abs(amount))).length;
  return Math.max(std, n + Math.floor((n - 1) / 3) + 2);
};

// ô nhập liệu gốc = chữ xanh (hằng số người dùng sửa được), ô công thức = chữ đen
function input(cell: ExcelJS.Cell, value: ExcelJS.CellValue, fmt?: string) {
  cell.value = value;
  cell.font = { ...(cell.font ?? {}), color: { argb: BLUE } };
  if (fmt) cell.numFmt = fmt;
}
function formula(cell: ExcelJS.Cell, f: string, fmt?: string) {
  cell.value = { formula: f } as ExcelJS.CellFormulaValue;
  if (fmt) cell.numFmt = fmt;
}
function styleRow(row: ExcelJS.Row, from: number, to: number, opts: { fill?: ExcelJS.Fill; bold?: boolean; border?: boolean }) {
  for (let c = from; c <= to; c++) {
    const cell = row.getCell(c);
    if (opts.fill) cell.fill = opts.fill;
    if (opts.bold) cell.font = { ...(cell.font ?? {}), bold: true };
    if (opts.border !== false) cell.border = BOX;
  }
}
function header(ws: ExcelJS.Worksheet, rowNo: number, titles: string[]) {
  const row = ws.getRow(rowNo);
  titles.forEach((t, i) => (row.getCell(i + 1).value = t));
  styleRow(row, 1, titles.length, { fill: F_HEAD, bold: true });
  row.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
}
function setWidths(ws: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
}

type Reg = {
  sheetNames: Set<string>;
};

export async function buildProjectWorkbook(project: Project): Promise<ExcelJS.Workbook> {
  const reg: Reg = { sheetNames: new Set(Object.values(SH).map((s) => s.toLowerCase())) };
  const uniqueName = (raw: string) => {
    const base = (raw.replace(/[[\]:*?/\\]/g, "-").trim() || "Sheet").slice(0, 28);
    let n = base;
    let i = 2;
    while (reg.sheetNames.has(n.toLowerCase())) n = `${base}(${i++})`;
    reg.sheetNames.add(n.toLowerCase());
    return n;
  };

  // ---------- Dữ liệu ----------
  const dbSheets = await prisma.projectSheet.findMany({ where: { projectId: project.id }, orderBy: { orderIndex: "asc" }, include: { cells: true, metas: true } });
  const boqSheets = dbSheets.filter((s) => s.kind !== "GRID").map((s) => ({ id: s.id as string | null, name: uniqueName(s.name) }));
  const gridSheetsDb = dbSheets.filter((s) => s.kind === "GRID");
  const gridNames = new Map(gridSheetsDb.map((g) => [g.id, uniqueName(g.name)]));
  const allBoqSheets: { id: string | null; name: string }[] = [{ id: null, name: SH.boq }, ...boqSheets];
  const [thVT, thNC, thTB, subSheet, dtcpData] = await Promise.all([loadSheet(project, "VT"), loadSheet(project, "NC"), loadSheet(project, "TB"), loadSubSheet(project), getDtcpData(project)]);
  const th: Record<SheetKind, { rows: SheetRow[]; groups: { id: string; section: "A" | "B"; name: string; showInDtcp: boolean }[] }> = { VT: thVT, NC: thNC, TB: thTB };
  const nameToggles = await prisma.subcontractorNameToggle.findMany({ where: { projectId: project.id } });
  const subUnitByBoq = subUnitPriceByBoq(project.boqItems, project.subcontractorItems);

  const wb = new ExcelJS.Workbook();
  wb.creator = "DT-CP Online - Tân Minh Nhân";
  wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };

  // Thứ tự sheet giống thanh tab trên phần mềm
  const wsDtcp = wb.addWorksheet(SH.dtcp);
  const wsBoqs = new Map<string | null, ExcelJS.Worksheet>(allBoqSheets.map((s) => [s.id, wb.addWorksheet(s.name)]));
  const wsCt = wb.addWorksheet(SH.ct);
  const wsTh: Record<SheetKind, ExcelJS.Worksheet> = { VT: wb.addWorksheet(SH.vt), NC: wb.addWorksheet(SH.nc), TB: wb.addWorksheet(SH.tb) };
  const wsTp = wb.addWorksheet(SH.tp);
  const wsGrids = new Map(gridSheetsDb.map((g) => [g.id, wb.addWorksheet(gridNames.get(g.id) as string)]));

  // ============ 1. THAM SỐ DÙNG CHUNG ============
  // Không xuất sheet Thông tin dự án: tỷ lệ NC khác / thiết bị / MMTB nhập ở dòng tỷ lệ của CHI TIẾT, thuế GTGT nhập ở dòng VAT của DT-CP
  const INFO = {
    vat: abs(SH.dtcp, "C", dtcpLayout(dtcpData.rows).vatRow),
    ncK: abs(SH.ct, "K", 5),
    tb: abs(SH.ct, "M", 5),
    mmtb: abs(SH.ct, "N", 5),
    // chi phí khác (nhập ở tab Thông tin dự án, không xuất sheet): cộng từng khoản để thấy được thành phần
    otherTotal: project.otherCostItems.length ? project.otherCostItems.map((it) => String(it.amount)).join("+") : "0",
  };

  // ============ 2. BỐ CỤC CÁC SHEET (gán số dòng trước để công thức tham chiếu chéo được) ============
  // ---- TH Vật Tư / Nhân Công / Thiết Bị ----
  type ThLayout = {
    secRow: Record<"A" | "B", number>;
    secLast: Record<"A" | "B", number>;
    groupRow: Map<string, number>;
    groupLast: Map<string, number>;
    labelRow: Partial<Record<"A" | "B", number>>;
    rowOf: Map<SheetRow, number>;
    totalRow: number;
    first: number;
    last: number;
  };
  const thL = {} as Record<SheetKind, ThLayout>;
  for (const kind of ["VT", "NC", "TB"] as SheetKind[]) {
    const { rows, groups } = th[kind];
    const lay: ThLayout = { secRow: { A: 0, B: 0 }, secLast: { A: 0, B: 0 }, groupRow: new Map(), groupLast: new Map(), labelRow: {}, rowOf: new Map(), totalRow: 0, first: 4, last: 3 };
    let r = 4;
    for (const sec of ["A", "B"] as const) {
      lay.secRow[sec] = r++;
      const secGroups = groups.filter((g) => g.section === sec);
      for (const g of secGroups) {
        lay.groupRow.set(g.id, r++);
        for (const row of rows.filter((x) => x.section === sec && x.groupId === g.id)) lay.rowOf.set(row, r++);
        lay.groupLast.set(g.id, r - 1);
      }
      const loose = rows.filter((x) => x.section === sec && (!x.groupId || !secGroups.some((g) => g.id === x.groupId)));
      if (secGroups.length > 0 && loose.length > 0) lay.labelRow[sec] = r++;
      for (const row of loose) lay.rowOf.set(row, r++);
      lay.secLast[sec] = r - 1;
    }
    lay.totalRow = r++;
    lay.last = lay.totalRow - 1;
    thL[kind] = lay;
  }
  // DT-CP: TH Thiết Bị lấy thành tiền SAU VAT, Vật tư / Nhân công lấy thành tiền trước VAT
  const thAmtCol = (kind: SheetKind) => TH_COL[kind].amtVat ?? TH_COL[kind].amt;
  const thSecRef = (kind: SheetKind, sec: "A" | "B") => abs(KIND_SHEET[kind], thAmtCol(kind), thL[kind].secRow[sec]);
  const thGroupRef = (kind: SheetKind, id: string) => abs(KIND_SHEET[kind], thAmtCol(kind), thL[kind].groupRow.get(id) as number);

  // ---- CHI TIẾT ----
  // Bố cục giống bảng CHI TIẾT trên phần mềm. Cột: A TT | B Mã ĐM | C Diễn giải | D Đơn vị | E Khối lượng | F Định mức | G Hao hụt | H Tổng KL |
  // Đơn giá: I Vật tư, J Nhân công, K NC khác, L Thầu phụ, M Thiết bị, N MMTB + VT phụ | Thành tiền: O Vật tư, P Nhân công, Q NC khác, R Thầu phụ,
  // S Thiết bị, T MMTB + VT phụ, U Tổng cộng | V Đơn giá TTP (BOQ lấy đơn giá từ đây).
  // Nhận biết loại dòng hao phí theo cột đơn giá: vật tư có I, nhân công có J, thiết bị có M mà không có J (dòng nhân công có M = % thiết bị phụ).
  const CT_FIRST = 6;
  const CT_AMT: Record<string, string> = { VT: "O", NC: "P", TB: "S" }; // cột thành tiền hao phí theo loại
  type CtSubRow = { sub: (typeof project.subcontractorItems)[number]; row: number; ql: { kind: "vt" | "tb"; base: number; pct: number; row: number }[] };
  type CtBlock = { hdr: number; title: number | null; a: number; b: number; lines: number; subs: CtSubRow[]; z: number };
  const ctOf = new Map<string, CtBlock>();
  type CtRow = { kind: "divider"; name: string; row: number } | { kind: "heading"; item: BoqItem; row: number } | { kind: "item"; item: BoqItem; block: CtBlock };
  const ctRows: CtRow[] = [];
  let ctNext = CT_FIRST;
  {
    let r = CT_FIRST;
    for (const bs of allBoqSheets) {
      if (bs.id !== null) ctRows.push({ kind: "divider", name: bs.name, row: r++ });
      for (const b of project.boqItems.filter((x) => (x.sheetId ?? null) === bs.id)) {
        if (b.isHeading) {
          ctRows.push({ kind: "heading", item: b, row: r++ });
          continue;
        }
        const isSub = b.method === "SUB";
        const lines = isSub ? 0 : (b.workItem?.resources.length ?? 0);
        const hdr = r++;
        const title = lines > 0 ? r++ : null;
        const a = r;
        r += lines;
        const block: CtBlock = { hdr, title, a, b: a + lines - 1, lines, subs: [], z: 0 };
        // phần giao thầu phụ của công tác chiết tính + 2 dòng quản lý vật tư / thiết bị TMN cấp
        if (!isSub) {
          for (const s of project.subcontractorItems.filter((x) => x.boqItemId === b.id)) {
            const sr: CtSubRow = { sub: s, row: r++, ql: [] };
            const mg = project.subMgmt.get(s.id);
            if (mg) {
              if (mg.vtBase > 0) sr.ql.push({ kind: "vt", base: mg.vtBase, pct: mg.vtPct, row: r++ });
              if (mg.tbBase > 0) sr.ql.push({ kind: "tb", base: mg.tbBase, pct: mg.tbPct, row: r++ });
            }
            block.subs.push(sr);
          }
        }
        block.z = r - 1;
        ctOf.set(b.id, block);
        ctRows.push({ kind: "item", item: b, block });
      }
    }
    ctNext = r;
  }
  const ctLast = Math.max(CT_FIRST, ctNext - 1);
  const CT = (col: string) => absRange(SH.ct, col, CT_FIRST, ctLast);
  const ctIs: Record<SheetKind, string> = { VT: `(${CT("I")}<>"")`, NC: `(${CT("J")}<>"")`, TB: `(${CT("J")}="")*(${CT("M")}<>"")` }; // điều kiện dòng hao phí theo loại

  // ---- BOQ (sheet chính + sheet BOQ bổ sung) ----
  type BoqLayout = { items: BoqItem[]; rowOf: Map<string, number>; first: number; last: number; totalRow: number; ownTotal: boolean; tree: ReturnType<typeof computeBoqTree>; childless: Set<string> };
  const boqL = new Map<string | null, BoqLayout>();
  for (const bs of allBoqSheets) {
    const items = project.boqItems.filter((x) => (x.sheetId ?? null) === bs.id);
    const rowOf = new Map(items.map((b, i) => [b.id, 6 + i]));
    // BOQ đã có dòng "Tổng trước thuế" thì dùng luôn dòng đó làm dòng tổng, không thêm dòng TỔNG CỘNG trùng số
    const ownTotal = items.find((x) => x.isHeading && summaryKind(x.rawDescription) === "subtotal");
    boqL.set(bs.id, { items, rowOf, first: 6, last: 5 + items.length, totalRow: ownTotal ? (rowOf.get(ownTotal.id) as number) : 6 + items.length, ownTotal: !!ownTotal, tree: computeBoqTree(items), childless: childlessHeadingIds(items) });
  }
  const boqRowRef = (itemId: string, col: string) => {
    const b = project.boqItems.find((x) => x.id === itemId);
    const lay = boqL.get(b?.sheetId ?? null) as BoqLayout;
    return abs(allBoqSheets.find((s) => s.id === (b?.sheetId ?? null))?.name as string, col, lay.rowOf.get(itemId) as number);
  };

  // ---- TH Thầu Phụ ----
  const tpRowOfSub = new Map<string, number>(); // id SubcontractorItem → số dòng
  const tpHeadingRow = new Map<string, number>();
  const tpGroupRow = new Map<string, number>();
  let tpBoqItemRows: number[] = [];
  let tpManualRows: number[] = [];
  let tpBoqFirst = 5;
  let tpBoqLast = 4;
  let tpBoqTotalRow = 0;
  let tpManualTotalRow = 0;
  let tpTotalRow = 0;
  const tpGroupItemRows = new Map<string, number[]>();
  {
    let r = 4;
    tpBoqFirst = r;
    tpBoqTotalRow = r++; // dòng tổng "theo CHI TIẾT"
    tpBoqFirst = r;
    for (const row of subSheet.boqRows) {
      if (row.type === "heading") tpHeadingRow.set(row.id, r++);
      else {
        tpRowOfSub.set(row.id, r);
        tpBoqItemRows.push(r++);
      }
    }
    tpBoqLast = r - 1;
    tpManualTotalRow = r++; // dòng tổng "bổ sung"
    for (const it of subSheet.looseItems) {
      tpRowOfSub.set(it.id, r);
      tpManualRows.push(r++);
    }
    for (const g of subSheet.groups) {
      tpGroupRow.set(g.id, r++);
      const rowsOfGroup: number[] = [];
      for (const it of g.items) {
        tpRowOfSub.set(it.id, r);
        tpManualRows.push(r);
        rowsOfGroup.push(r++);
      }
      tpGroupItemRows.set(g.id, rowsOfGroup);
    }
    tpTotalRow = r++;
  }
  // DT-CP lấy thầu phụ SAU VAT (cột J của TH Thầu Phụ); BOQ / CHI TIẾT lấy đơn giá, thành tiền trước VAT (cột E, H)
  const TP = { boqTotal: abs(SH.tp, "J", tpBoqTotalRow), manualTotal: abs(SH.tp, "J", tpManualTotalRow), total: abs(SH.tp, "J", tpTotalRow) };

  // ---- Bảng tự do (GRID) ----
  type GridLayout = { sheet: (typeof gridSheetsDb)[number]; name: string; offset: number; totalRow: number | null; headingRow: Map<string, number>; nCols: number };
  const gridL = new Map<string, GridLayout>();
  for (const g of gridSheetsDb) {
    // dòng bảng tự do r → dòng Excel r + 1 + offset; 2 dòng đầu là tên sheet + ghi chú, rồi các dòng tiêu đề phụ, rồi dòng tên cột
    const extraHeader = (JSON.parse(g.headerRows) as string[][]).length;
    const offset = 1 + extraHeader; // dòng tiêu đề trên cùng = dòng 1 (giống số dòng hiển thị trên phần mềm)
    const headingRow = new Map(g.metas.map((m) => [m.id, m.row + 1 + offset]));
    gridL.set(g.id, { sheet: g, name: gridNames.get(g.id) as string, offset, totalRow: g.amountCol !== null ? g.rowCount + 1 + offset + 1 : null, headingRow, nCols: (JSON.parse(g.colTitles) as string[]).length });
  }
  const gridRef = (key: string): string | null => {
    if (key.startsWith("grid:")) {
      const gl = gridL.get(key.slice(5));
      return gl && gl.totalRow !== null ? abs(gl.name, L((gl.sheet.amountCol as number) + 1), gl.totalRow) : null;
    }
    if (key.startsWith("gridh:")) {
      const id = key.slice(6);
      for (const gl of gridL.values()) {
        const r = gl.headingRow.get(id);
        if (r !== undefined && gl.sheet.amountCol !== null) return abs(gl.name, L(gl.sheet.amountCol + 1), r);
      }
    }
    // cột "Thành tiền" khác của sheet tự do (VD Thành tiền Chủ đầu tư): tổng sheet / tổng đầu mục ở đúng cột đó
    const gc = /^gridc:(.+):(\d+)$/.exec(key);
    if (gc) {
      const gl = gridL.get(gc[1]);
      return gl && gl.totalRow !== null ? abs(gl.name, L(Number(gc[2]) + 1), gl.totalRow) : null;
    }
    const ghc = /^gridhc:(.+):(\d+)$/.exec(key);
    if (ghc) {
      for (const gl of gridL.values()) {
        const r = gl.headingRow.get(ghc[1]);
        if (r !== undefined) return abs(gl.name, L(Number(ghc[2]) + 1), r);
      }
    }
    return null;
  };

  // Ô số có công thức gõ trên phần mềm (đơn giá / khối lượng ở TH, TH Thầu Phụ): xuất thành công thức Excel để kiểm tra được.
  // Có LINK tới sheet khác → công thức tham chiếu ô nguồn (chữ đen); chỉ là phép tính (VD =14750*1.1) → vẫn là ô nhập (chữ xanh).
  const fieldCell = (cell: ExcelJS.Cell, value: number, f: string | null | undefined, fmt: string) => {
    const t = (f ?? "").trim();
    if (!t.startsWith("=")) return input(cell, value, fmt);
    const x = userFormulaToExcel(t);
    if (/\bLINK\(/i.test(t)) formula(cell, x, fmt);
    else input(cell, { formula: x } as ExcelJS.CellFormulaValue, fmt);
  };

  // ============ 3. CÁC SHEET TH VẬT TƯ / NHÂN CÔNG / THIẾT BỊ ============
  for (const kind of ["VT", "NC", "TB"] as SheetKind[]) {
    const ws = wsTh[kind];
    const lay = thL[kind];
    const cfg = SHEET_CFG[kind];
    const { rows, groups } = th[kind];
    const C = TH_COL[kind];
    const n = (col: string) => col.charCodeAt(0) - 64; // chữ cái cột → số cột
    const nc = n(C.code); // số cột (Mã là cột cuối)
    const amtCols = [C.amt, ...(C.amtVat ? [C.amtVat] : [])];
    ws.getCell("A1").value = `${cfg.title.toUpperCase()} — ${project.name}`;
    ws.getCell("A1").font = { bold: true, size: 13 };
    const noteW = rows.some((r) => r.note?.trim()) ? 28 : 8.1; // không có ghi chú thì thu hẹp cột
    ws.getColumn(nc).hidden = true; // cột Mã chỉ để CHI TIẾT tra đơn giá
    // thứ tự cột giống bảng trên phần mềm
    if (kind === "VT") {
      setWidths(ws, [6, 46, 8, 9.1, 15, 16, 8, 16, 20, noteW, 16]);
      header(ws, 3, ["TT", "Tên vật tư", "ĐVT", "Hao hụt %", "Tổng KL", "Đơn giá \n(sau VAT)", "VAT %", "Đơn giá \n(trước VAT)", "Thành tiền \n(sau VAT)", "Ghi chú", "Mã"]);
    } else if (kind === "NC") {
      setWidths(ws, [6, 50, 8, 15, 16, 10, 20, noteW, 12]);
      header(ws, 3, ["TT", "Tên nhân công / công tác", "ĐVT", "Tổng KL", "Đơn giá", "% quản lý", "Thành tiền", "Ghi chú", "Mã"]);
    } else {
      setWidths(ws, [6, 50, 8, 15, 10, 16, 20, 8, 20, noteW, 16]);
      header(ws, 3, ["TT", "Tên thiết bị / công tác", "ĐVT", "Tổng KL", "Thời gian thuê (ngày)", "Đơn giá \n(trước VAT)", "Thành tiền \n(trước VAT)", "VAT %", "Thành tiền \n(sau VAT)", "Ghi chú", "Mã"]);
    }
    ws.views = [{ state: "frozen", ySplit: 3 }];
    for (const sec of ["A", "B"] as const) {
      const sr = lay.secRow[sec];
      const row = ws.getRow(sr);
      row.getCell(1).value = sec;
      row.getCell(n(C.name)).value = cfg[sec];
      if (lay.secLast[sec] > sr) for (const col of amtCols) formula(row.getCell(n(col)), `SUBTOTAL(9,${col}${sr + 1}:${col}${lay.secLast[sec]})`, ACC0);
      styleRow(row, 1, nc, { fill: F_SEC, bold: true });
      const secGroups = groups.filter((g) => g.section === sec);
      const writeRow = (r: SheetRow, no: number) => {
        const rr = lay.rowOf.get(r) as number;
        const row = ws.getRow(rr);
        row.getCell(1).value = no;
        row.getCell(n(C.name)).value = r.name;
        row.getCell(n(C.name)).alignment = { wrapText: true };
        row.getCell(n(C.unit)).value = r.unit;
        row.getCell(n(C.unit)).alignment = CENTER;
        if (!r.manual) row.getCell(n(C.code)).value = r.code;
        // Tổng KL: dòng tự thêm nhập tay; dòng chiết tính cộng theo đúng loại (vật liệu / nhân công / máy) từ CHI TIẾT
        // SUMPRODUCT (so khớp chính xác) thay SUMIFS để mã tài nguyên chứa * ? < > ~ không bị hiểu là ký tự đặc biệt
        if (r.manual) fieldCell(row.getCell(n(C.qty)), r.qty, r.qtyFormula, ACC2);
        else formula(row.getCell(n(C.qty)), `SUMPRODUCT((${CT("B")}=${C.code}${rr})*${ctIs[kind]}*${CT("H")}/(1+${CT("G")}))`, ACC2);
        fieldCell(row.getCell(n(C.price)), r.priceAfterVat, r.priceFormula, kind === "VT" ? MONEY : ACC0);
        if (C.vat) input(row.getCell(n(C.vat)), r.vatPercent / 100, "0.0%");
        if (kind === "VT") formula(row.getCell(n(C.calc as string)), `${C.price}${rr}/(1+${C.vat}${rr})`, MONEY); // đơn giá trước VAT
        if (kind === "NC" && !r.manual && r.mgmtPct) input(row.getCell(n(C.mgmt as string)), r.mgmtPct / 100, "0.0#%");
        // Thành tiền = Tổng KL × đơn giá (vật tư: sau VAT × (1 + hao hụt); nhân công: × (1 + % quản lý); dòng thuê: × số ngày)
        let amt = `${C.qty}${rr}*${C.price}${rr}`;
        if (kind === "NC") amt += `*(1+${C.mgmt}${rr})`;
        if (kind === "VT") {
          if (r.wastagePercent !== null) {
            input(row.getCell(n(C.waste as string)), r.wastagePercent / 100, "0.0%");
            amt += `*(1+${C.waste}${rr})`;
          } else {
            // chưa nhập hao hụt chung: hao hụt theo từng định mức → giữ tỷ lệ bình quân để ra đúng số CHI TIẾT
            const implied = r.qty > 0 && r.priceAfterVat > 0 ? r.amount / (r.qty * r.priceAfterVat) - 1 : 0;
            amt += Math.abs(implied) > 1e-9 ? `*(1+IF(${C.waste}${rr}="",${+implied.toPrecision(10)},${C.waste}${rr}))` : `*(1+${C.waste}${rr})`;
          }
        }
        if (kind === "TB" && r.manual && r.days != null) {
          input(row.getCell(n(C.days as string)), r.days, "#,##0");
          amt += `*${C.days}${rr}`;
        }
        formula(row.getCell(n(C.amt)), amt, ACC0);
        if (C.amtVat) formula(row.getCell(n(C.amtVat)), `${C.amt}${rr}*(1+${C.vat}${rr})`, ACC0);
        row.getCell(n(C.note)).value = r.note;
        row.getCell(n(C.note)).alignment = { wrapText: true };
        for (let c = 1; c <= nc; c++) row.getCell(c).border = BOX;
      };
      for (const g of secGroups) {
        const gr = lay.groupRow.get(g.id) as number;
        const grow = ws.getRow(gr);
        grow.getCell(n(C.name)).value = g.name;
        const last = lay.groupLast.get(g.id) as number;
        if (last > gr) for (const col of amtCols) formula(grow.getCell(n(col)), `SUBTOTAL(9,${col}${gr + 1}:${col}${last})`, ACC0);
        styleRow(grow, 1, nc, { fill: FILL("FFEFF6FF"), bold: true });
        rows.filter((x) => x.section === sec && x.groupId === g.id).forEach((r, i) => writeRow(r, i + 1));
      }
      const loose = rows.filter((x) => x.section === sec && (!x.groupId || !secGroups.some((g) => g.id === x.groupId)));
      if (lay.labelRow[sec]) {
        const lr = ws.getRow(lay.labelRow[sec] as number);
        lr.getCell(n(C.name)).value = "Chưa phân nhóm";
        lr.font = { italic: true, color: { argb: "FF64748B" } };
      }
      loose.forEach((r, i) => writeRow(r, i + 1));
    }
    const tr = ws.getRow(lay.totalRow);
    tr.getCell(n(C.name)).value = "TỔNG CỘNG";
    for (const col of amtCols) formula(tr.getCell(n(col)), `${col}${lay.secRow.A}+${col}${lay.secRow.B}`, ACC0);
    styleRow(tr, 1, nc, { fill: F_HEAD, bold: true });
    for (let rr = 4; rr <= lay.totalRow; rr++) ws.getCell(rr, 1).alignment = CENTER;
  }

  // ============ 4. CHI TIẾT ============
  {
    const ws = wsCt;
    const NC = 22; // số cột hiển thị
    const MONEY_Z = "#,##0;-#,##0;;@"; // ô tiền = 0 để trống (giống bảng trên phần mềm)
    const PCT_Z = "0.00%;-0.00%;;@";
    // độ rộng theo file chuẩn; cột Thành tiền tự rộng thêm nếu dự án có số lớn hơn
    const sumAmt = (rows: SheetRow[]) => rows.reduce((t, r) => t + (r.amount || 0), 0);
    const [amtVt, amtNc, amtTb] = [sumAmt(thVT.rows), sumAmt(thNC.rows), sumAmt(thTB.rows)];
    const amtTp = project.subcontractorItems.reduce((t, x) => t + x.quantity * x.unitPrice, 0);
    const amtAll = amtVt + amtNc + amtTb + amtTp;
    setWidths(ws, [6, 13, 48, 8, 11, 9.4, 8, 11, 11, 11, 9.1, 11, 11, 9.1, fitWidth(15, amtVt), fitWidth(15.4, amtNc), fitWidth(12.4, amtNc * project.ncKhacRate), fitWidth(16.6, amtTp), fitWidth(12.4, amtTb + amtNc * project.tbRate), fitWidth(12.4, amtAll * project.mmtbRate), fitWidth(16.6, amtAll), 14]);
    ws.getColumn(2).hidden = true;
    ws.getCell("A1").value = `CHI TIẾT chiết tính — ${project.name}`;
    ws.getCell("A1").font = { bold: true, size: 13 };
    ws.getCell("A2").value = "Mỗi công tác: dòng công tác rồi các dòng hao phí, phần giao thầu phụ. Đơn giá tài nguyên và hao hụt vật tư lấy từ các sheet TH; đơn giá thầu phụ lấy từ TH Thầu Phụ.";
    ws.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF64748B" } };
    header(ws, 3, ["TT", "Mã ĐM", "DIỄN GIẢI", "Đơn vị", "Khối lượng", "Định mức", "Hao hụt", "Tổng KL", "ĐƠN GIÁ", "", "", "", "", "", "THÀNH TIỀN (VND)", "", "", "", "", "", "", "Đơn giá TTP"]);
    header(ws, 4, ["", "", "", "", "", "", "", "", "Vật tư", "Nhân công", "Nhân công khác", "Thầu phụ", "Thiết bị", "MMTB + VT phụ", "Vật tư", "Nhân công", "Nhân công khác", "Thầu phụ", "Thiết bị", "MMTB + VT phụ", "Tổng cộng", ""]);
    for (const c of [1, 2, 3, 4, 5, 6, 7, 8, 22]) ws.mergeCells(3, c, 4, c);
    ws.mergeCells(3, 9, 3, 14);
    ws.mergeCells(3, 15, 3, 21);
    // dòng tỷ lệ áp dụng chung: ô nhập, các dòng hao phí và DT-CP lấy từ đây
    {
      const row = ws.getRow(5);
      row.getCell(1).value = "Tỷ lệ áp dụng chung cho tất cả công tác ▸";
      ws.mergeCells(5, 1, 5, 8);
      row.getCell(1).alignment = { horizontal: "right" };
      input(row.getCell(11), project.ncKhacRate, "0.00%");
      input(row.getCell(13), project.tbRate, "0.00%");
      input(row.getCell(14), project.mmtbRate, "0.00%");
      styleRow(row, 1, NC, { fill: FILL("FFFEF9C3"), bold: true });
    }
    ws.views = [{ state: "frozen", ySplit: 5, xSplit: 3 }];
    const finishRow = (row: ExcelJS.Row) => {
      for (let c = 1; c <= NC; c++) row.getCell(c).border = BOX;
      row.getCell(3).alignment = { wrapText: true, vertical: "top" };
    };
    const hdrRows: number[] = []; // các dòng công tác đã qua (dòng tổng trước thuế / VAT / sau thuế cộng từ đây)
    const AMT_COLS = [15, 16, 17, 18, 19, 20, 21];
    let itemNo = 0;
    for (const cr of ctRows) {
      if (cr.kind === "divider") {
        const row = ws.getRow(cr.row);
        row.getCell(3).value = `SHEET BỔ SUNG: ${cr.name}`;
        styleRow(row, 1, NC, { fill: FILL("FF1E293B"), bold: true });
        for (let c = 1; c <= NC; c++) row.getCell(c).font = { bold: true, color: { argb: "FFFFFFFF" } };
        continue;
      }
      if (cr.kind === "heading") {
        const row = ws.getRow(cr.row);
        const kind = summaryKind(cr.item.rawDescription);
        if (kind) {
          // 3 dòng tổng: cộng 7 cột Thành tiền của các công tác phía trên (× VAT theo khai báo của dự án)
          const vatPct = +(project.vatRate * 100).toFixed(2);
          row.getCell(3).value = kind === "subtotal" ? "TỔNG CỘNG TRƯỚC THUẾ" : kind === "vat" ? `THUẾ VAT ${vatPct}%` : "TỔNG CỘNG SAU THUẾ";
          const f = kind === "subtotal" ? "" : kind === "vat" ? `*${INFO.vat}` : `*(1+${INFO.vat})`;
          if (hdrRows.length) for (const c of AMT_COLS) formula(row.getCell(c), `SUM(${compressRows(L(c), hdrRows)})${f}`, MONEY);
          styleRow(row, 1, NC, { fill: FILL("FFFEF9C3"), bold: true });
          continue;
        }
        const depth = boqL.get(cr.item.sheetId ?? null)?.tree.depthOf.get(cr.item.id) ?? 0;
        row.getCell(1).value = cr.item.stt;
        row.getCell(1).alignment = CENTER;
        row.getCell(3).value = cr.item.rawDescription;
        styleRow(row, 1, NC, { fill: F_HEADING[Math.min(depth, 3)], bold: true });
        continue;
      }
      const b = cr.item;
      const blk = cr.block;
      const isSub = b.method === "SUB";
      itemNo++;
      hdrRows.push(blk.hdr);
      const unit = b.rawUnit || b.workItem?.unit || "";
      const row = ws.getRow(blk.hdr);
      row.getCell(1).value = b.stt || itemNo;
      row.getCell(1).alignment = { horizontal: "center", vertical: "top" };
      row.getCell(2).value = b.workItem?.code || (isSub ? "Thầu phụ" : "Chưa có định mức");
      // diễn giải: mô tả BOQ + ghi chú quy đổi ĐVT
      const uf = project.unitFactors.get(b.id) ?? 1;
      const small: string[] = [];
      if (b.workItem && project.unitFactors.has(b.id)) small.push(`ĐVT BOQ: ${b.rawUnit} · ĐVT định mức: ${b.workItem.unit} → quy đổi ×${+uf.toPrecision(6)}`);
      if (b.workItem && unitMismatch(b.rawUnit, b.workItem.unit)) small.push(`⚠ ĐVT BOQ (${b.rawUnit}) khác ĐVT định mức (${b.workItem.unit}) — chưa quy đổi được`);
      const desc = b.rawDescription || b.workItem?.name || "(không có mô tả)";
      row.getCell(3).value = small.length ? { richText: [{ text: desc, font: { bold: true } }, { text: `\n${small.join("\n")}`, font: { size: 8, color: { argb: "FF64748B" } } }] } : desc;
      row.getCell(4).value = unit;
      row.getCell(4).alignment = { horizontal: "center", vertical: "top" };
      formula(row.getCell(5), boqRowRef(b.id, "E"), QTY);
      const subRows = blk.subs.flatMap((s) => [s.row, ...s.ql.map((q) => q.row)]);
      if (blk.lines > 0) for (const c of [15, 16, 17, 19, 20]) formula(row.getCell(c), `SUM(${L(c)}${blk.a}:${L(c)}${blk.b})`, MONEY_Z);
      if (isSub) {
        // giao thầu phụ cả công tác: đơn giá + thành tiền lấy từ TH Thầu Phụ
        const s = project.subcontractorItems.find((x) => x.boqItemId === b.id && tpRowOfSub.has(x.id));
        if (s) {
          formula(row.getCell(12), abs(SH.tp, "E", tpRowOfSub.get(s.id) as number), MONEY_Z);
          formula(row.getCell(18), abs(SH.tp, "H", tpRowOfSub.get(s.id) as number), MONEY_Z);
        }
      } else if (subRows.length) formula(row.getCell(18), `SUM(${compressRows("R", subRows)})`, MONEY_Z);
      formula(row.getCell(21), `SUM(O${blk.hdr}:T${blk.hdr})`, MONEY_Z);
      // Đơn giá TTP = Tổng cộng / Khối lượng (KL = 0 để trống); sheet BOQ lấy đơn giá từ duy nhất cột này
      const fixedPrice = !isSub && blk.lines === 0 && blk.subs.length === 0 ? Math.round(boqDirectUnitPrice(b, project, subUnitByBoq.get(b.id) ?? 0)) : 0;
      if (fixedPrice) input(row.getCell(22), fixedPrice, MONEY_Z); // chưa có hao phí: giá cố định theo danh mục
      else formula(row.getCell(22), `IF(E${blk.hdr}=0,"",U${blk.hdr}/E${blk.hdr})`, MONEY_Z);
      finishRow(row);
      styleRow(row, 1, NC, { fill: FILL(isSub ? "FFFFF7ED" : "FFECFEFF"), bold: true });
      if (!b.workItem && !isSub) row.getCell(2).font = { bold: true, italic: true, color: { argb: "FFDC2626" } };
      if (blk.title) {
        const tr = ws.getRow(blk.title);
        tr.getCell(3).value = "Trực tiếp phí";
        tr.getCell(3).font = { bold: true, italic: true, underline: true };
        for (let c = 1; c <= NC; c++) tr.getCell(c).border = BOX;
      }
      const lineRow = new Map<string, number>(); // id dòng hao phí → số dòng Excel
      if (blk.lines > 0) {
        // cùng thứ tự với phần mềm: vật tư → nhân công → thiết bị
        const ORDER: Record<string, number> = { VT: 0, NC: 1, TB: 2 };
        [...(b.workItem?.resources ?? [])].sort((x, y) => ORDER[x.category] - ORDER[y.category]).forEach((line, i) => {
          const rr = blk.a + i;
          lineRow.set(line.id, rr);
          const lr = ws.getRow(rr);
          const thKind = line.category as SheetKind;
          const lay = thL[thKind];
          const sheet = KIND_SHEET[thKind];
          const match = `MATCH(B${rr},${absRange(sheet, TH_COL[thKind].code, lay.first, lay.last)},0)`;
          const extra = line as typeof line & LineExtra;
          const own = extra.ownFactor ?? 1; // phần khối lượng mình tự làm (phần còn lại giao thầu phụ)
          const base = extra.baseQuantity ?? line.quantity;
          lr.getCell(2).value = line.resource.code;
          lr.getCell(2).font = { size: 8, color: { argb: "FF94A3B8" } };
          lr.getCell(3).value = own < 1 ? `${line.resource.name} (mình tự làm ${Math.round(own * 100)}%)` : line.resource.name;
          lr.getCell(3).font = { italic: true };
          lr.getCell(4).value = line.resource.unit;
          lr.getCell(4).alignment = { horizontal: "center" };
          formula(lr.getCell(5), `$E$${blk.hdr}`, QTY);
          // định mức theo ĐVT BOQ (đã quy đổi), chưa nhân phần tự làm - phần tự làm nhân ở Tổng KL
          const qf = line.quantityFormula ? toExcelNormFormula(line.quantityFormula) : null;
          if (qf) input(lr.getCell(6), { formula: Math.abs(uf - 1) > 1e-12 ? `(${qf})*${+uf.toPrecision(12)}` : qf } as ExcelJS.CellFormulaValue, ACC2);
          else input(lr.getCell(6), +(base * uf).toPrecision(12), ACC2);
          if (line.category === "VT") formula(lr.getCell(7), `IF(INDEX(${absRange(sheet, TH_COL.VT.waste as string, lay.first, lay.last)},${match})="",${line.wastageRate},INDEX(${absRange(sheet, TH_COL.VT.waste as string, lay.first, lay.last)},${match}))`, "0.0%");
          const ownX = own < 1 ? `*${+own.toPrecision(12)}` : "";
          formula(lr.getCell(8), `E${rr}*F${rr}*(1+G${rr})${ownX}`, QTY);
          // đơn giá tính vào chi phí: vật tư trước VAT; nhân công đã gồm % quản lý của đội; thiết bị đơn giá nhập
          const thC = TH_COL[thKind];
          const priceRef = thKind === "NC" ? `INDEX(${absRange(sheet, thC.price, lay.first, lay.last)},${match})*(1+INDEX(${absRange(sheet, thC.mgmt as string, lay.first, lay.last)},${match}))` : `INDEX(${absRange(sheet, (thC.calc ?? thC.price) as string, lay.first, lay.last)},${match})`;
          const priceCol = { VT: 9, NC: 10, TB: 13 }[thKind];
          const pL = L(priceCol);
          formula(lr.getCell(priceCol), priceRef, MONEY);
          if (thKind === "NC") {
            formula(lr.getCell(11), "$K$5", PCT_Z);
            formula(lr.getCell(13), "$M$5", PCT_Z);
          }
          formula(lr.getCell(14), "$N$5", PCT_Z);
          const amt = `H${rr}*${pL}${rr}`;
          if (thKind === "VT") formula(lr.getCell(15), amt, MONEY_Z);
          if (thKind === "NC") {
            formula(lr.getCell(16), amt, MONEY_Z);
            formula(lr.getCell(17), `P${rr}*K${rr}`, MONEY_Z);
            formula(lr.getCell(19), `P${rr}*M${rr}`, MONEY_Z);
          }
          if (thKind === "TB") formula(lr.getCell(19), amt, MONEY_Z);
          formula(lr.getCell(20), `SUM(O${rr}:S${rr})*N${rr}`, MONEY_Z);
          formula(lr.getCell(21), `SUM(O${rr}:T${rr})`, MONEY_Z);
          finishRow(lr);
        });
      }
      for (const s of blk.subs) {
        const x = s.sub;
        const tpRow = tpRowOfSub.get(x.id);
        const sr = ws.getRow(s.row);
        const covered = parseCoveredLines(x.coveredLines);
        const res = b.workItem?.resources ?? [];
        const scope = covered ? (covered.length ? res.filter((l) => covered.includes(l.id)).map((l) => l.resource.name).join(", ") : "phần việc riêng ngoài định mức") : scopeLabel(x);
        sr.getCell(2).value = "Thầu phụ";
        sr.getCell(2).font = { size: 8, bold: true, color: { argb: "FFC2410C" } };
        sr.getCell(3).value = `${x.note.trim() || `Giao thầu phụ (${scope})`}${x.contractorName.trim() ? ` — ${x.contractorName.trim()}` : ""}`;
        sr.getCell(3).font = { italic: true };
        sr.getCell(4).value = unit;
        sr.getCell(4).alignment = { horizontal: "center" };
        if (tpRow) {
          formula(sr.getCell(5), abs(SH.tp, "D", tpRow), QTY);
          formula(sr.getCell(12), abs(SH.tp, "E", tpRow), MONEY_Z);
        } else {
          input(sr.getCell(5), x.quantity, QTY);
          input(sr.getCell(12), x.unitPrice, MONEY_Z);
        }
        formula(sr.getCell(8), `E${s.row}`, QTY);
        formula(sr.getCell(18), `E${s.row}*L${s.row}`, MONEY_Z);
        formula(sr.getCell(21), `R${s.row}`, MONEY_Z);
        finishRow(sr);
        styleRow(sr, 1, NC, { fill: FILL("FFFFF7ED") });
        // chi phí quản lý vật tư / thiết bị TMN cấp: % × giá trị TMN cấp → cột Thầu phụ
        for (const q of s.ql) {
          const qr = ws.getRow(q.row);
          qr.getCell(2).value = q.kind === "vt" ? "QL VT" : "QL TB";
          qr.getCell(2).font = { size: 8, bold: true, color: { argb: "FF6D28D9" } };
          qr.getCell(3).value = `${q.kind === "vt" ? "Quản lý vật tư TMN cấp" : "Quản lý thiết bị TMN cấp"} = % × giá trị ${q.kind === "vt" ? "vật tư" : "thiết bị"} cấp`;
          qr.getCell(3).font = { italic: true };
          qr.getCell(4).value = "%";
          qr.getCell(4).alignment = { horizontal: "center" };
          input(qr.getCell(6), +(q.pct / 100).toPrecision(8), "0.0#%");
          // giá trị TMN cấp = Σ (định mức × đơn giá × (1 + hao hụt)) các dòng vật tư / thiết bị thầu phụ không bao × KL giao
          const cat = q.kind === "vt" ? "VT" : "TB";
          const pc = q.kind === "vt" ? "I" : "M";
          const terms = res.filter((l) => l.category === cat && !subCovers(x, l)).map((l) => lineRow.get(l.id)).filter((v): v is number => v !== undefined).map((v) => `F${v}*${pc}${v}*(1+G${v})`);
          if (terms.length) formula(qr.getCell(12), `(${terms.join("+")})*E${s.row}`, MONEY_Z);
          else input(qr.getCell(12), Math.round(q.base), MONEY_Z);
          formula(qr.getCell(18), `F${q.row}*L${q.row}`, MONEY_Z);
          formula(qr.getCell(21), `R${q.row}`, MONEY_Z);
          finishRow(qr);
          styleRow(qr, 1, NC, { fill: FILL("FFF5F3FF") });
        }
      }
    }
    let next = ctNext;
    // BOQ không có dòng tổng riêng: thêm dòng tổng cộng cuối bảng
    if (hdrRows.length && !project.boqItems.some((x) => x.isHeading && summaryKind(x.rawDescription))) {
      const row = ws.getRow(next++);
      row.getCell(3).value = "TỔNG CỘNG";
      for (const c of AMT_COLS) formula(row.getCell(c), `SUM(${compressRows(L(c), hdrRows)})`, MONEY);
      styleRow(row, 1, NC, { fill: FILL("FFFEF9C3"), bold: true });
    }
    // Bảng tự do được đưa vào CHI TIẾT: thành tiền ở cột chi phí đã chọn (số liên kết từ sheet đó)
    const LINK_COL: Record<string, number> = { vt: 15, nc: 16, nck: 17, tp: 18, tb: 19, mmtb: 20 };
    for (const g of gridSheetsDb) {
      const gl = gridL.get(g.id) as GridLayout;
      if (!g.linkCol || g.amountCol === null) continue;
      const pos = LINK_COL[g.linkCol] ?? 18;
      const banner = ws.getRow(next++);
      banner.getCell(3).value = `SHEET BỔ SUNG (bảng tự do): ${gl.name}`;
      styleRow(banner, 1, NC, { fill: FILL("FF1E293B"), bold: true });
      for (let c = 1; c <= NC; c++) banner.getCell(c).font = { bold: true, color: { argb: "FFFFFFFF" } };
      const raw = new Map(g.cells.map((c) => [`${c.row}:${c.col}`, c.value]));
      const headAt = new Map(g.metas.map((m) => [m.row, m.title]));
      const descCol = g.amountCol === 0 ? 1 : 0;
      const amtL = L(g.amountCol + 1);
      const itemRows: number[] = [];
      let seq = 0;
      let headRow = 0; // dòng đầu mục đang mở (cộng các dòng bên dưới tới đầu mục kế tiếp)
      const closeHead = (end: number) => {
        if (headRow && end > headRow) {
          const hr = ws.getRow(headRow);
          formula(hr.getCell(pos), `SUM(${L(pos)}${headRow + 1}:${L(pos)}${end})`, MONEY_Z);
          formula(hr.getCell(21), `${L(pos)}${headRow}`, MONEY_Z);
        }
        headRow = 0;
      };
      for (let r = 0; r < g.rowCount; r++) {
        if (headAt.has(r)) {
          closeHead(next - 1);
          const hr = ws.getRow(next);
          hr.getCell(3).value = headAt.get(r);
          styleRow(hr, 1, NC, { fill: F_HEADING[1], bold: true });
          headRow = next;
          next++;
          continue;
        }
        const d = (raw.get(`${r}:${descCol}`) ?? "").trim();
        const a = (raw.get(`${r}:${g.amountCol}`) ?? "").trim();
        if (!d && !a) continue;
        const er = r + 1 + gl.offset;
        const sr = ws.getRow(next);
        sr.getCell(1).value = ++seq;
        sr.getCell(1).alignment = { horizontal: "center" };
        if (d.startsWith("=")) formula(sr.getCell(3), abs(gl.name, L(descCol + 1), er));
        else sr.getCell(3).value = d;
        formula(sr.getCell(pos), abs(gl.name, amtL, er), MONEY_Z);
        formula(sr.getCell(21), `${L(pos)}${next}`, MONEY_Z);
        finishRow(sr);
        itemRows.push(next);
        next++;
      }
      closeHead(next - 1);
      const tr = ws.getRow(next++);
      tr.getCell(3).value = `Tổng sheet "${gl.name}"`;
      if (itemRows.length) {
        formula(tr.getCell(pos), `SUM(${compressRows(L(pos), itemRows)})`, MONEY_Z);
        formula(tr.getCell(21), `SUM(${compressRows("U", itemRows)})`, MONEY_Z);
      }
      styleRow(tr, 1, NC, { fill: FILL("FFFEF9C3"), bold: true });
    }
  }

  // ============ 5. BOQ (sheet chính + sheet BOQ bổ sung) ============
  const imagesByBoq = new Map<string, { fileName: string }[]>();
  for (const im of await prisma.boqImage.findMany({ where: { projectId: project.id }, orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }], select: { boqItemId: true, fileName: true } })) {
    const l = imagesByBoq.get(im.boqItemId) ?? [];
    l.push(im);
    imagesByBoq.set(im.boqItemId, l);
  }
  for (const bs of allBoqSheets) {
    const ws = wsBoqs.get(bs.id) as ExcelJS.Worksheet;
    const lay = boqL.get(bs.id) as BoqLayout;
    setWidths(ws, [8, 60, 18, 9.1, 14, 18, 20, 9.1, 18, 20, 28]);
    ws.getColumn(3).hidden = true;
    ws.getCell("A1").value = (bs.id === null ? "BẢNG KHỐI LƯỢNG (BOQ)" : bs.name.toUpperCase()) + ` — ${project.name}`;
    ws.getCell("A1").font = { bold: true, size: 13 };
    ws.getCell("A2").value = "Chữ xanh = ô nhập (khối lượng, đơn giá báo CĐT, tỷ lệ %). Đơn giá trực tiếp phí lấy từ cột Đơn giá TTP của CHI TIẾT; đầu mục có Subtotal tự cộng.";
    ws.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF64748B" } };
    header(ws, 4, ["TT", "Mô tả công việc (BOQ)", "Mã định mức", "ĐVT", "Khối lượng", "Trực tiếp phí", "", "Dg0", "Báo giá CĐT", "", "Ghi chú"]);
    header(ws, 5, ["", "", "", "", "", "Đơn giá", "Thành tiền", "", "Đơn giá", "Thành tiền", ""]);
    for (const c of [1, 2, 3, 4, 5, 8, 11]) ws.mergeCells(4, c, 5, c);
    ws.mergeCells(4, 6, 4, 7);
    ws.mergeCells(4, 9, 4, 10);
    ws.views = [{ state: "frozen", ySplit: 5 }];
    const items = lay.items;
    const depthOf = (id: string) => lay.tree.depthOf.get(id) ?? 0;
    const rowN = (b: BoqItem) => lay.rowOf.get(b.id) as number;
    // khối dòng nằm dưới 1 đầu mục (tới đầu mục kế tiếp cùng cấp hoặc cao hơn)
    const blockEnd = (i: number) => {
      const d = depthOf(items[i].id);
      let j = i + 1;
      // các dòng tổng cuối BOQ (Tổng cộng / VAT) không thuộc đầu mục nào
      while (j < items.length && !(items[j].isHeading && summaryKind(items[j].rawDescription)) && (!items[j].isHeading || depthOf(items[j].id) > d)) j++;
      return j - 1;
    };
    // dòng có thành tiền (công tác + đầu mục không con đã liên kết giá), loại các dòng cùng chiều đang tính theo %
    const amountRowsIn = (lo: number, hi: number, side: "d" | "q", exceptRow: number) => {
      const rows: number[] = [];
      for (let k = lo; k <= hi; k++) {
        const it = items[k];
        const rr = rowN(it);
        if (rr === exceptRow) continue;
        if (!it.isHeading) rows.push(rr);
        else if (lay.childless.has(it.id) && (it.directMode || it.quotedMode)) {
          const mode = side === "d" ? it.directMode : it.quotedMode;
          if (mode !== "PCT") rows.push(rr);
        }
      }
      return rows;
    };
    // vùng dữ liệu: tới dòng ngay trước các dòng tổng cuối BOQ (Tổng cộng / VAT)
    const firstSummary = items.findIndex((x) => x.isHeading && summaryKind(x.rawDescription));
    const dataLast = firstSummary >= 0 ? rowN(items[firstSummary]) - 1 : lay.last;
    const plainRows = new Set<string>();
    let baseCell: { g: string; j: string } | null = null; // dòng "Tổng cộng trước thuế" đầu tiên (cho dòng VAT / sau thuế)
    items.forEach((b, i) => {
      const r = rowN(b);
      const row = ws.getRow(r);
      row.getCell(1).value = b.stt;
      if (b.note) row.getCell(11).value = b.note;
      if (b.isHeading) {
        const kind = summaryKind(b.rawDescription);
        row.getCell(2).value = b.rawDescription;
        if (kind) {
          const f = kind === "subtotal" ? "1" : kind === "vat" ? INFO.vat : `(1+${INFO.vat})`;
          for (const col of ["G", "J"]) {
            const base = baseCell && kind !== "subtotal" ? `${baseCell[col === "G" ? "g" : "j"]}` : null;
            if (base) formula(row.getCell(col === "G" ? 7 : 10), `${base}*${f}`, ACC0);
            else formula(row.getCell(col === "G" ? 7 : 10), kind === "subtotal" ? `SUBTOTAL(9,${col}${lay.first}:${col}${dataLast})` : `SUBTOTAL(9,${col}${lay.first}:${col}${dataLast})*${f}`, ACC0);
          }
          if (kind === "subtotal" && !baseCell) baseCell = { g: `G${r}`, j: `J${r}` };
          styleRow(row, 1, 11, { fill: FILL("FFFEF9C3"), bold: true });
          return;
        }
        const linked = lay.childless.has(b.id) && (b.directMode || b.quotedMode);
        const end = blockEnd(i);
        // dòng diễn giải (không số thứ tự, không dòng con): trình bày như dòng thường, không tô màu đầu mục
        if (!linked && end === i && !String(b.stt ?? "").trim()) {
          plainRows.add(b.id);
          for (let c = 1; c <= 11; c++) row.getCell(c).border = BOX;
          return;
        }
        if (linked) {
          // đầu mục liên kết giá: ĐVT "%" + tỷ lệ khi tính theo %
          const pctMode = b.quotedMode === "PCT" ? "q" : b.directMode === "PCT" ? "d" : null;
          if (pctMode) {
            row.getCell(4).value = "%";
            input(row.getCell(5), (pctMode === "q" ? (b.quotedPct ?? 0) : (b.directPct ?? 0)) / 100, "0.0#%");
          }
          const baseRows = (baseId: string | null, side: "d" | "q") => {
            const bi = items.findIndex((x) => x.id === baseId);
            if (bi < 0) return null;
            const col = side === "d" ? "G" : "J";
            const baseEnd = blockEnd(bi);
            // gọn nhất: lấy thẳng ô thành tiền của đầu mục gốc (VD Prelim = % x dòng AA); chỉ cộng từng dòng khi đầu mục đó chứa chính dòng này hoặc dòng tính theo % khác
            const hasPct = items.slice(bi + 1, baseEnd + 1).some((x) => x.isHeading && lay.childless.has(x.id) && (side === "d" ? x.directMode : x.quotedMode) === "PCT");
            if (baseEnd > bi && items[bi].isHeading && !lay.childless.has(items[bi].id) && !hasPct && !(i > bi && i <= baseEnd)) return `${col}${rowN(items[bi])}`;
            const rows = amountRowsIn(bi + 1, baseEnd, side, r);
            return rows.length ? `SUM(${compressRows(col, rows)})` : "0";
          };
          // Trực tiếp phí
          if (b.directMode === "LINK") {
            const ref = b.directLink ? gridRef(b.directLink) : null;
            formula(row.getCell(7), ref ?? "0", ACC0);
          } else if (b.directMode === "PCT") {
            const base = baseRows(b.directBaseId, "d");
            const pctRef = pctMode === "d" ? `$E${r}` : String((b.directPct ?? 0) / 100);
            formula(row.getCell(7), `${pctRef}*${base ?? "0"}`, ACC0);
          } else formula(row.getCell(7), "0", ACC0);
          // Báo giá CĐT
          if (b.quotedMode === "LINK") {
            const ref = b.quotedLink ? gridRef(b.quotedLink) : null;
            formula(row.getCell(10), ref ?? "0", ACC0);
          } else if (b.quotedMode === "PCT") {
            const base = baseRows(b.quotedBaseId, "q");
            formula(row.getCell(10), `${base ?? "0"}*E${r}`, ACC0);
          }
          formula(row.getCell(8), `IF(AND(G${r}>0,ISNUMBER(J${r})),(J${r}-G${r})/G${r},"")`, "0.0%");
        } else if (end > i) {
          formula(row.getCell(7), `SUBTOTAL(9,G${r + 1}:G${rowN(items[end])})`, ACC0);
          formula(row.getCell(10), `SUBTOTAL(9,J${r + 1}:J${rowN(items[end])})`, ACC0);
        }
        styleRow(row, 1, 11, { fill: F_HEADING[Math.min(depthOf(b.id), 3)], bold: true });
        return;
      }
      // công tác
      row.getCell(2).value = b.rawDescription || b.workItem?.name || "(không có mô tả)";
      row.getCell(3).value = b.workItem?.code || "Chưa có ĐM";
      if (!b.workItem) row.getCell(3).font = { italic: true, color: { argb: "FFDC2626" } };
      row.getCell(4).value = b.rawUnit || b.workItem?.unit || "";
      input(row.getCell(5), b.quantity, QTY);
      // mọi đơn giá trực tiếp phí đều lấy từ cột Đơn giá TTP của CHI TIẾT
      formula(row.getCell(6), abs(SH.ct, "V", (ctOf.get(b.id) as CtBlock).hdr), ACC0);
      formula(row.getCell(7), `IF(E${r}=0,0,F${r}*E${r})`, ACC0); // KL = 0 thì Đơn giá TTP trống
      formula(row.getCell(8), `IF(AND(ISNUMBER(F${r}),ISNUMBER(I${r})),IF(F${r}>0,(I${r}-F${r})/F${r},""),"")`, "0.0%");
      if (b.quotedUnitPrice != null) input(row.getCell(9), b.quotedUnitPrice, ACC0);
      else row.getCell(9).font = { color: { argb: BLUE } };
      formula(row.getCell(10), `IF(ISNUMBER(I${r}),I${r}*E${r},"")`, ACC0);
      for (let c = 1; c <= 11; c++) row.getCell(c).border = BOX;
      row.getCell(8).font = { color: { argb: RED } };
    });
    // Dg0 âm (báo giá CĐT thấp hơn trực tiếp phí): tô đỏ cả ô, tự đổi theo số khi sửa trong Excel
    if (items.length) ws.addConditionalFormatting({ ref: `H${lay.first}:H${lay.last}`, rules: [{ type: "cellIs", operator: "lessThan", formulae: [0], priority: 1, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFDC2626" } }, font: { bold: true, color: { argb: "FFFFFFFF" } } } }] });
    // canh lề: đầu mục giữa, dòng thường mô tả trái, số phải
    const alignRow = (row: ExcelJS.Row, plain: boolean, note: boolean) => {
      for (let c = 1; c <= 11; c++) {
        const horizontal = c >= 7 && c <= 10 ? "right" : plain && c === 2 ? "left" : plain && (c === 5 || c === 6) ? "right" : "center";
        row.getCell(c).alignment = { horizontal, wrapText: c === 2 || (c === 11 && note) };
      }
    };
    for (const b of items) alignRow(ws.getRow(rowN(b)), !b.isHeading || plainRows.has(b.id), !!b.note);
    // tổng cộng cả sheet (BOQ đã có dòng Tổng trước thuế thì không thêm)
    const tr = ws.getRow(lay.ownTotal ? lay.last + 1 : lay.totalRow);
    if (!lay.ownTotal) tr.getCell(2).value = "TỔNG CỘNG";
    if (!lay.ownTotal && items.length > 0) {
      const tl = Math.max(lay.first, (() => { const fs2 = items.findIndex((x) => x.isHeading && summaryKind(x.rawDescription)); return fs2 >= 0 ? (lay.rowOf.get(items[fs2].id) as number) - 1 : lay.last; })());
      formula(tr.getCell(7), `SUBTOTAL(9,G${lay.first}:G${tl})`, ACC0);
      formula(tr.getCell(10), `SUBTOTAL(9,J${lay.first}:J${tl})`, ACC0);
    }
    if (!lay.ownTotal) {
      styleRow(tr, 1, 11, { fill: F_HEAD, bold: true });
      alignRow(tr, false, false);
    }

    // Cột L "Hình ảnh" (cuối bảng để không xê dịch cột công thức): ảnh thu nhỏ đặt trong ô của dòng, nhiều ảnh xếp ngang
    if (items.some((b) => imagesByBoq.has(b.id))) {
      const BOX_H = 80; // px
      const GAP = 4;
      const imgsPerRow = Math.max(...items.map((b) => imagesByBoq.get(b.id)?.length ?? 0));
      const colW = Math.min(60, Math.max(16, Math.ceil((Math.min(imgsPerRow, 3) * (110 + GAP)) / 7)));
      ws.getColumn(12).width = colW;
      const colPx = colW * 7 + 5;
      header(ws, 4, ["TT", "Mô tả công việc (BOQ)", "Mã định mức", "ĐVT", "Khối lượng", "Trực tiếp phí", "", "Dg0", "Báo giá CĐT", "", "Ghi chú", "Hình ảnh"]);
      ws.mergeCells(4, 12, 5, 12);
      for (const b of items) {
        const r = rowN(b);
        ws.getRow(r).getCell(12).border = BOX;
        const list = imagesByBoq.get(b.id);
        if (!list) continue;
        let x = GAP;
        let rowPx = 0;
        for (const im of list) {
          const e = await exportImageOf(im.fileName);
          if (!e) continue;
          const k = Math.min(BOX_H / e.height, 140 / e.width, 1);
          const w = Math.max(1, Math.round(e.width * k));
          const h = Math.max(1, Math.round(e.height * k));
          const id = wb.addImage({ buffer: e.buf as unknown as ExcelJS.Buffer, extension: e.ext });
          ws.addImage(id, { tl: { col: 11 + Math.min(x, colPx - 4) / colPx, row: r - 1 + GAP / 100 }, ext: { width: w, height: h }, editAs: "oneCell" });
          x += w + GAP;
          rowPx = Math.max(rowPx, h + 2 * GAP);
        }
        // dòng phải đủ cao chứa ảnh (đơn vị point ≈ px × 0.75), không thu thấp dòng đang cao hơn
        if (rowPx) ws.getRow(r).height = Math.max(ws.getRow(r).height ?? 15, Math.ceil(rowPx * 0.75));
      }
    }
  }
  const boqQuotedTotal = () => allBoqSheets.map((s) => abs(s.name, "J", (boqL.get(s.id) as BoqLayout).totalRow)).join("+");

  // ============ 6. TH THẦU PHỤ ============
  {
    const ws = wsTp;
    const hasNote = [...subSheet.boqRows.flatMap((x) => (x.type === "heading" ? [] : [x])), ...subSheet.looseItems, ...subSheet.groups.flatMap((g) => g.items)].some((it) => it.note?.trim());
    setWidths(ws, [8, 56, 9.1, 14, 18, 16, 16, 20, 9.1, 20, 28, hasNote ? 28 : 8.1]);
    const FEE_Z = "#,##0;-#,##0;;@"; // ô = 0 để trống
    // Giao thầu phụ phần nhân công (TMN cấp vật tư / thiết bị): thêm 2 cột chi phí quản lý tính trên 1 đơn vị khối lượng.
    // Thành tiền = KL × (đơn giá nhân công + chi phí quản lý vật tư + chi phí quản lý thiết bị). Dự án không có thì ẩn 2 cột này.
    const hasFee = project.subcontractorItems.some((x) => { const m = project.subMgmt.get(x.id); return !!m && (m.vtBase > 0 || m.tbBase > 0); });
    if (!hasFee) for (const c of [6, 7]) ws.getColumn(c).hidden = true;
    // dòng quản lý vật tư / thiết bị của từng phần giao ở CHI TIẾT (2 cột trên lấy số từ đó)
    const qlRowOf = new Map(Array.from(ctOf.values()).flatMap((blk) => blk.subs.map((sr) => [sr.sub.id, sr.ql] as const)));
    ws.getCell("A1").value = `TH THẦU PHỤ — ${project.name}`;
    ws.getCell("A1").font = { bold: true, size: 13 };
    ws.getCell("A2").value = "Công tác giao thầu phụ lấy khối lượng từ BOQ; đơn giá thầu phụ nhập ở đây (chữ xanh) và BOQ tự lấy lại.";
    ws.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF64748B" } };
    header(ws, 3, ["TT", "Nội dung", "ĐVT", "Khối lượng", hasFee ? "Đơn giá nhân công \n(trước VAT)" : "Đơn giá \n(trước VAT)", "Chi phí quản lý vật tư", "Chi phí quản lý thiết bị", "Thành tiền \n(trước VAT)", "VAT %", "Thành tiền \n(sau VAT)", "Nhà thầu phụ", "Ghi chú"]);
    ws.views = [{ state: "frozen", ySplit: 3 }];
    // dòng tổng "theo CHI TIẾT"
    {
      const row = ws.getRow(tpBoqTotalRow);
      row.getCell(2).value = "CÔNG TÁC THẦU PHỤ THEO CHI TIẾT (BOQ)";
      if (tpBoqItemRows.length) {
        formula(row.getCell(8), `SUBTOTAL(9,H${tpBoqFirst}:H${tpBoqLast})`, ACC0);
        formula(row.getCell(10), `SUBTOTAL(9,J${tpBoqFirst}:J${tpBoqLast})`, ACC0);
      } else {
        input(row.getCell(8), 0, ACC0);
        input(row.getCell(10), 0, ACC0);
      }
      styleRow(row, 1, 12, { fill: F_SEC, bold: true });
    }
    const subItemBoq = new Map(project.subcontractorItems.map((s) => [s.id, s.boqItemId]));
    const writeItem = (it: (typeof subSheet.looseItems)[number], r: number) => {
      const row = ws.getRow(r);
      row.getCell(1).value = it.stt;
      row.getCell(2).value = it.name;
      row.getCell(3).value = it.unit;
      const boqId = it.linked ? subItemBoq.get(it.id) : null;
      // khối lượng: giao trọn công tác = theo BOQ; giao theo % = % × BOQ; phần giao riêng = số nhập của phần đó
      const sub = project.subcontractorItems.find((x) => x.id === it.id);
      if (boqId && sub?.followBoq) formula(row.getCell(4), boqRowRef(boqId, "E"), ACC2);
      else if (boqId && sub?.percent != null) formula(row.getCell(4), `${boqRowRef(boqId, "E")}*${+sub.percent.toPrecision(12)}%`, ACC2);
      else if (it.qtyFormula?.trim().startsWith("=")) formula(row.getCell(4), userFormulaToExcel(it.qtyFormula), ACC2);
      else {
        row.getCell(4).value = it.qty;
        row.getCell(4).numFmt = ACC2;
      }
      fieldCell(row.getCell(5), it.unitPrice, it.unitPriceFormula, ACC0);
      // chi phí quản lý / 1 đơn vị khối lượng = số tiền ở dòng QL VT / QL TB của CHI TIẾT ÷ khối lượng giao
      for (const q of qlRowOf.get(it.id) ?? []) {
        const col = q.kind === "vt" ? 6 : 7;
        formula(row.getCell(col), `IF(D${r}=0,0,${abs(SH.ct, "R", q.row)}/D${r})`, FEE_Z);
      }
      formula(row.getCell(8), `D${r}*(E${r}+F${r}+G${r})${sub?.prelimPct ? `*(1+${+sub.prelimPct.toPrecision(12)}%)` : ""}`, ACC0); // gồm % Prelim của dòng (nếu có)
      input(row.getCell(9), it.vatRate, "0.0#%");
      formula(row.getCell(10), `H${r}*(1+I${r})`, ACC0);
      input(row.getCell(11), it.contractorName);
      row.getCell(12).value = it.note;
      for (let c = 1; c <= 12; c++) row.getCell(c).border = BOX;
    };
    const seq = subSheet.boqRows;
    const seqRow = (x: (typeof seq)[number]) => (x.type === "heading" ? tpHeadingRow.get(x.id) : tpRowOfSub.get(x.id)) as number;
    for (const [idx, row] of seq.entries()) {
      if (row.type === "heading") {
        const r = tpHeadingRow.get(row.id) as number;
        const rr = ws.getRow(r);
        rr.getCell(1).value = row.stt;
        rr.getCell(2).value = row.text;
        const rows = row.itemIds.map((id) => tpRowOfSub.get(id)).filter((x): x is number => x !== undefined);
        if (rows.length) {
          // hạng mục lớn: SUBTOTAL cả khối dòng bên dưới (tới đầu mục cùng cấp hoặc cao hơn); SUBTOTAL tự bỏ qua subtotal của đầu mục con
          let j = idx + 1;
          while (j < seq.length) {
            const nx = seq[j];
            if (nx.type === "heading" && nx.depth <= row.depth) break;
            j++;
          }
          const inBlock = seq.slice(idx + 1, j).filter((x) => x.type !== "heading").length;
          const sum = (col: string) => (inBlock === rows.length ? `SUBTOTAL(9,${col}${r + 1}:${col}${seqRow(seq[j - 1])})` : `SUM(${compressRows(col, rows)})`);
          formula(rr.getCell(8), sum("H"), ACC0);
          formula(rr.getCell(10), sum("J"), ACC0);
        }
        styleRow(rr, 1, 12, { fill: F_HEADING[Math.min(row.depth, 3)], bold: true });
      } else writeItem(row, tpRowOfSub.get(row.id) as number);
    }
    {
      const row = ws.getRow(tpManualTotalRow);
      row.getCell(2).value = "THẦU PHỤ BỔ SUNG";
      if (tpManualRows.length) {
        formula(row.getCell(8), `SUBTOTAL(9,H${tpManualTotalRow + 1}:H${tpTotalRow - 1})`, ACC0);
        formula(row.getCell(10), `SUBTOTAL(9,J${tpManualTotalRow + 1}:J${tpTotalRow - 1})`, ACC0);
      } else {
        input(row.getCell(8), 0, ACC0);
        input(row.getCell(10), 0, ACC0);
      }
      styleRow(row, 1, 12, { fill: F_SEC, bold: true });
    }
    for (const it of subSheet.looseItems) writeItem(it, tpRowOfSub.get(it.id) as number);
    for (const g of subSheet.groups) {
      const r = tpGroupRow.get(g.id) as number;
      const rr = ws.getRow(r);
      rr.getCell(2).value = g.name;
      const rows = tpGroupItemRows.get(g.id) ?? [];
      if (rows.length) {
        formula(rr.getCell(8), `SUBTOTAL(9,H${r + 1}:H${r + rows.length})`, ACC0);
        formula(rr.getCell(10), `SUBTOTAL(9,J${r + 1}:J${r + rows.length})`, ACC0);
      }
      styleRow(rr, 1, 12, { fill: FILL("FFEFF6FF"), bold: true });
      for (const it of g.items) writeItem(it, tpRowOfSub.get(it.id) as number);
    }
    const tr = ws.getRow(tpTotalRow);
    tr.getCell(2).value = "TỔNG CỘNG THẦU PHỤ";
    formula(tr.getCell(8), `SUBTOTAL(9,H${tpBoqTotalRow}:H${tpTotalRow - 1})`, ACC0);
    formula(tr.getCell(10), `SUBTOTAL(9,J${tpBoqTotalRow}:J${tpTotalRow - 1})`, ACC0);
    styleRow(tr, 1, 12, { fill: F_HEAD, bold: true });
    for (let r = 5; r <= tpTotalRow; r++) ws.getCell(r, 1).alignment = CENTER;
  }

  // ============ 7. BẢNG TỰ DO (GRID) ============
  for (const g of gridSheetsDb) {
    const gl = gridL.get(g.id) as GridLayout;
    const ws = wsGrids.get(g.id) as ExcelJS.Worksheet;
    const titles = JSON.parse(g.colTitles) as string[];
    const raw = new Map(g.cells.map((c) => [`${c.row}:${c.col}`, c]));
    const ev = createEvaluator((r, c) => raw.get(`${r}:${c}`)?.value ?? "", g.rowCount, titles.length);
    const headingRows = new Set(g.metas.map((m) => m.row));
    const metaByRow = new Map(g.metas.map((m) => [m.row, m]));
    const sortedHeads = [...g.metas].sort((a, b) => a.row - b.row);
    const headLabels = headingLabels(sortedHeads);
    const headerRows = JSON.parse(g.headerRows) as string[][];
    // dòng tiêu đề phụ: phần tử 0 sát dòng tên cột nhất, nên in từ trên xuống theo thứ tự đảo
    headerRows.forEach((_, j) => {
      const top = headerRows.length - 1 - j; // vị trí từ trên xuống của phần tử j
      header(ws, 1 + top, titles.map((__, c) => headerRows[j]?.[c] ?? ""));
    });
    header(ws, 1 + headerRows.length, titles.map((t, i) => t || `Cột ${i + 1}`));
    ws.views = [{ state: "frozen", ySplit: 1 + headerRows.length }];
    const amountColL = g.amountCol !== null ? L(g.amountCol + 1) : null;
    const sumCols = g.amountCol !== null ? [g.amountCol, ...extraAmountCols(titles, g.amountCol, headerRows).map((x) => x.col)] : [];
    // cột tiền (Đơn giá / Thành tiền): kiểu Comma không số lẻ; cột số khác có công thức hoặc số lẻ: kiểu Comma 2 số lẻ
    const isPrice = titles.map((t) => /đơn giá/i.test(t));
    const isMoney = titles.map((t, c) => isPrice[c] || /thành tiền/i.test(t) || sumCols.includes(c));
    const isDecimal = titles.map((_, c) => {
      if (isMoney[c]) return false;
      for (let r = 0; r < g.rowCount; r++) {
        if (headingRows.has(r)) continue;
        const val = (raw.get(`${r}:${c}`)?.value ?? "").trim();
        if (val.startsWith("=")) return true;
        if (val !== "" && Number.isFinite(Number(val)) && !Number.isInteger(Number(val))) return true;
      }
      return false;
    });
    // định dạng kế thừa xuống các ô phía dưới cùng cột (giống trên phần mềm); "reset" = ngừng kế thừa
    const inheritStyle: CellStyle[] = titles.map(() => ({}));
    for (let r = 0; r < g.rowCount; r++) {
      const er = r + 1 + gl.offset;
      const row = ws.getRow(er);
      if (headingRows.has(r)) {
        const meta = metaByRow.get(r)!;
        // số thứ tự (tự đánh theo cấp hoặc do người dùng gõ) ở cột đầu (STT), tên đầu mục ở cột thứ 2 (giống trên phần mềm)
        const hi = sortedHeads.findIndex((m) => m.row === r);
        const roman = headLabels[hi];
        if (g.amountCol === null ? titles.length >= 2 : g.amountCol >= 2) {
          row.getCell(1).value = roman;
          row.getCell(1).alignment = CENTER;
          row.getCell(2).value = meta.title;
        } else row.getCell(g.amountCol === 0 ? 2 : 1).value = `${roman}. ${meta.title}`;
        if (amountColL) {
          // đầu mục cha gồm cả các dòng và đầu mục con nằm trong nó (SUBTOTAL tự bỏ qua subtotal của đầu mục con);
          // cột Thành tiền chính + các cột Thành tiền khác (VD Chủ đầu tư)
          const end = headingBlockEnd(sortedHeads, hi, g.rowCount);
          for (const col of sumCols) {
            const cl = L(col + 1);
            if (end - 1 > r) formula(row.getCell(col + 1), `SUBTOTAL(9,${cl}${er + 1}:${cl}${end + gl.offset})`, ACC0);
          }
        }
        styleRow(row, 1, titles.length, { fill: F_HEADING[Math.min(meta.level + 1, 3)], bold: true });
        continue;
      }
      for (let c = 0; c < titles.length; c++) {
        const cellDb = raw.get(`${r}:${c}`);
        const own: CellStyle = parseStyle(cellDb?.style);
        if (cellDb?.style) inheritStyle[c] = own.reset ? {} : own;
        const style: CellStyle = inheritStyle[c];
        const cell = row.getCell(c + 1);
        const val = cellDb?.value ?? "";
        if (val.trim().startsWith("=")) {
          const f = remapFormula(val.trim(), (rr) => rr + gl.offset, (cc) => cc);
          cell.value = { formula: toExcelGridFormula(f.slice(1)).replace(/\bLINK\(\s*"([^"]*)"\s*\)/gi, (_m, key: string) => `(${linkExpr(key)})`) } as ExcelJS.CellFormulaValue;
        } else if (val !== "") {
          const v = ev.valueOf(r, c);
          cell.value = isNumberValue(v) ? v : val;
        }
        // nội dung dài tự xuống dòng; mặc định canh giữa (applyGridStyle đổi lại nếu ô có căn lề riêng)
        cell.alignment = { wrapText: true, horizontal: isMoney[c] || isDecimal[c] ? "right" : "center" };
        applyGridStyle(cell, style, isMoney[c] ? ACC0 : isDecimal[c] ? ACC2 : undefined, val.trim() !== "" && !val.trim().startsWith("=") && Number.isInteger(Number(val.trim())));
        cell.border = style.bd === "all" ? BOX_DARK : style.bd === "none" ? {} : BOX;
      }
    }
    // ô gộp (dòng bảng tự do r → dòng Excel r + 1 + offset)
    for (const m of parseMerges(g.merges)) ws.mergeCells(m.r1 + 1 + gl.offset, m.c1 + 1, m.r2 + 1 + gl.offset, m.c2 + 1);
    if (gl.totalRow !== null && amountColL) {
      const tr = ws.getRow(gl.totalRow);
      tr.getCell(1).value = `TỔNG CỘNG cột "${titles[g.amountCol as number] || `Cột ${(g.amountCol as number) + 1}`}"`;
      if (g.rowCount > 0)
        for (const col of sumCols) formula(tr.getCell(col + 1), `SUBTOTAL(9,${L(col + 1)}${1 + gl.offset + 1}:${L(col + 1)}${g.rowCount + gl.offset + 1})`, ACC0);
      styleRow(tr, 1, titles.length, { fill: F_HEAD, bold: true });
      // ô chữ tổng cộng gộp tới trước cột đơn giá / thành tiền đầu tiên
      const firstMoney = isMoney.indexOf(true);
      if (firstMoney >= 2) ws.mergeCells(gl.totalRow, 1, gl.totalRow, firstMoney);
      tr.getCell(1).alignment = CENTER;
    }
    // chữ xanh ở cột đơn giá (cả tiêu đề), ô đã chọn màu riêng giữ nguyên
    const lastRow = gl.totalRow ?? g.rowCount + 1 + gl.offset;
    isPrice.forEach((price, c) => {
      if (!price) return;
      for (let r = 1; r <= lastRow; r++) {
        const cell = ws.getCell(r, c + 1);
        if (!cell.font?.color) cell.font = { ...(cell.font ?? {}), color: { argb: PRICE_BLUE } };
      }
    });
    // độ rộng theo nội dung: cột mô tả dài nhất tối đa 50.7 (tự xuống dòng), các cột khác tối đa 20
    const textLen = (c: number, r: number) => {
      const v = ev.valueOf(r, c);
      if (isNumberValue(v)) {
        const n = String(Math.round(Math.abs(Number(v)))).length;
        return n + Math.floor((n - 1) / 3) + (isDecimal[c] ? 3 : 0);
      }
      return String(v ?? "").length;
    };
    const maxLen = titles.map((_, c) => {
      let m = Math.max(...[titles[c], ...headerRows.map((h) => h[c] ?? "")].flatMap((t) => String(t).split(/\s+/)).map((w) => w.length));
      for (let r = 0; r < g.rowCount; r++) if (!headingRows.has(r)) m = Math.max(m, textLen(c, r));
      return m;
    });
    const descCol = maxLen.indexOf(Math.max(...maxLen));
    titles.forEach((t, c) => {
      ws.getColumn(c + 1).width = isPrice[c] ? 15 : isMoney[c] ? 20 : Math.min(c === descCol ? 50.7 : 20, Math.max(5, maxLen[c] + 2));
    });
  }

  // ============ 8. DT-CP ============
  buildDtcpSheet();

  function linkExpr(key: string): string {
    const catSum = (k: "VT" | "NC" | "TB") => `SUMPRODUCT(${ctIs[k]}*${CT(CT_AMT[k])})`;
    const vl = catSum("VT");
    const nc = catSum("NC");
    const m = catSum("TB");
    if (key === "boq_quoted") return boqQuotedTotal() || "0";
    if (key === "boq_quoted_vat") return `(${boqQuotedTotal() || "0"})*(1+${INFO.vat})`;
    // Giá trị gói thầu: tổng Báo giá CĐT các dòng công tác (không gồm đầu mục liên kết giá) — cộng thẳng từ các ô công tác ở sheet BOQ
    const boqRows = (ids: Set<string> | null) =>
      allBoqSheets
        .map((sh) => {
          const lay = boqL.get(sh.id) as BoqLayout;
          const rows = lay.items.filter((x) => !x.isHeading && (!ids || ids.has(x.id))).map((x) => lay.rowOf.get(x.id) as number);
          return rows.length ? compressRows("J", rows).split(",").map((part) => `${q(sh.name)}!${part}`).join(",") : "";
        })
        .filter(Boolean);
    if (key === "boq_work") {
      const parts = boqRows(null);
      return parts.length ? `SUM(${parts.join(",")})` : "0";
    }
    const bh = /^boqh:(.+)$/.exec(key);
    if (bh) {
      const item = project.boqItems.find((x) => x.id === bh[1]);
      const lay = boqL.get(item?.sheetId ?? null);
      const ids = lay?.tree.scope.get(bh[1]);
      const parts = ids?.length ? boqRows(new Set(ids)) : [];
      return parts.length ? `SUM(${parts.join(",")})` : "0";
    }
    if (key === "vl") return vl;
    if (key === "nc") return nc;
    if (key === "m") return m;
    if (key === "subcontractor") return TP.total;
    if (key === "nck") return `${nc}*${INFO.ncK}`;
    if (key === "tbk") return `${nc}*${INFO.tb}`;
    if (key === "mmtb") return `((${vl}+${nc}+${m})+${nc}*(${INFO.ncK}+${INFO.tb}))*${INFO.mmtb}`;
    if (key === "other") return INFO.otherTotal;
    if (key === "tp_boq") return TP.boqTotal;
    if (key === "tps:B") return TP.manualTotal;
    const kindOf: Record<string, SheetKind> = { vts: "VT", nts: "NC", tbs: "TB" };
    const sm = /^(vts|nts|tbs):([AB])$/.exec(key);
    if (sm) return thSecRef(kindOf[sm[1]], sm[2] as "A" | "B");
    const gm = /^(vt|nt|tb)g:(.+)$/.exec(key);
    if (gm) {
      const kind = ({ vt: "VT", nt: "NC", tb: "TB" } as const)[gm[1] as "vt" | "nt" | "tb"];
      return th[kind].groups.some((g) => g.id === gm[2]) ? thGroupRef(kind, gm[2]) : "0";
    }
    const um = /^(vt|nt|tb)u:([AB])$/.exec(key);
    if (um) {
      const kind = ({ vt: "VT", nt: "NC", tb: "TB" } as const)[um[1] as "vt" | "nt" | "tb"];
      const sec = um[2] as "A" | "B";
      const shown = th[kind].groups.filter((g) => g.section === sec && g.showInDtcp).map((g) => thGroupRef(kind, g.id));
      return `${thSecRef(kind, sec)}${shown.map((s) => `-${s}`).join("")}`;
    }
    const ti = /^tpi:(.+)$/.exec(key);
    if (ti) return tpRowOfSub.has(ti[1]) ? abs(SH.tp, "J", tpRowOfSub.get(ti[1]) as number) : "0";
    const tg = /^tpg:(.+)$/.exec(key);
    if (tg) return tpGroupRow.has(tg[1]) ? abs(SH.tp, "J", tpGroupRow.get(tg[1]) as number) : "0";
    if (key === "tpu:B") {
      const shown = subSheet.groups.filter((g) => g.showInDtcp).map((g) => abs(SH.tp, "J", tpGroupRow.get(g.id) as number));
      return `${TP.manualTotal}${shown.map((s) => `-${s}`).join("")}`;
    }
    const tc = /^tpc:(.+)$/.exec(key);
    if (tc) {
      // cột K = tên nhà thầu, cột J = thành tiền sau VAT
      const rngG = tpBoqItemRows.length ? absRange(SH.tp, "K", tpBoqFirst, tpBoqLast) : null;
      const rngF = tpBoqItemRows.length ? absRange(SH.tp, "J", tpBoqFirst, tpBoqLast) : null;
      if (!rngG || !rngF) return "0";
      if (tc[1] === "_unassigned") {
        const named = subSheet.contractorGroups.filter((c) => c.showInDtcp).map((c) => `SUMIF(${rngG},"${c.name.replace(/"/g, '""')}",${rngF})`);
        return `${TP.boqTotal}${named.map((s) => `-${s}`).join("")}`;
      }
      return `SUMIF(${rngG},"${tc[1].replace(/"/g, '""')}",${rngF})`;
    }
    // Tổng KL của 1 vật tư (ô Tổng KL ở TH Vật Tư)
    const vq = /^vtq:(.+)$/.exec(key);
    if (vq) {
      const r = th.VT.rows.find((x) => !x.manual && x.resourceId === vq[1]);
      return r ? abs(SH.vt, TH_COL.VT.qty, thL.VT.rowOf.get(r) as number) : "0";
    }
    const gr = gridRef(key);
    if (gr) return gr;
    return "0";
  }

  // công thức người dùng gõ (bắt đầu bằng =) → công thức Excel: LINK("khoá") đổi thành tham chiếu sheet thật
  function userFormulaToExcel(f: string): string {
    return toExcelGridFormula(f.trim().slice(1)).replace(/\bLINK\(\s*"([^"]*)"\s*\)/gi, (_m, key: string) => `(${linkExpr(key)})`);
  }

  function buildDtcpSheet() {
    const ws = wsDtcp;
    const extra = dtcpData.columns;
    const lastCol = 5 + extra.length + 1;
    setWidths(ws, [8, 56, 10, 22, 12, ...extra.map(() => 20), dtcpData.rows.some((x) => x.note?.trim()) ? 30 : 8.1]);
    const logoPath = path.join(process.cwd(), "public", "tmn-logo.png");
    if (fs.existsSync(logoPath)) {
      const imgId = wb.addImage({ filename: logoPath, extension: "png" });
      ws.addImage(imgId, { tl: { col: 0.1, row: 0.1 }, ext: { width: 100, height: 62 } });
    }
    for (const [r, text, font] of [
      [1, "CÔNG TY CỔ PHẦN XÂY DỰNG KIẾN TRÚC TÂN MINH NHÂN", { bold: true, size: 12 }],
      [2, "250 Lê Văn Hiến, phường Khuê Mỹ, quận Ngũ Hành Sơn, TP. Đà Nẵng", {}],
      [3, "Điện thoại: (0236) 3958718  ·  Website: www.tanminhnhan.com.vn", { italic: true, size: 9, color: { argb: "FF64748B" } }],
    ] as const) {
      ws.mergeCells(r, 1, r, lastCol);
      ws.getCell(r, 1).value = text;
      ws.getCell(r, 1).font = font;
      ws.getCell(r, 1).alignment = CENTER;
    }
    for (const [r, text, size] of [[5, "BẢNG TỔNG HỢP DỰ TRÙ", 14], [6, "DOANH THU - CHI PHÍ", 18]] as const) {
      ws.mergeCells(r, 1, r, lastCol);
      ws.getCell(r, 1).value = text;
      ws.getCell(r, 1).font = { bold: true, size };
      ws.getCell(r, 1).alignment = CENTER;
      ws.getRow(r).height = size === 14 ? 18.75 : 22.5; // dòng gộp ô: Excel không tự giãn
    }
    ws.getCell("A8").value = `Dự án: ${project.name}`;
    ws.getCell("A9").value = `Gói thầu: ${project.packageName}    |   Tổng Thầu: ${project.investor}`;
    ws.getCell("A10").value = `Địa điểm: ${project.location}    |   Ngày lập: ${project.preparedDate.toLocaleDateString("vi-VN")}`;
    ws.getCell("A11").value = `Tiến độ: ${project.progress}`;
    const headRow = DTCP_HEAD_ROW;
    header(ws, headRow, ["STT", "Nội dung công việc", "Đơn vị", "Thành tiền", "% so với DT", ...extra.map((c) => c.title), "Ghi chú"]);
    const colOf = (i: number) => L(6 + i); // cột phụ thứ i
    // số dòng dùng chung với giao diện, để công thức gõ trên phần mềm (VD =D20*5%) chép sang Excel vẫn đúng ô
    const { secRow, vatRow, beforeVatRow, rowOf: rowOfLine } = dtcpLayout(dtcpData.rows);
    const rowsBy = (sec: "A" | "B") => dtcpData.rows.filter((x) => x.section === sec);
    const revenue = `$D$${secRow.A}`;
    // Doanh thu chỉ gồm 1 dòng lấy từ BOQ: trước VAT link BOQ, VAT = trước VAT x %, sau VAT = trước VAT + VAT
    const revenueLeaves = rowsBy("A").filter((x) => !dtcpData.rows.some((k) => k.parentId === x.id));
    const contractLine = revenueLeaves.length === 1 && revenueLeaves[0].linkSource === "boq_quoted_vat" && !revenueLeaves[0].formula.trim().startsWith("=") ? revenueLeaves[0] : null;
    // dòng tổng dùng SUBTOTAL cả khối dòng con (SUBTOTAL tự bỏ qua subtotal của nhóm con); khối không liền nhau thì cộng các dòng con trực tiếp
    const blockRows = (id: string): number[] => dtcpData.rows.filter((k) => k.parentId === id).flatMap((k) => [rowOfLine.get(k.id) as number, ...blockRows(k.id)]);
    const subtotalOf = (col: string, block: number[], direct: number[]) => {
      if (!block.length) return "0";
      const [lo, hi] = [Math.min(...block), Math.max(...block)];
      return hi - lo + 1 === block.length ? `SUBTOTAL(9,${col}${lo}:${col}${hi})` : `SUM(${compressRows(col, direct)})`;
    };
    const writeSection = (sec: "A" | "B", title: string) => {
      const sr = secRow[sec];
      const top = rowsBy(sec).filter((x) => x.depth === 0).map((x) => rowOfLine.get(x.id) as number);
      const row = ws.getRow(sr);
      row.getCell(1).value = sec;
      row.getCell(2).value = title;
      const secBlock = rowsBy(sec).map((x) => rowOfLine.get(x.id) as number);
      const sumOf = (col: string) => subtotalOf(col, secBlock, top);
      formula(row.getCell(4), sumOf("D"), ACC1);
      if (sec === "B") formula(row.getCell(5), `IF(${revenue}=0,"",D${sr}/${revenue})`, "0.0%");
      extra.forEach((_, i) => formula(row.getCell(6 + i), sumOf(colOf(i)), ACC1));
      styleRow(row, 1, lastCol, { fill: F_SEC, bold: true });
      row.font = { bold: true, color: { argb: "FFC00000" } };
      row.getCell(1).alignment = CENTER;
      row.getCell(3).alignment = CENTER;
      for (const x of rowsBy(sec)) {
        const rr = rowOfLine.get(x.id) as number;
        const kids = dtcpData.rows.filter((k) => k.parentId === x.id).map((k) => rowOfLine.get(k.id) as number);
        const rw = ws.getRow(rr);
        rw.getCell(1).value = x.code;
        rw.getCell(2).value = x.name;
        rw.getCell(2).alignment = { indent: x.depth * 2, wrapText: true };
        rw.getCell(1).alignment = CENTER;
        rw.getCell(3).value = x.unit;
        rw.getCell(3).alignment = CENTER;
        if (kids.length) {
          formula(rw.getCell(4), subtotalOf("D", blockRows(x.id), kids), ACC1);
          extra.forEach((_, i) => formula(rw.getCell(6 + i), subtotalOf(colOf(i), blockRows(x.id), kids), ACC1));
        } else {
          if (x.id === contractLine?.id) formula(rw.getCell(4), `D${beforeVatRow}+D${vatRow}`, ACC1);
          else if (x.formula.trim().startsWith("=")) formula(rw.getCell(4), userFormulaToExcel(x.formula), ACC1);
          else if (x.linkSource) formula(rw.getCell(4), linkExpr(x.linkSource), ACC1);
          else input(rw.getCell(4), x.manualAmount, ACC1);
          extra.forEach((c, i) => {
            const cf = x.cellFormulas[c.id];
            if (cf) formula(rw.getCell(6 + i), userFormulaToExcel(cf), ACC1);
            else input(rw.getCell(6 + i), x.cells[c.id] ?? 0, ACC1);
          });
        }
        if (sec === "B") formula(rw.getCell(5), `IF(${revenue}=0,"",D${rr}/${revenue})`, "0.0%");
        rw.getCell(lastCol).value = x.note;
        styleRow(rw, 1, lastCol, { bold: x.depth <= 1 });
        if (x.depth > 1) rw.font = { italic: true };
      }
    };
    writeSection("A", "DOANH THU");
    {
      const v1 = ws.getRow(vatRow);
      v1.getCell(2).value = "VAT";
      input(v1.getCell(3), project.vatRate, "0.0#%");
      v1.getCell(3).alignment = CENTER;
      formula(v1.getCell(4), contractLine ? `D${beforeVatRow}*C${vatRow}` : `${revenue}-${revenue}/(1+C${vatRow})`, ACC1);
      styleRow(v1, 1, lastCol, { bold: true });
      const v2 = ws.getRow(beforeVatRow);
      v2.getCell(2).value = "Giá trị trước VAT";
      formula(v2.getCell(4), contractLine ? boqQuotedTotal() || "0" : `${revenue}/(1+C${vatRow})`, ACC1);
      styleRow(v2, 1, lastCol, { bold: true });
      v2.font = { bold: true, color: { argb: "FF1D4ED8" } };
    }
    writeSection("B", "CHI PHÍ");
  }

  applyStandardFont(wb);
  return wb;
}

// Toàn bộ ô dùng Times New Roman (cả chữ nhiều định dạng trong 1 ô) và canh giữa theo chiều dọc
function applyStandardFont(wb: ExcelJS.Workbook) {
  wb.eachSheet((ws) => {
    const nCols = ws.columnCount;
    ws.eachRow((row) => {
      for (let c = 1; c <= nCols; c++) {
        const cell = row.getCell(c);
        cell.font = { ...(cell.font ?? {}), name: FONT_NAME, family: 1, size: cell.font?.size ?? 11 };
        cell.alignment = { ...(cell.alignment ?? {}), vertical: "middle" };
        const v = cell.value;
        if (v && typeof v === "object" && "richText" in v) cell.value = { richText: v.richText.map((t) => ({ ...t, font: { ...(t.font ?? {}), name: FONT_NAME, family: 1, size: t.font?.size ?? 11 } })) };
      }
    });
  });
}

// ---- chuyển công thức ----
// Định mức hao phí kiểu "1/3", "ROUND(10/3;2)" (số lẻ dùng , hoặc .; đối số cách nhau ;) → công thức Excel
function toExcelNormFormula(src: string): string | null {
  try {
    let out = "";
    for (const ch of src) out += ch === ";" ? "\u0001" : ch === "," ? "." : ch === "×" ? "*" : ch === "÷" ? "/" : ch;
    out = out.replace(/\u0001/g, ",").replace(/\bPI\b/gi, "PI()");
    return /^[0-9+\-*/^().,\sA-Za-z]+$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

// Công thức bảng tự do: đối số cách nhau ; hoặc , (Excel dùng ,) — chỉ đổi ; ngoài chuỗi ký tự
function toExcelGridFormula(src: string): string {
  let out = "";
  let inStr = false;
  for (const ch of src) {
    if (ch === '"') inStr = !inStr;
    out += !inStr && ch === ";" ? "," : ch;
  }
  return out;
}

function applyGridStyle(cell: ExcelJS.Cell, st: CellStyle, defaultFmt: string | undefined, isInt: boolean) {
  const font: Partial<ExcelJS.Font> = { ...(cell.font ?? {}) };
  if (st.b) font.bold = true;
  if (st.i) font.italic = true;
  if (st.u) font.underline = true;
  if (st.fs) font.size = st.fs;
  if (st.color) font.color = { argb: `FF${st.color.slice(1).toUpperCase()}` };
  if (Object.keys(font).length) cell.font = font;
  if (st.bg) cell.fill = FILL(`FF${st.bg.slice(1).toUpperCase()}`);
  if (st.align) cell.alignment = { ...(cell.alignment ?? {}), horizontal: st.align };
  if (st.pct || st.sep !== undefined || st.dec !== undefined) {
    // chưa chọn số lẻ: số nguyên hiện không có phần lẻ, còn lại 2 số lẻ (Excel không có định dạng "tự động" có dấu nghìn)
    const n = st.dec !== undefined ? st.dec : st.pct || isInt ? 0 : 2;
    const dec = n > 0 ? `.${"0".repeat(n)}` : "";
    cell.numFmt = st.pct ? `${st.sep === true ? "#,##0" : "0"}${dec}%` : st.sep === false ? `0${dec}` : defaultFmt ?? ACC(n);
  } else if (defaultFmt) cell.numFmt = defaultFmt;
}
