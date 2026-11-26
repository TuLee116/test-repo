import fs from "fs";
import nodePath from "path";
import ExcelJS from "exceljs";
import { fixXlsx } from "@/lib/excel-fix";
import { applyStandardStyle } from "@/lib/excel-style";
import { amt, apprPriceOf, AWARD_FORMS, BRANCH_LABEL, PL_KINDS, PRICE_MODES, baseOfLine, evalVat, extraAmt, fixedTerms, parseExtras, parseJson, parseVatRows, propPriceOf, propQtyOf, termAppr, termProp, noMgmtFlags, totalsOf, parseSavedTotals, totFxKey, withSaved, type Bidder, type Term } from "@/lib/thau-phu-calc";
import { forEval } from "@/lib/xl-formula";
import { toNums, type NtContext, type SubRef } from "@/lib/thau-phu";
import { isPartLevel } from "@/lib/thau-phu-calc";
import { exportImageOf } from "@/lib/uploads";
import { SUB_STATUS } from "@/lib/thau-phu-calc";

// XUẤT EXCEL hồ sơ trình giá thầu phụ: file MỚI, nội dung giống màn hình phần mềm (không phụ thuộc file gốc QSĐT tải lên).
//  - Sheet 1 "Bảng đề xuất": thông tin hồ sơ + A. BẢNG ĐƠN GIÁ (CĐT / cơ sở / từng thầu phụ / đề xuất duyệt) + B. ĐIỀU KHOẢN HỢP ĐỒNG + ý kiến
//  - Sheet 2 "Phạm vi công việc": mục C

type XLine = {
  id?: string; level: string; noMgmt?: boolean; stt: string; workName: string; content: string; code?: string; origin?: string; unit: string; lineKey: string;
  material?: string; dimL?: string; dimW?: string; dimH?: string; // NỘI THẤT
  cdtQty: number | null; cdtPrice: number | null; baseQty: number | null; basePrice: number | null; baseManual: boolean;
  bids: string; propQty: number | null; propPrice: number | null; tpPrice: number | null; tpOk: boolean;
  // PLHĐ điều chỉnh: KL / đơn giá theo HỢP ĐỒNG gốc của khối đề xuất (hd), CĐT (cdtHd), cơ sở (baseHd)
  hdQty?: number | null; hdPrice?: number | null; cdtHdQty?: number | null; cdtHdPrice?: number | null; baseHdQty?: number | null; baseHdPrice?: number | null;
  note: string; qsNote: string; tpNote: string;
};
export type ExportInput = {
  code: string; status: string; area: string; projectName: string; projectCode: string; cdtContract: string; itemName: string;
  isMep?: boolean; mepTemp?: boolean; isNt?: boolean; subName: string; selectedBidder: string; revision: number; branch: string; branchReason: string; proposalType: string; plKind: string; awardForm: string;
  vtValue: number | null; tbValue: number | null; otherValue?: number | null; priceMode: string; colMap?: string; bidders: string; prelim: string; vat: string; extraRows: string; vatRows: string; terms: string; scope: string;
  totalFormulas?: string; totalAmounts?: string; // công thức gõ ở các dòng từ TỔNG CỘNG trở xuống + số tổng đã tính theo công thức (xem chainTotals)
  qsNote: string; tpNote: string; ptgNote: string; tpByName: string; ptgByName: string; createdByName: string; hdNo: string;
  lines: XLine[];
};

const MONEY = "#,##0";
const QTY = "#,##0.##";
const thin = { style: "thin" as const, color: { argb: "FF7F7F7F" } };
const BORDER: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
const FILL_HEAD = "FFD9E1F2";
const FILL_SUM = "FFEDEDED";
const FILL_GRP = "FFF2F2F2";

const LETTERHEAD: [string, number][] = [
  ["CÔNG TY CỔ PHẦN XÂY DỰNG KIẾN TRÚC TÂN MINH NHÂN", 14],
  ["Trụ sở chính: Tổ 3, Khối Ngân Giang, Phường Điện Bàn Đông, TP. Đà Nẵng", 10],
  ["VPĐD: 246-248-250 Lê Văn Hiến, P. Ngũ Hành Sơn, TP Đà Nẵng", 10],
  ["MST: 4000833337 - ĐT: (0236) 3958718 - Fax: (0236) 3868718", 10],
  ["Website: www.tanminhnhan.com.vn", 10],
];
// Đầu trang giống màn hình: logo + tên công ty + địa chỉ + đường kẻ + tiêu đề. Trả về dòng trống kế tiếp.
function addLetterhead(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, mergeTo: number, titleText: string): number {
  const logo = nodePath.join(process.cwd(), "public", "tmn-logo.png");
  if (fs.existsSync(logo)) {
    const id = wb.addImage({ filename: logo, extension: "png" });
    ws.addImage(id, { tl: { col: 0.1, row: 0.15 }, ext: { width: 92, height: 66 } });
  }
  LETTERHEAD.forEach(([t, size], i) => {
    const r = i + 1;
    ws.mergeCells(r, 1, r, mergeTo);
    const c = ws.getCell(r, 1);
    c.value = t;
    c.font = { bold: true, size };
    c.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(r).height = size >= 13 ? 20 : 15;
  });
  for (let c = 1; c <= mergeTo; c++) ws.getCell(6, c).border = { bottom: { style: "medium", color: { argb: "FF000000" } } };
  ws.getRow(6).height = 6;
  ws.mergeCells(8, 1, 8, mergeTo);
  const t = ws.getCell(8, 1);
  t.value = titleText;
  t.font = { bold: true, size: 16 };
  t.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(8).height = 26;
  return 10;
}
// Khối thông tin hồ sơ: nhãn | : | giá trị (gạch chân chấm như màn hình)
function addInfoRows(ws: ExcelJS.Worksheet, start: number, mergeTo: number, items: [string, string][]): number {
  let r = start;
  for (const [k, v] of items) {
    const l = ws.getCell(r, 2);
    l.value = k;
    l.font = { bold: true };
    l.alignment = { horizontal: "left", vertical: "middle" };
    ws.mergeCells(r, 3, r, Math.max(mergeTo, 3));
    const vc = ws.getCell(r, 3);
    vc.value = v || null;
    vc.font = { bold: true };
    vc.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    r++;
  }
  return r;
}
function infoItems(p: ExportInput, vt: number, tb: number, other = 0): [string, string][] {
  const award = AWARD_FORMS.find((f) => f.value === p.awardForm)?.label ?? "";
  const awardTxt = [award, vt > 0 ? `Vật tư: ${Math.round(vt).toLocaleString("vi-VN")} đ` : "", tb > 0 ? `Thiết bị: ${Math.round(tb).toLocaleString("vi-VN")} đ` : "", other > 0 ? `Chi phí khác: ${Math.round(other).toLocaleString("vi-VN")} đ` : ""].filter(Boolean).join(" · ");
  const type = p.proposalType === "PL" ? `PL — ký phụ lục${p.plKind ? ` (${PL_KINDS.find((x) => x.value === p.plKind)?.label.split(" — ")[0] ?? ""})` : ""}${p.hdNo ? ` · số HĐ gốc ${p.hdNo}` : ""}` : p.proposalType === "HDTP" ? "HĐTP — ký hợp đồng thầu phụ" : "";
  return [
    ["KHU VỰC", p.area ? `Khu vực ${p.area}` : ""],
    ["DỰ ÁN / CÔNG TRÌNH", p.projectName],
    ["MÃ SỐ DỰ ÁN", p.projectCode],
    ["HỢP ĐỒNG", p.cdtContract],
    ["HẠNG MỤC", p.itemName],
    ["THẦU PHỤ ĐỀ XUẤT KÝ HĐ", p.subName ? `${p.subName}${p.selectedBidder ? ` (${p.selectedBidder})` : ""}` : ""],
    ["LẦN TRÌNH / NHÁNH", `Lần ${p.revision}${p.branch ? ` · ${BRANCH_LABEL[p.branch] ?? `Nhánh ${p.branch}`}` : ""}`],
    ["LOẠI ĐỀ XUẤT", type],
    ["ĐƠN GIÁ", PRICE_MODES.find((m) => m.value === (p.priceMode || "TONG"))?.label ?? ""],
    ["LOẠI THẦU PHỤ", p.isNt ? "NỘI THẤT" : p.isMep ? (p.mepTemp ? "MEP TẠM (có thuê vật tư — khấu hao)" : "MEP (cơ điện)") : "XÂY DỰNG"],
    ["HÌNH THỨC GIAO THẦU", awardTxt],
    ["MÃ HỒ SƠ / TRẠNG THÁI", `${p.code} · ${SUB_STATUS[p.status]?.label ?? p.status}`],
  ];
}

// nt (hồ sơ NỘI THẤT): ảnh từng dòng (tên file ảnh) + giá phần việc đã duyệt ở hồ sơ khác (ghi chú dòng sản phẩm / phần việc khác)
export async function buildSubExport(p: ExportInput, refs: Map<string, SubRef>, nt?: { images: Map<string, string[]>; ctx: NtContext }): Promise<Buffer> {
  const sel = p.selectedBidder;
  const bidders = parseJson<Bidder[]>(p.bidders, []);
  const prelim = parseJson<Record<string, number>>(p.prelim, {});
  const vat = parseJson<Record<string, number>>(p.vat, {});
  const extras = parseExtras(p.extraRows);
  const vatRows = parseVatRows(p.vatRows);
  // đã qua bước duyệt thì xuất giá DUYỆT; đang lập / bổ sung thì xuất giá ĐỀ XUẤT
  const useAppr = !["DRAFT", "QS_CHECK", "NEED_INFO"].includes(p.status);
  const vt = Number(p.vtValue) || 0;
  const tb = Number(p.tbValue) || 0;
  const other = Number(p.otherValue) || 0;

  // cột dữ liệu: A = CĐT, B = cơ sở, C1.. = thầu phụ, R = đề xuất duyệt
  type Col = { key: string; title: string };
  const cols: Col[] = [{ key: "A", title: "CHỦ ĐẦU TƯ (A)" }, { key: "B", title: "ĐƠN GIÁ CƠ SỞ (B) (theo DT-CP hợp đồng)" }, ...bidders.map((b) => ({ key: b.key, title: `THẦU PHỤ ${b.name} (${b.key})${b.key === sel ? " ✓" : ""}` })), { key: "R", title: useAppr ? "ĐỀ XUẤT DUYỆT (D)" : "ĐỀ XUẤT (D)" }];
  // PLHĐ điều chỉnh: khối CĐT (A), cơ sở (B), đề xuất (R) mỗi khối 7 cột như màn hình —
  // KL (hợp đồng | điều chỉnh), đơn giá (hợp đồng | điều chỉnh), thành tiền (hợp đồng | điều chỉnh | phụ lục = điều chỉnh − hợp đồng)
  const adj = p.proposalType === "PL" && p.plKind === "DIEU_CHINH";
  const HDK: Record<string, string> = { A: "AH", B: "BH", R: "H" }; // cột theo hợp đồng gốc của khối
  const wide = (key: string) => adj && !!HDK[key];
  const allKeys = [...cols.map((c) => c.key), ...(adj ? ["AH", "BH", "H"] : [])];
  const qp = (l: XLine, c: string): [number | null, number | null] => {
    const n = toNums(l);
    if (c === "AH") return [l.cdtHdQty ?? null, l.cdtHdPrice ?? null];
    if (c === "BH") return [l.baseHdQty ?? null, l.baseHdPrice ?? null];
    if (c === "H") return [l.hdQty ?? null, l.hdPrice ?? null];
    if (c === "A") return [l.cdtQty, l.cdtPrice];
    if (c === "B") return [l.baseQty, baseOfLine(l, refs.get(l.lineKey)?.base1)];
    if (c === "R") return [propQtyOf(n, sel), useAppr ? apprPriceOf(n, sel) : propPriceOf(n, sel)];
    const b = n.bids[c];
    return [b?.qty ?? null, b?.price ?? null];
  };

  // tổng từng dòng nhóm (đầu mục) + tổng cột
  const sums: Record<string, number> = Object.fromEntries(allKeys.map((k) => [k, 0]));
  const exempt: Record<string, number> = Object.fromEntries(allKeys.map((k) => [k, 0])); // phần KHÔNG tính chi phí quản lý (Prelim)
  const skip = noMgmtFlags(p.lines);
  const group: (Record<string, number> | null)[] = p.lines.map(() => null);
  // dòng cuối thuộc đầu mục i (cùng quy tắc tính tổng đầu mục như màn hình); dòng SP (sản phẩm nội thất) chỉ gồm các dòng phần việc liền dưới
  const endOf = (i: number) => {
    const l = p.lines[i];
    let end = i;
    for (let j = i + 1; j < p.lines.length; j++) {
      const lj = p.lines[j];
      if (lj.level === "SUB" || (l.level === "GROUP" && lj.level === "GROUP") || (l.level === "SP" && !isPartLevel(lj.level))) break; // cấp 1 gồm cả các cấp 2 bên dưới
      end = j;
    }
    return end;
  };
  p.lines.forEach((l, i) => {
    if (l.level === "ITEM") {
      for (const k of allKeys) {
        const a = amt(...qp(l, k)) ?? 0;
        sums[k] += a;
        if (skip[i]) exempt[k] += a;
      }
      return;
    }
    if (l.level === "REF") return; // phần việc khác (nội thất): không cộng tổng
    const g: Record<string, number> = Object.fromEntries(allKeys.map((k) => [k, 0]));
    for (let j = i + 1; j <= endOf(i); j++) if (p.lines[j].level === "ITEM") for (const k of allKeys) g[k] += amt(...qp(p.lines[j], k)) ?? 0;
    group[i] = g;
  });
  // NỘI THẤT: giá phần việc khác (REF) = giá duyệt ở hồ sơ khác, không thì giá dự kiến (khối đề xuất)
  const ntm = !!p.isNt;
  const ctx = nt?.ctx ?? { refAppr: {}, extra: {} };
  const refQP = (l: XLine): [number | null, number | null] => {
    const a = l.id ? ctx.refAppr[l.id] : undefined;
    const n = toNums(l);
    return a ? [a.qty ?? propQtyOf(n, sel), a.price] : [propQtyOf(n, sel), propPriceOf(n, sel)];
  };
  const vnd = (n: number | null | undefined) => (n == null ? "" : Math.round(n).toLocaleString("vi-VN"));
  const qtyTxt = (n: number | null | undefined) => (n == null ? "" : n.toLocaleString("vi-VN", { maximumFractionDigits: 3 }));
  // ghi chú tự ghi của dòng nội thất: phần việc khác → nguồn giá; sản phẩm → Σ cả sản phẩm (mọi phần việc) so với giá CĐT
  const ntNote = (l: XLine, i: number): string => {
    if (l.level === "REF") {
      const a = l.id ? ctx.refAppr[l.id] : undefined;
      const [q, pr] = refQP(l);
      return `Phần việc khác — không trình lần này. ${a ? `Đã duyệt ở hồ sơ ${a.code}${a.sub ? ` (${a.sub})` : ""}` : "Giá dự kiến"}: ${qtyTxt(q)} × ${vnd(pr)} = ${vnd(amt(q, pr))} đ`;
    }
    if (l.level !== "SP") return "";
    const extra = (l.id ? ctx.extra[l.id] : undefined) ?? [];
    let all = 0;
    for (let j = i + 1; j <= endOf(i); j++) {
      const c = p.lines[j];
      const cn = toNums(c);
      all += (c.level === "REF" ? amt(...refQP(c)) : amt(propQtyOf(cn, sel), useAppr ? apprPriceOf(cn, sel) : propPriceOf(cn, sel))) ?? 0;
    }
    all += extra.reduce((t, a) => t + (amt(a.qty, a.price) ?? 0), 0);
    const cdt = amt(l.cdtQty, l.cdtPrice);
    return [
      `Σ cả sản phẩm (gồm phần việc khác): ${vnd(all)} đ`,
      cdt != null ? `Giá CĐT: ${vnd(cdt)} đ${cdt > 0 ? ` (bằng ${Math.round((all / cdt) * 100)}%)${all > cdt + 0.5 ? " — VƯỢT GIÁ CĐT" : ""}` : ""}` : "",
      ...extra.map((a) => `${a.name}: đã duyệt ở ${a.code}${a.sub ? ` (${a.sub})` : ""} ${qtyTxt(a.qty)} × ${vnd(a.price)} = ${vnd(amt(a.qty, a.price))} đ`),
    ]
      .filter(Boolean)
      .join("\n");
  };
  // ĐỀ XUẤT DUYỆT TRÙNG GIÁ 1 THẦU PHỤ (cùng quy tắc màn hình): trên màn hình cột thầu phụ được duyệt ĐÓNG VAI khối D —
  // % Prelim / VAT, dòng chi phí thêm, thuế bổ sung, công thức dòng tổng của cột đó đều là của khối D (số riêng của thầu phụ bị ẩn, có thể sai / cũ
  // VD ô % Prelim đọc nhầm số tiền khi tải file) → file xuất cũng lấy theo khối D để cột thầu phụ và cột D khớp màn hình
  const multiAward = (parseJson<{ award?: { key: string; pct: number }[] }>(p.colMap ?? "", {}).award ?? []).filter((a) => a.pct > 0).length > 1;
  const selBid = bidders.some((b) => b.key === sel);
  const itemNums = p.lines.filter((l) => l.level === "ITEM").map(toNums);
  const sameNum = (a: number | null | undefined, b: number | null | undefined) => a == null || (b != null && Math.abs(a - b) < 0.5);
  const bidEmpty = !multiAward && selBid && itemNums.every((n) => n.bids[sel]?.qty == null && n.bids[sel]?.price == null);
  const sameD = !multiAward && selBid && !bidEmpty && itemNums.every((n) => sameNum(n.propPrice, n.bids[sel]?.price) && sameNum(n.propQty, n.bids[sel]?.qty));
  const hideD = sameD && !adj && !(ntm && p.lines.some((l) => l.level === "REF")); // màn hình bỏ khối D, cột thầu phụ được duyệt thay vào
  const mirror = sameD ? sel : null; // cột thầu phụ dùng thiết lập của khối D
  const dKey = (c: string) => (c === "R" || c === mirror ? "D" : c);
  // cột hợp đồng gốc dùng chung % Prelim / VAT / thuế bổ sung của khối mình (AH → A, BH → B, H → D)
  const baseK = (c: string) => (c === "R" || c === "H" || c === mirror ? "D" : c === "AH" ? "A" : c === "BH" ? "B" : c);
  // cột có công thức ở các dòng tổng (làm tròn...) → số đã lưu (cột R: đã duyệt = số duyệt, chưa duyệt = số đề xuất; cột thầu phụ đóng vai D = số đề xuất)
  const sv = parseSavedTotals(p.totalAmounts);
  const savedOf = (key: string) => (key === "R" ? (useAppr ? sv.R : sv.D) : key === mirror ? sv.D : sv[key]);
  const totals = Object.fromEntries(
    allKeys.map((key) => {
      const k = baseK(key);
      const extra = extras.reduce((t, x) => t + extraAmt(x, dKey(key), sums[key]), 0);
      return [key, withSaved(totalsOf(sums[key], prelim[k] ?? 0, vat[k] ?? 0, extra, vatRows, k, exempt[key]), savedOf(key))];
    }),
  );

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Bảng đề xuất", { views: [{ state: "normal" }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  // ----- bố cục cột -----
  const mep = !!p.isMep && !ntm; // thầu phụ MEP: thêm 2 cột MÃ HIỆU SẢN PHẨM + NHÃN HIỆU - XUẤT XỨ sau ĐVT
  // NỘI THẤT: STT | MÃ SẢN PHẨM | HẠNG MỤC CÔNG VIỆC | HÌNH ẢNH | MÔ TẢ VẬT LIỆU | DÀI | RỘNG | CAO | ĐVT
  const FIX = ntm ? 9 : mep ? 5 : 3; // STT | NỘI DUNG | ĐVT (| MÃ HIỆU | NHÃN HIỆU - XUẤT XỨ)
  const TXT = ntm ? 3 : 2; // cột nội dung / tên dòng tổng
  const IMG = 4; // nội thất: cột hình ảnh
  const firstBlock = FIX + 1;
  // cột bắt đầu từng khối: khối thường 3 cột (KL | ĐƠN GIÁ | THÀNH TIỀN); PLHĐ điều chỉnh khối A / B / R 7 cột
  const starts: number[] = [];
  let nextCol = firstBlock;
  for (const c of cols) {
    starts.push(nextCol);
    nextCol += wide(c.key) ? 7 : 3;
  }
  const noteCol = nextCol;
  const isW = (k: number) => wide(cols[k].key);
  // ô theo điều chỉnh (hoặc khối thường): KL / đơn giá / thành tiền
  const qtyCol = (k: number) => starts[k] + (isW(k) ? 1 : 0);
  const rateCol = (k: number) => starts[k] + (isW(k) ? 3 : 1);
  const amtCol = (k: number) => starts[k] + (isW(k) ? 5 : 2);
  // ô theo hợp đồng gốc + thành tiền phụ lục (chỉ khối 7 cột)
  const hqCol = (k: number) => starts[k];
  const hpCol = (k: number) => starts[k] + 2;
  const haCol = (k: number) => starts[k] + 4;
  const plCol = (k: number) => starts[k] + 6;
  const lastCol = noteCol + 2; // + Ghi chú | Ghi chú QSTT | Ý kiến TP
  ws.getColumn(1).width = 7;
  ws.getColumn(2).width = 52;
  ws.getColumn(3).width = 8;
  if (ntm) {
    [6, 12, 38, 15, 30, 8, 8, 8, 7].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  } else if (mep) {
    // MEP: STT | NỘI DUNG | MÃ HIỆU | NHÃN HIỆU - XUẤT XỨ | ĐVT
    ws.getColumn(3).width = 22;
    ws.getColumn(4).width = 28;
    ws.getColumn(5).width = 8;
  }
  for (let i = 0; i < cols.length; i++) {
    if (isW(i)) {
      [11, 11, 13, 13, 17, 17, 17].forEach((w, j) => (ws.getColumn(starts[i] + j).width = w));
      continue;
    }
    ws.getColumn(starts[i]).width = 11;
    ws.getColumn(starts[i] + 1).width = 13;
    ws.getColumn(starts[i] + 2).width = 17;
  }
  ws.getColumn(noteCol).width = 30;
  ws.getColumn(noteCol + 1).width = 30;
  ws.getColumn(noteCol + 2).width = 30;

  const HEAD_TO = lastCol; // đầu trang + thông tin trải hết chiều ngang bảng
  let r = addLetterhead(wb, ws, HEAD_TO, "BẢNG ĐỀ XUẤT KÝ HỢP ĐỒNG THẦU PHỤ");
  r = addInfoRows(ws, r, HEAD_TO, infoItems(p, vt, tb, other)) + 1;

  // ----- A. BẢNG ĐƠN GIÁ -----
  const aTitle = ws.getCell(r, 1);
  aTitle.value = "A. BẢNG ĐƠN GIÁ ĐỀ XUẤT";
  aTitle.font = { bold: true, size: 13 };
  r++;
  const h1 = r;
  const h2 = r + 1;
  const hEnd = adj ? r + 2 : h2; // PLHĐ điều chỉnh: 3 tầng tiêu đề (khối → Khối lượng / Đơn giá / Thành tiền → Hợp đồng / Điều chỉnh / Phụ lục)
  const hdr =(row: number, col: number, v: string, fill = FILL_HEAD) => {
    const c = ws.getCell(row, col);
    c.value = v;
    c.font = { bold: true };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = BORDER;
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  };
  // ô tiêu đề gộp dọc từ dòng a tới b
  const vHdr = (a: number, b: number, col: number, t: string, fill = FILL_HEAD) => {
    for (let rr = a; rr <= b; rr++) hdr(rr, col, rr === a ? t : "", fill);
    if (b > a) ws.mergeCells(a, col, b, col);
  };
  if (ntm) {
    for (const [i, t] of ["STT", "MÃ SẢN PHẨM", "HẠNG MỤC CÔNG VIỆC", "HÌNH ẢNH", "MÔ TẢ VẬT LIỆU", "", "", "", "ĐVT"].entries()) {
      if (i >= 5 && i <= 7) continue;
      vHdr(h1, hEnd, i + 1, t);
    }
    hdr(h1, 6, "KÍCH THƯỚC (mm)");
    hdr(h1, 7, "");
    hdr(h1, 8, "");
    ws.mergeCells(h1, 6, h1, 8);
    vHdr(h2, hEnd, 6, "DÀI");
    vHdr(h2, hEnd, 7, "RỘNG");
    vHdr(h2, hEnd, 8, "CAO");
  } else for (const [i, t] of (mep ? ["STT", "NỘI DUNG CÔNG VIỆC", "MÃ HIỆU SẢN PHẨM", "NHÃN HIỆU - XUẤT XỨ", "ĐVT"] : ["STT", "NỘI DUNG CÔNG VIỆC", "ĐVT"]).entries()) vHdr(h1, hEnd, i + 1, t);
  cols.forEach((c, i) => {
    const c0 = starts[i];
    const n = isW(i) ? 7 : 3;
    const fill1 = c.key === "R" ? "FFC6EFCE" : FILL_HEAD;
    for (let j = 0; j < n; j++) hdr(h1, c0 + j, j === 0 ? c.title : "", j === 0 && c.key === "B" ? "FFE4DFEC" : fill1);
    ws.mergeCells(h1, c0, h1, c0 + n - 1);
    if (isW(i)) {
      // Khối lượng (2) | Đơn giá (2) | Thành tiền (3) → Hợp đồng | Điều chỉnh | ... | Phụ lục
      for (const [a, w, t] of [[0, 2, "KHỐI LƯỢNG"], [2, 2, "ĐƠN GIÁ"], [4, 3, "THÀNH TIỀN"]] as [number, number, string][]) {
        for (let j = 0; j < w; j++) hdr(h2, c0 + a + j, j === 0 ? t : "");
        ws.mergeCells(h2, c0 + a, h2, c0 + a + w - 1);
      }
      ["HỢP ĐỒNG", "ĐIỀU CHỈNH", "HỢP ĐỒNG", "ĐIỀU CHỈNH", "HỢP ĐỒNG", "ĐIỀU CHỈNH", "PHỤ LỤC"].forEach((t, j) => {
        hdr(hEnd, c0 + j, t, j === 6 ? "FFFCE4D6" : FILL_HEAD);
        if (j === 6) ws.getCell(hEnd, c0 + j).font = { bold: true, color: { argb: "FF1D4ED8" } };
      });
    } else {
      vHdr(h2, hEnd, c0, "KL");
      vHdr(h2, hEnd, c0 + 1, "ĐƠN GIÁ");
      vHdr(h2, hEnd, c0 + 2, "THÀNH TIỀN");
    }
  });
  ["GHI CHÚ", "GHI CHÚ QSTT / LÝ DO VƯỢT DT-CP", "Ý KIẾN TRƯỞNG PHÒNG / PHÓ TỔNG"].forEach((t, i) => vHdr(h1, hEnd, noteCol + i, t));
  ws.getRow(h1).height = 32;
  r = hEnd + 1;
  ws.views = [{ state: "frozen", xSplit: 3, ySplit: hEnd }];

  const cell = (row: number, col: number, v: ExcelJS.CellValue, o: { fmt?: string; bold?: boolean; fill?: string; align?: "left" | "center" | "right"; wrap?: boolean } = {}) => {
    const c = ws.getCell(row, col);
    if (v !== null && v !== undefined && v !== "") c.value = v;
    c.border = BORDER;
    if (o.fmt) c.numFmt = o.fmt;
    if (o.bold) c.font = { bold: true };
    if (o.fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: o.fill } };
    c.alignment = { horizontal: o.align ?? (typeof v === "number" ? "right" : "left"), vertical: "top", wrapText: o.wrap ?? false };
    return c;
  };

  // ---- công thức Excel: thành tiền = KL × đơn giá; đầu mục = SUBTOTAL; các dòng dưới TỔNG CỘNG tính theo ô ----
  const L = (col: number) => ws.getColumn(col).letter;
  const fv = (formula: string, result: number): ExcelJS.CellFormulaValue => ({ formula, result });
  const firstRow = r;
  const lastLineRow = firstRow + p.lines.length - 1;
  const imgRows: { r: number; files: string[] }[] = []; // nội thất: ảnh chèn sau khi ghi xong bảng
  p.lines.forEach((l, i) => {
    const item = l.level === "ITEM";
    const isRef = l.level === "REF"; // phần việc khác (nội thất): chỉ ghi KL / đơn giá tham khảo ở khối đề xuất, không thành tiền (không cộng tổng)
    const isSp = l.level === "SP";
    const line = item || isRef || isSp; // dòng có thông tin sản phẩm / công việc (không phải đầu mục A, I...)
    const fill = item ? undefined : isRef ? "FFF8F8F8" : isSp ? "FFFFF2CC" : FILL_GRP;
    cell(r, 1, l.stt, { align: "center", bold: !item && !isRef, fill });
    if (ntm) {
      cell(r, 2, line ? l.code ?? "" : "", { wrap: true, fill, align: "center", bold: isSp });
      cell(r, 3, l.content, { bold: !item && !isRef, fill, wrap: true });
      cell(r, IMG, "", { fill });
      cell(r, 5, line ? l.material ?? "" : "", { wrap: true, fill });
      cell(r, 6, line ? l.dimL ?? "" : "", { align: "center", fill });
      cell(r, 7, line ? l.dimW ?? "" : "", { align: "center", fill });
      cell(r, 8, line ? l.dimH ?? "" : "", { align: "center", fill });
      cell(r, 9, line ? l.unit : "", { align: "center", fill });
      if (isRef) ws.getCell(r, 3).font = { italic: true, color: { argb: "FF64748B" } };
      const files = l.id ? nt?.images.get(l.id) : undefined;
      if (files?.length) imgRows.push({ r, files });
    } else {
      cell(r, 2, l.content, { bold: !item, fill, wrap: true });
      if (mep) {
        cell(r, 3, item ? l.code ?? "" : "", { wrap: true, fill });
        cell(r, 4, item ? l.origin ?? "" : "", { wrap: true, fill });
        cell(r, 5, item ? l.unit : "", { align: "center", fill });
      } else cell(r, 3, item ? l.unit : "", { align: "center", fill });
    }
    // dòng cuối thuộc đầu mục này (cùng quy tắc tính tổng đầu mục như màn hình)
    const end = item || isRef ? i : endOf(i);
    cols.forEach((c, k) => {
      const c0 = qtyCol(k);
      const cp = rateCol(k);
      const ca = amtCol(k);
      const sub = (col: number) => `SUBTOTAL(9,${L(col)}${firstRow + i + 1}:${L(col)}${firstRow + end})`;
      if (isRef) {
        // phần việc khác: KL / đơn giá (đã duyệt ở hồ sơ khác hoặc dự kiến) ở khối đề xuất để tham khảo, ô thành tiền bỏ trống
        const [q, pr] = c.key === "R" ? refQP(l) : [null, null];
        cell(r, c0, q, { fmt: QTY, fill });
        cell(r, cp, pr, { fmt: MONEY, fill });
        cell(r, ca, "", { fill });
      } else if (isSp && c.key === "A" && l.cdtPrice != null) {
        // giá CĐT của cả sản phẩm: =SUBTOTAL(9,KL)*ĐG để các dòng tổng (SUBTOTAL) không cộng thêm lần nữa
        const a = amt(l.cdtQty, l.cdtPrice);
        cell(r, c0, l.cdtQty, { fmt: QTY, fill });
        cell(r, cp, l.cdtPrice, { fmt: MONEY, fill });
        cell(r, ca, a != null ? fv(`SUBTOTAL(9,${L(c0)}${r})*${L(cp)}${r}`, a) : "", { fmt: MONEY, bold: true, fill });
      } else if (item) {
        const [q, pr] = qp(l, c.key);
        cell(r, c0, q, { fmt: QTY });
        cell(r, cp, pr, { fmt: MONEY });
        const a = amt(q, pr);
        cell(r, ca, a != null ? fv(`${L(c0)}${r}*${L(cp)}${r}`, a) : "", { fmt: MONEY });
      } else {
        cell(r, c0, "", { fill });
        cell(r, cp, "", { fill });
        const g = group[i]?.[c.key] ?? 0;
        cell(r, ca, end > i ? fv(sub(ca), g) : "", { fmt: MONEY, bold: true, fill });
      }
      if (!isW(k)) return;
      // PLHĐ điều chỉnh: cột HỢP ĐỒNG gốc (KL, đơn giá, thành tiền) + thành tiền PHỤ LỤC = điều chỉnh − hợp đồng
      const hk = HDK[c.key];
      if (item) {
        const [hq, hp] = qp(l, hk);
        const ha = amt(hq, hp);
        const a = amt(...qp(l, c.key));
        cell(r, hqCol(k), hq, { fmt: QTY });
        cell(r, hpCol(k), hp, { fmt: MONEY });
        cell(r, haCol(k), ha != null ? fv(`${L(hqCol(k))}${r}*${L(hpCol(k))}${r}`, ha) : "", { fmt: MONEY });
        cell(r, plCol(k), a != null || ha != null ? fv(`${L(ca)}${r}-${L(haCol(k))}${r}`, (a ?? 0) - (ha ?? 0)) : "", { fmt: MONEY, bold: true });
        // đơn giá điều chỉnh khác đơn giá hợp đồng → chữ đỏ (như màn hình)
        const pr = qp(l, c.key)[1];
        if (pr != null && hp != null && Math.abs(pr - hp) > 0.5) ws.getCell(r, cp).font = { color: { argb: "FFDC2626" } };
      } else {
        cell(r, hqCol(k), "", { fill });
        cell(r, hpCol(k), "", { fill });
        const grp = !isRef && end > i;
        const gh = group[i]?.[hk] ?? 0;
        const ga = group[i]?.[c.key] ?? 0;
        cell(r, haCol(k), grp ? fv(sub(haCol(k)), gh) : "", { fmt: MONEY, bold: true, fill });
        cell(r, plCol(k), grp ? fv(sub(plCol(k)), ga - gh) : "", { fmt: MONEY, bold: true, fill });
      }
    });
    const autoNote = ntm ? ntNote(l, i) : "";
    cell(r, noteCol, item || isRef ? [autoNote, l.note].filter(Boolean).join("\n") : autoNote, { wrap: true, fill });
    cell(r, noteCol + 1, item || isRef || isSp ? l.qsNote : "", { wrap: true, fill });
    cell(r, noteCol + 2, item ? l.tpNote : "", { wrap: true, fill });
    r++;
  });
  // ảnh nội thất: ảnh đầu tiên của dòng vào ô HÌNH ẢNH (thu nhỏ cao tối đa 64px), dòng cao theo ảnh
  for (const { r: row, files } of imgRows) {
    const im = await exportImageOf(files[0]);
    if (!im) continue;
    const s = Math.min(1, 64 / im.height, 100 / im.width);
    const id = wb.addImage({ buffer: im.buf as unknown as ExcelJS.Buffer, extension: im.ext });
    ws.addImage(id, { tl: { col: IMG - 1 + 0.05, row: row - 1 + 0.05 }, ext: { width: Math.round(im.width * s), height: Math.round(im.height * s) }, editAs: "oneCell" });
    ws.getRow(row).height = Math.max(ws.getRow(row).height ?? 15, Math.round(im.height * s * 0.75) + 6);
  }

  // ----- các dòng dưới TỔNG CỘNG -----
  type V = number | string | ExcelJS.CellFormulaValue | null;
  const numOf = (v: V | undefined): number | null => (typeof v === "number" ? v : v && typeof v === "object" ? Number(v.result) || 0 : null);
  type SumOpt = {
    bold?: boolean; fill?: string; stt?: string; rate?: (c: Col, k: number) => number | string | null; pct?: boolean;
    row?: string; // mã dòng tổng (v:sum, v:prelim...) — để lấy công thức người dùng gõ ở ô THÀNH TIỀN PHỤ LỤC
    hd?: (c: Col, k: number) => V; // PLHĐ điều chỉnh: thành tiền theo hợp đồng gốc
    hdRate?: (c: Col, k: number) => number | string | null; // ô đơn giá hợp đồng (dòng chi phí thêm)
  };
  const sumRow = (label: string, fn: (c: Col, k: number) => V, o: SumOpt = {}) => {
    const my = r;
    cell(r, 1, o.stt ?? "", { align: "center", bold: o.bold, fill: o.fill });
    for (let i = 2; i < firstBlock; i++) cell(r, i, i === TXT ? label : "", i === TXT ? { bold: o.bold, fill: o.fill, align: o.bold ? "center" : "left", wrap: true } : { fill: o.fill });
    cols.forEach((c, k) => {
      cell(r, qtyCol(k), "", { fill: o.fill });
      const rv = o.rate ? o.rate(c, k) : null;
      cell(r, rateCol(k), rv ?? "", { fmt: o.pct ? '0.##"%"' : MONEY, fill: o.fill, align: "right" });
      const v = fn(c, k);
      cell(r, amtCol(k), v ?? "", { fmt: MONEY, bold: o.bold, fill: o.fill });
      if (!isW(k)) return;
      cell(r, hqCol(k), "", { fill: o.fill });
      const hr = o.hdRate ? o.hdRate(c, k) : null;
      cell(r, hpCol(k), hr ?? "", { fmt: MONEY, fill: o.fill, align: "right" });
      const h = o.hd ? o.hd(c, k) : null;
      cell(r, haCol(k), h ?? "", { fmt: MONEY, bold: o.bold, fill: o.fill });
      // THÀNH TIỀN PHỤ LỤC = điều chỉnh − hợp đồng (người dùng gõ công thức riêng ở ô phụ lục thì theo công thức đó)
      const a = numOf(v);
      const b = numOf(h);
      if (a == null && b == null) return void cell(r, plCol(k), "", { fill: o.fill });
      const res = (a ?? 0) - (b ?? 0);
      const pf = o.row ? fxAll[totFxKey(o.row, `PL:${baseK(c.key)}`)] : undefined;
      const xf = typeof pf === "string" && pf.trim().startsWith("=") ? xlFormula(pf, c.key === "R") : null;
      cell(r, plCol(k), fv(xf ?? `${L(amtCol(k))}${r}-${L(haCol(k))}${r}`, res), { fmt: MONEY, bold: true, fill: o.fill });
    });
    for (let i = 0; i < 3; i++) cell(r, noteCol + i, "", { fill: o.fill });
    r++;
    return my;
  };
  const ref = (k: number, row: number) => `${L(amtCol(k))}${row}`;
  const refH = (k: number, row: number) => `${L(haCol(k))}${row}`; // thành tiền theo hợp đồng gốc
  const hkOf = (c: Col) => HDK[c.key];
  // ô đơn giá dạng số / % / công thức (TT = ô tham chiếu) → công thức Excel; trả null nếu trống
  const rateFormula = (raw: string | undefined, tt: string, result: number): V => {
    const t = (raw ?? "").trim();
    if (!t) return null;
    if (t.startsWith("=")) return fv(t.slice(1).replace(/\bTT\b/gi, tt), result);
    if (/^-?[\d.,\s]+%$/.test(t)) {
      const pn = Number(t.slice(0, -1).replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
      return Number.isFinite(pn) ? fv(`${tt}*${pn}/100`, result) : result;
    }
    return result; // số tiền gõ thẳng
  };
  // dòng chi phí thêm có nội dung / số mới xuất
  const exList = extras.filter((x) => x.label.trim() || Object.values(x.vals).some((v) => v));
  // ---- CÔNG THỨC NGƯỜI DÙNG GÕ Ở CÁC DÒNG TỔNG (VD =ROUND(...;0)): đổi địa chỉ theo bố cục file xuất ----
  // số dòng của từng dòng tổng tính trước (công thức trỏ được cả dòng phía dưới)
  const vRow = new Map<string, number>();
  {
    let rr = r;
    vRow.set("v:sum", rr++);
    for (const x of exList) vRow.set(`v:x:${x.id}`, rr++);
    for (const k of ["v:prelim", "v:beforeVat", "v:vat"]) vRow.set(k, rr++);
    for (const x of vatRows) vRow.set(`v:t:${x.id}`, rr++);
    vRow.set("v:afterVat", rr++);
    if (vt > 0) vRow.set("v:vt", rr++);
    if (tb > 0) vRow.set("v:tb", rr++);
    if (other > 0) vRow.set("v:other", rr++);
    vRow.set("v:diff", rr++);
    vRow.set("v:ratio", rr++);
  }
  const lineRow = new Map(p.lines.map((l, i) => [l.id ?? "", firstRow + i]));
  // cột trên màn hình → [khối, 0 KL | 1 đơn giá | 2 thành tiền | 3 KL HĐ | 4 đơn giá HĐ | 5 thành tiền HĐ | 6 thành tiền PL] của file xuất (cột đề xuất = khối R)
  const FIXED_COL: Record<string, [string, number]> = {
    cdtQty: ["A", 0], cdtPrice: ["A", 1], cdtAmount: ["A", 2], baseQty: ["B", 0], basePrice: ["B", 1], baseAmount: ["B", 2],
    propQty: ["R", 0], propPrice: ["R", 1], propAmount: ["R", 2], tpPrice: ["R", 1], apprAmount: ["R", 2],
    cdtHdQty: ["A", 3], cdtHdPrice: ["A", 4], cdtHdAmount: ["A", 5], cdtPlAmount: ["A", 6],
    baseHdQty: ["B", 3], baseHdPrice: ["B", 4], baseHdAmount: ["B", 5], basePlAmount: ["B", 6],
    hdQty: ["R", 3], hdPrice: ["R", 4], hdAmount: ["R", 5], plAmount: ["R", 6],
  };
  const slotCol = (k: number, s: number) => [qtyCol, rateCol, amtCol, hqCol, hpCol, haCol, plCol][s](k);
  // toR: công thức ghi vào khối D (R) — khi màn hình bỏ khối D, công thức lưu trỏ ô cột thầu phụ được duyệt (cột đóng vai D) → đổi về ô của khối D
  const xlAddrOf = (row: string, col: string, toR = false): [string, number] | null => {
    const rowNo = row.startsWith("v:") ? vRow.get(row) : lineRow.get(row);
    const m = /^b([qpa]):(.+)$/.exec(col);
    const slot = m ? (m[1] === "q" ? 0 : m[1] === "p" ? 1 : 2) : 0;
    const bk: [string, number] | undefined = m ? (toR && hideD && m[2] === sel && slot > 0 ? ["R", slot] : [m[2], slot]) : FIXED_COL[col];
    const k = bk ? cols.findIndex((c) => c.key === bk[0]) : -1;
    return rowNo == null || !bk || k < 0 || (bk[1] > 2 && !isW(k)) ? null : [L(slotCol(k, bk[1])), rowNo];
  };
  // công thức đang lưu → công thức Excel (dấu , ngăn tham số, dấu . thập phân); trỏ tới ô file không có (cột hợp đồng...) → null
  const xlFormula = (stable: string, toR = false): string | null => {
    let bad = /#REF!/i.test(stable);
    const s = stable.trim().replace(/\[\[(\$?)([^|\]]+)\|(\$?)([^\]]+)\]\]/g, (_m, dr: string, row: string, dc: string, col: string) => {
      const a = xlAddrOf(row, col, toR);
      if (!a) {
        bad = true;
        return "0";
      }
      return `${dc}${a[0]}${dr}${a[1]}`;
    });
    if (bad) return null;
    let out = "";
    let inStr = false;
    for (const ch of forEval(s)) {
      if (ch === '"') inStr = !inStr;
      out += !inStr && ch === ";" ? "," : ch;
    }
    return out.replace(/^=/, "");
  };
  const fxAll = parseJson<Record<string, string>>(p.totalFormulas || "{}", {});
  // ô có công thức người dùng gõ: ghi công thức + số đã tính (không đổi được địa chỉ thì ghi số); không có thì ô như cũ (dflt)
  // tk = khoá tổng của cột (A, B, C1.., D, cột hợp đồng AH / BH / H)
  const fxOf = (row: string, tk: string, value: number, dflt: V, toR = false): V => {
    const f = fxAll[totFxKey(row, tk)];
    if (typeof f !== "string" || !f.trim().startsWith("=")) return dflt;
    const xf = xlFormula(f, toR);
    return xf ? fv(xf, value) : value;
  };
  const withFx = (row: string, c: Col, value: number, dflt: V): V => fxOf(row, dKey(c.key), value, dflt, c.key === "R");
  const rTotal = sumRow("TỔNG CỘNG", (c, k) => withFx("v:sum", c, totals[c.key].sum, lastLineRow >= firstRow ? fv(`SUBTOTAL(9,${L(amtCol(k))}${firstRow}:${L(amtCol(k))}${lastLineRow})`, sums[c.key]) : sums[c.key]), {
    bold: true,
    fill: FILL_SUM,
    row: "v:sum",
    hd: (c, k) => fxOf("v:sum", hkOf(c), totals[hkOf(c)].sum, lastLineRow >= firstRow ? fv(`SUBTOTAL(9,${L(haCol(k))}${firstRow}:${L(haCol(k))}${lastLineRow})`, sums[hkOf(c)]) : sums[hkOf(c)]),
  });
  const exRows: number[] = [];
  for (const x of exList) {
    // cột hợp đồng: ô đơn giá riêng; trống thì dùng % / công thức của ô đơn giá khối mình (số tiền gõ thẳng thì không)
    const hdRaw = (c: Col) => {
      const own = (x.rates?.[hkOf(c)] ?? "").trim();
      if (own) return own;
      const b = (x.rates?.[dKey(c.key)] ?? "").trim();
      return b.endsWith("%") || b.startsWith("=") ? b : "";
    };
    exRows.push(
      sumRow(
        x.label,
        (c, k) => {
          const key = dKey(c.key);
          const res = savedOf(c.key)?.x?.[x.id] ?? extraAmt(x, key, totals[c.key].sum);
          const rf = rateFormula(x.rates?.[key], ref(k, rTotal), res);
          return withFx(`v:x:${x.id}`, c, res, rf ?? (x.vals[key] != null ? Number(x.vals[key]) : null));
        },
        {
          stt: x.stt,
          rate: (c) => x.rates?.[dKey(c.key)] ?? null,
          row: `v:x:${x.id}`,
          hdRate: (c) => x.rates?.[hkOf(c)] || null,
          hd: (c, k) => {
            const hk = hkOf(c);
            const res = savedOf(hk)?.x?.[x.id] ?? extraAmt(x, hk, totals[hk].sum);
            const rf = rateFormula(hdRaw(c), refH(k, rTotal), res);
            return fxOf(`v:x:${x.id}`, hk, res, rf ?? (x.vals[hk] != null ? Number(x.vals[hk]) : null));
          },
        },
      ),
    );
  }
  const prelimF = (k: number, a: (k: number, row: number) => string, ex: number) => (ex > 0 ? `(${a(k, rTotal)}-${Math.round(ex)})*${L(rateCol(k))}${r}/100` : `${a(k, rTotal)}*${L(rateCol(k))}${r}/100`);
  const rPrelim = sumRow(exempt["R"] > 0 ? `CHI PHÍ PRELIM (không tính trên các dòng đánh dấu: ${Math.round(exempt["R"]).toLocaleString("vi-VN")} đ)` : "CHI PHÍ PRELIM", (c, k) => withFx("v:prelim", c, totals[c.key].prelim, fv(prelimF(k, ref, exempt[c.key]), totals[c.key].prelim)), {
    pct: true,
    rate: (c) => prelim[dKey(c.key)] ?? null,
    row: "v:prelim",
    hd: (c, k) => fxOf("v:prelim", hkOf(c), totals[hkOf(c)].prelim, fv(prelimF(k, refH, exempt[hkOf(c)]), totals[hkOf(c)].prelim)),
  });
  const beforeF = (k: number, a: (k: number, row: number) => string) => `${a(k, rTotal)}${exRows.length ? `+SUBTOTAL(9,${a(k, rTotal + 1)}:${a(k, rPrelim - 1)})` : ""}+${a(k, rPrelim)}`;
  const rBefore = sumRow("TỔNG CỘNG TRƯỚC VAT", (c, k) => withFx("v:beforeVat", c, totals[c.key].beforeVat, fv(beforeF(k, ref), totals[c.key].beforeVat)), {
    row: "v:beforeVat",
    hd: (c, k) => fxOf("v:beforeVat", hkOf(c), totals[hkOf(c)].beforeVat, fv(beforeF(k, refH), totals[hkOf(c)].beforeVat)),
  });
  const rVat = sumRow("VAT", (c, k) => withFx("v:vat", c, totals[c.key].vat, fv(`${ref(k, rBefore)}*${L(rateCol(k))}${r}/100`, totals[c.key].vat)), {
    pct: true,
    rate: (c) => vat[dKey(c.key)] ?? null,
    row: "v:vat",
    hd: (c, k) => fxOf("v:vat", hkOf(c), totals[hkOf(c)].vat, fv(`${refH(k, rBefore)}*${L(rateCol(k))}${r}/100`, totals[hkOf(c)].vat)),
  });
  const vrRows: number[] = [];
  for (const x of vatRows) {
    vrRows.push(
      sumRow(
        x.label || "Thuế bổ sung",
        (c, k) => {
          const raw = x.vals[dKey(c.key)];
          const res = savedOf(c.key)?.t?.[x.id] ?? evalVat(raw, totals[c.key].beforeVat).v;
          return withFx(`v:t:${x.id}`, c, res, rateFormula(raw, ref(k, rBefore), res));
        },
        {
          rate: (c) => x.vals[dKey(c.key)] || null,
          row: `v:t:${x.id}`,
          hd: (c, k) => {
            const hk = hkOf(c);
            const raw = x.vals[dKey(c.key)];
            const res = savedOf(hk)?.t?.[x.id] ?? evalVat(raw, totals[hk].beforeVat).v;
            return fxOf(`v:t:${x.id}`, hk, res, rateFormula(raw, refH(k, rBefore), res));
          },
        },
      ),
    );
  }
  const afterF = (k: number, a: (k: number, row: number) => string) => `${a(k, rBefore)}+${a(k, rVat)}${vrRows.length ? `+SUBTOTAL(9,${a(k, rVat + 1)}:${a(k, rVat + vrRows.length)})` : ""}`;
  const rAfter = sumRow("TỔNG CỘNG SAU VAT", (c, k) => withFx("v:afterVat", c, totals[c.key].afterVat, fv(afterF(k, ref), totals[c.key].afterVat)), {
    bold: true,
    fill: FILL_SUM,
    row: "v:afterVat",
    hd: (c, k) => fxOf("v:afterVat", hkOf(c), totals[hkOf(c)].afterVat, fv(afterF(k, refH), totals[hkOf(c)].afterVat)),
  });
  const valRow = (label: string, n: number) => sumRow(label, (c) => (c.key === "A" ? null : n), { bold: true, hd: (c) => (c.key === "A" ? null : n) });
  const rVt = vt > 0 ? valRow("TỔNG GIÁ TRỊ VẬT TƯ", vt) : 0;
  const rTb = tb > 0 ? valRow("TỔNG GIÁ TRỊ THIẾT BỊ", tb) : 0;
  const rOther = other > 0 ? valRow("TỔNG GIÁ TRỊ CHI PHÍ KHÁC", other) : 0;
  const diff = (c: Col) => savedOf(c.key)?.diff ?? totals.A.afterVat - totals[c.key].afterVat - (c.key === "A" ? 0 : vt + tb + other);
  const diffH = (c: Col) => savedOf(hkOf(c))?.diff ?? totals.AH.afterVat - totals[hkOf(c)].afterVat - (c.key === "A" ? 0 : vt + tb + other);
  const diffF = (k: number, a: (k: number, row: number) => string) => `${a(0, rAfter)}-${a(k, rAfter)}${rVt ? `-${a(k, rVt)}` : ""}${rTb ? `-${a(k, rTb)}` : ""}${rOther ? `-${a(k, rOther)}` : ""}`;
  const rDiff = sumRow("CHÊNH LỆCH so với CĐT", (c, k) => (c.key === "A" ? null : withFx("v:diff", c, diff(c), fv(diffF(k, ref), diff(c)))), {
    row: "v:diff",
    hd: (c, k) => (c.key === "A" ? null : fxOf("v:diff", hkOf(c), diffH(c), fv(diffF(k, refH), diffH(c)))),
  });
  cell(r, 1, "");
  for (let i = 2; i < firstBlock; i++) cell(r, i, i === TXT ? "TỶ LỆ so với CĐT" : "", i === TXT ? { align: "left" } : {});
  cols.forEach((c, k) => {
    for (let j = starts[k]; j < (k + 1 < cols.length ? starts[k + 1] : noteCol); j++) cell(r, j, "");
    cell(r, amtCol(k), c.key === "A" ? "" : fv(`IF(${ref(0, rAfter)}=0,0,${ref(k, rDiff)}/${ref(0, rAfter)})`, totals.A.afterVat ? diff(c) / totals.A.afterVat : 0), { fmt: "0%" });
  });
  for (let i = 0; i < 3; i++) cell(r, noteCol + i, "");
  r += 2;

  // ----- B. ĐIỀU KHOẢN HỢP ĐỒNG -----
  const bTitle = ws.getCell(r, 1);
  bTitle.value = "B. ĐIỀU KHOẢN HỢP ĐỒNG";
  bTitle.font = { bold: true, size: 13 };
  r++;
  const tcols: [number, number, string][] = [[2, 2, "Điều khoản"], [4, 9, "ĐỀ XUẤT"], [10, 15, "DUYỆT (TRƯỞNG PHÒNG / PHÓ TỔNG)"]];
  for (const [a, b, t] of tcols) {
    for (let c = a; c <= b; c++) hdr(r, c, c === a ? t : "", t === "DUYỆT (TRƯỞNG PHÒNG / PHÓ TỔNG)" ? "FFC6EFCE" : FILL_HEAD);
    if (b > a) ws.mergeCells(r, a, r, b);
  }
  hdr(r, 1, "");
  hdr(r, 3, "");
  r++;
  for (const t of fixedTerms(parseJson<Term[]>(p.terms, []))) {
    const rowH = Math.max(1, Math.ceil(Math.max(termProp(t).length, termAppr(t, sel).length) / 70)) * 16;
    for (const [a, b, v] of [[2, 2, t.label], [4, 9, termProp(t)], [10, 15, termAppr(t, sel)]] as [number, number, string][]) {
      for (let c = a; c <= b; c++) cell(r, c, c === a ? v : "", { wrap: true, bold: a === 2 });
      if (b > a) ws.mergeCells(r, a, r, b);
    }
    cell(r, 1, "");
    cell(r, 3, "");
    ws.getRow(r).height = rowH;
    r++;
  }
  r++;
  // ----- ý kiến -----
  const opinions: [string, string][] = [["Ý kiến QSTT", p.qsNote], ["Ý kiến Trưởng phòng" + (p.tpByName ? ` (${p.tpByName})` : ""), p.tpNote], ["Ý kiến Phó Tổng" + (p.ptgByName ? ` (${p.ptgByName})` : ""), p.ptgNote]];
  for (const [k, v] of opinions) {
    if (!v.trim()) continue;
    ws.getCell(r, 1).value = `${k}:`;
    ws.getCell(r, 1).font = { bold: true };
    ws.mergeCells(r, 1, r, 2);
    const c = ws.getCell(r, 3);
    c.value = v;
    c.alignment = { wrapText: true, vertical: "top" };
    ws.mergeCells(r, 3, r, 15);
    ws.getRow(r).height = Math.max(1, Math.ceil(v.length / 110)) * 16;
    r++;
  }
  void lastCol;

  // ----- Sheet 2: C. PHẠM VI CÔNG VIỆC -----
  const scope = parseJson<string[][]>(p.scope, []).filter((x) => Array.isArray(x));
  const ws2 = wb.addWorksheet("Phạm vi công việc", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const width2 = Math.max(scope.reduce((m, x) => Math.max(m, x.length), 0), 4);
  for (let c = 0; c < width2; c++) {
    const longest = scope.reduce((m, x) => Math.max(m, Math.min((x[c] ?? "").length, 70)), 0);
    ws2.getColumn(c + 1).width = Math.max(8, Math.min(60, longest + 2));
  }
  let r2 = addLetterhead(wb, ws2, Math.max(width2, 6), "C. PHẠM VI CÔNG VIỆC");
  r2 = addInfoRows(ws2, r2, Math.max(width2, 6), infoItems(p, vt, tb, other)) + 1;
  if (!scope.length) {
    ws2.getCell(r2, 1).value = "(Hồ sơ chưa có nội dung phạm vi công việc)";
  } else {
    const width = width2;
    const base = r2;
    scope.forEach((row, i) => {
      const rr = base + i;
      const isHead = i === 0;
      const isGroup = !isHead && /^([A-Z]|[IVX]+)$/.test((row[0] ?? "").trim()) && !!(row[1] ?? "").trim();
      for (let c = 0; c < width; c++) {
        const v = row[c] ?? "";
        const cl = ws2.getCell(rr, c + 1);
        if (v) cl.value = v;
        cl.border = BORDER;
        const mark = v.trim().length > 0 && v.trim().length <= 4 && !isHead && !isGroup;
        cl.alignment = { horizontal: isHead || mark ? "center" : "left", vertical: "top", wrapText: true };
        if (isHead || isGroup) cl.font = { bold: true };
        if (isHead) cl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_HEAD } };
        else if (isGroup) cl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_GRP } };
      }
    });
  }

  wb.calcProperties.fullCalcOnLoad = true;
  applyStandardStyle(wb);
  return fixXlsx(await wb.xlsx.writeBuffer());
}
