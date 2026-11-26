import ExcelJS from "exceljs";
import { fixXlsx } from "@/lib/excel-fix";
import { parsePastedNumber } from "@/lib/parse-number";
import type { Bid, Bidder, ExtraRow, Term } from "@/lib/thau-phu-calc";
import { applyRowEdits, colHidden, insertRowsAt, rowHidden, sheetVisible } from "@/lib/excel-rows";
import { listSheets, loadSheets, openZip } from "@/lib/xlsx-subset";

// Đọc file "BẢNG ĐỀ XUẤT KÝ HỢP ĐỒNG THẦU PHỤ" (so sánh CĐT (A) / ĐƠN GIÁ CƠ SỞ (B) / THẦU PHỤ A (C1), B (C2)... / ĐƠN GIÁ DUYỆT (D)).
// Cột nhận theo chữ tiêu đề 2 dòng (khối + KHỐI LƯỢNG / ĐƠN GIÁ / THÀNH TIỀN) nên số thầu phụ thay đổi vẫn đọc đúng.

type Trio = { qty?: number; price?: number; amount?: number; vt?: number; nc?: number; tb?: number };
export type SubColMap = {
  stt?: number;
  workName?: number;
  content?: number;
  code?: number;
  origin?: number; // MEP: cột NHÃN HIỆU - XUẤT XỨ (code = MÃ HIỆU SẢN PHẨM)
  mepT?: boolean; // MEP TẠM: cột "thiết bị" của từng khối = % THUÊ VẬT TƯ (khấu hao); đơn giá = vật tư × % + nhân công
  nt?: boolean; // NỘI THẤT: dims[0..2] = cột DÀI / RỘNG / CAO; dòng sản phẩm (1) có các dòng phần việc (1.1, 1.2...) → level SP
  material?: number; // NỘI THẤT: cột MÔ TẢ VẬT LIỆU
  unit?: number;
  dims: number[];
  note?: number;
  cdt: Trio;
  base: Trio;
  prop: Trio;
  bids: Record<string, Trio>;
  award?: { key: string; pct: number }[]; // LỰA CHỌN PHÊ DUYỆT khi nhập: giao 1 / nhiều thầu phụ, % khối lượng chia cho từng thầu phụ (đề xuất = bình quân gia quyền theo %)
  hd: Trio; // PLHĐ điều chỉnh: KL / đơn giá / thành tiền theo HỢP ĐỒNG gốc (cột "Hợp đồng", "Đơn giá HĐ")
  cdtHd?: Trio; // PLHĐ điều chỉnh, khối CĐT: cột theo hợp đồng (cdt = điều chỉnh)
  baseHd?: Trio; // PLHĐ điều chỉnh, khối cơ sở: cột theo hợp đồng (base = điều chỉnh)
  cdtPl?: number; // cột "Thành tiền phụ lục" của khối CĐT / cơ sở (chỉ để đối chiếu)
  basePl?: number;
  plAmount?: number; // PLHĐ điều chỉnh: cột "Thành tiền PL" của file (phần mềm tự tính = điều chỉnh − hợp đồng; cột này chỉ để nhận diện / đối chiếu)
};
export type SubParsedLine = {
  sourceRow: number;
  level: "GROUP" | "SUB" | "ITEM" | "SP" | "REF";
  stt: string;
  workName: string;
  content: string;
  code: string;
  origin: string;
  unit: string;
  dims: string;
  material: string; // NỘI THẤT: mô tả vật liệu
  dimL: string; // NỘI THẤT: dài / rộng / cao (mm)
  dimW: string;
  dimH: string;
  cdtQty: number | null;
  cdtPrice: number | null;
  baseQty: number | null;
  basePrice: number | null;
  bids: Record<string, Bid>;
  propQty: number | null;
  propPrice: number | null;
  hdQty: number | null; // KL theo hợp đồng gốc (PLHĐ điều chỉnh); trống = hạng mục mới của phụ lục
  hdPrice: number | null; // đơn giá theo hợp đồng gốc (PLHĐ điều chỉnh)
  cdtVt?: number | null; // MEP: giá chi tiết vật tư / nhân công của khối CĐT
  cdtNc?: number | null;
  cdtKh?: number | null; // MEP TẠM: % thuê vật tư của khối CĐT
  baseVt: number | null; // giá chi tiết (vật tư / nhân công / thiết bị) của khối cơ sở
  baseNc: number | null;
  baseTb: number | null;
  propVt: number | null; // đơn giá chi tiết vật tư / nhân công / thiết bị của khối đề xuất (giá chi tiết)
  propNc: number | null;
  propTb: number | null;
  cdtHdQty: number | null; // PLHĐ điều chỉnh: khối CĐT theo hợp đồng (cdtQty / cdtPrice = điều chỉnh)
  cdtHdPrice: number | null;
  baseHdQty: number | null; // PLHĐ điều chỉnh: khối cơ sở theo hợp đồng (baseQty / basePrice = điều chỉnh)
  baseHdPrice: number | null;
  note: string;
};
export type SubParsed = {
  sheetName: string;
  head: { projectName: string; projectCode: string; cdtContract: string; itemName: string };
  headRows: Record<string, number>;
  colMap: SubColMap;
  bidders: Bidder[];
  lines: SubParsedLine[];
  terms: Term[];
  termCols: Record<string, number>;
  prelim: Record<string, number>;
  vat: Record<string, number>;
  itemCount: number;
  plKind: string; // file có cột theo hợp đồng gốc (PLHĐ điều chỉnh) → "DIEU_CHINH"; không có → ""
};

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
function text(c: ExcelJS.Cell): string {
  const v = c.value as unknown;
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as { richText?: { text: string }[]; result?: unknown; text?: string };
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if ("result" in o) return o.result == null || typeof o.result === "object" ? "" : String(o.result);
    if (o.text) return o.text;
    return "";
  }
  return String(v);
}
function num(c: ExcelJS.Cell): number | null {
  const v = c.value as unknown;
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && v && "result" in v) {
    const r = (v as { result?: unknown }).result;
    return typeof r === "number" && Number.isFinite(r) ? r : null;
  }
  return parsePastedNumber(text(c));
}
const clean = (s: string) => (/^[\s.…_-]*$/.test(s) ? "" : s.replace(/[.…]{3,}/g, "").trim());
const ROMAN = /^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV)$/;

// Cột do NGƯỜI DÙNG chọn trên bảng chọn cột khi nhập (hr = dòng tiêu đề, first = dòng dữ liệu đầu tiên); không có thì phần mềm tự đoán theo chữ tiêu đề
export type SubMapping = { hr: number; first?: number; colMap: SubColMap; bidders: Bidder[] };

function parseSheet(ws: ExcelJS.Worksheet, ov?: SubMapping): SubParsed | null {
  // dòng tiêu đề: có "STT" và "NỘI DUNG CÔNG VIỆC" (hoặc "NỘI DUNG")
  let hr = ov ? ov.hr : 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 40) && !hr && !ov; r++) {
    if (rowHidden(ws, r)) continue;
    const t: string[] = [];
    ws.getRow(r).eachCell((c, col) => {
      if (!colHidden(ws, col)) t.push(norm(text(c)));
    });
    if (t.includes("STT") && t.some((x) => x.startsWith("NOI DUNG")) && t.some((x) => x.includes("THAU PHU") || x.includes("CO SO"))) hr = r;
  }
  if (!hr) return null;
  const m: SubColMap = ov
    ? { ...ov.colMap, dims: [...(ov.colMap.dims ?? [])], cdt: { ...ov.colMap.cdt }, base: { ...ov.colMap.base }, prop: { ...ov.colMap.prop }, hd: { ...(ov.colMap.hd ?? {}) }, bids: Object.fromEntries(Object.entries(ov.colMap.bids ?? {}).map(([k, t]) => [k, { ...t }])) }
    : { dims: [], cdt: {}, base: {}, prop: {}, hd: {}, bids: {} };
  if (ov?.colMap.award) m.award = ov.colMap.award.map((a) => ({ ...a }));
  const bidders: Bidder[] = ov ? ov.bidders.map((b) => ({ ...b })) : [];
  let sharedQty: number | undefined; // mẫu có 1 cột "Khối lượng (Tạm tính)" chung cho mọi khối giá
  const n = ov ? 0 : Math.max(ws.columnCount, 30); // người dùng đã chọn cột thì không tự đoán lại
  // file PLHĐ điều chỉnh? (có cột "Hợp đồng" / "Đơn giá HĐ" ngoài các khối CĐT, cơ sở) — chỉ khi đó khối CĐT / cơ sở mới chia cột hợp đồng | điều chỉnh
  let plHint = false;
  for (let c = 1; c <= n && !plHint; c++) {
    if (colHidden(ws, c)) continue;
    const t0 = norm(text(ws.getRow(hr).getCell(c)));
    const s0 = norm(text(ws.getRow(hr + 1).getCell(c)));
    if (!t0 || t0.includes("CHU DAU TU") || t0.includes("CO SO")) continue;
    if (/(^| )(HD|HOP DONG)( |$)/.test(s0) && (/^(DON GIA|THANH TIEN|KHOI LUONG)/.test(s0) || t0.startsWith("KHOI LUONG"))) plHint = true;
  }
  for (let c = 1; c <= n; c++) {
    if (colHidden(ws, c)) continue; // cột ẩn: bỏ qua (BCH / QSĐT hay ẩn cột giá cũ, thầu phụ đã loại)
    const raw = text(ws.getRow(hr).getCell(c)).replace(/\s+/g, " ").trim();
    const t = norm(raw);
    const s = norm(text(ws.getRow(hr + 1).getCell(c)));
    if (!t) continue;
    // cột đơn giá chi tiết: "Vật tư", "Nhân công", "Thiết bị" (hoặc "Đơn giá vật tư"...) — không phải thành tiền / khối lượng
    const comp = !s.startsWith("THANH TIEN") && !s.startsWith("KHOI LUONG") ? (/VAT TU/.test(s) ? "vt" : /NHAN CONG/.test(s) ? "nc" : /THIET BI/.test(s) ? "tb" : "") : "";
    const trio = (o: Trio) => {
      if (s.startsWith("KHOI LUONG")) o.qty ??= c;
      else if (comp) o[comp] ??= c;
      else if (s.startsWith("DON GIA")) o.price ??= c;
      else if (s.startsWith("THANH TIEN")) o.amount ??= c;
    };
    // cột theo HỢP ĐỒNG gốc / điều chỉnh (PLHĐ điều chỉnh): sub-dòng ghi "HĐ" / "Hợp đồng" hoặc "Điều chỉnh"
    const isHd = /(^| )(HD|HOP DONG)( |$)/.test(s);
    const isAdj = /DIEU CHINH/.test(s);
    const isPl01 = /PL\d/.test(s); // cột "Thành tiền PL01" (kết quả đối chiếu của BCH) — không nhập lại, không coi là thầu phụ
    const blk = t.includes("CHU DAU TU") ? "cdt" : t.includes("CO SO") ? "base" : "";
    if (/^(DON GIA|THANH TIEN|KHOI LUONG)/.test(s) && (isHd || isAdj || isPl01) && blk && plHint) {
      // khối CHỦ ĐẦU TƯ / CƠ SỞ của PLHĐ điều chỉnh: cũng chia cột theo hợp đồng | điều chỉnh | phụ lục
      const hdT: Trio = blk === "cdt" ? (m.cdtHd ??= {}) : (m.baseHd ??= {});
      const adjT = blk === "cdt" ? m.cdt : m.base;
      const kind = s.startsWith("KHOI LUONG") ? "qty" : s.startsWith("DON GIA") ? "price" : "amount";
      if (kind === "amount" && isPl01 && !isHd && !isAdj) {
        if (blk === "cdt") m.cdtPl ??= c;
        else m.basePl ??= c;
      } else if (isHd) hdT[kind] ??= c;
      else adjT[kind] ??= c;
      continue;
    }
    if (/^(DON GIA|THANH TIEN|KHOI LUONG)/.test(s) && (isHd || isAdj || isPl01) && !blk) {
      // khối "TP ..." của PLHĐ điều chỉnh: Đơn giá HĐ / Thành tiền HĐ (hợp đồng gốc), Đơn giá / Điều chỉnh / Thành tiền Điều chỉnh (đề xuất); "PL01" bỏ qua
      if (s.startsWith("KHOI LUONG")) {
        if (isHd) m.hd.qty ??= c;
        else m.prop.qty ??= c;
      } else if (s.startsWith("DON GIA")) {
        if (isHd) m.hd.price ??= c;
        else m.prop.price ??= c;
      } else if (s.startsWith("THANH TIEN")) {
        if (isPl01 && !isHd && !isAdj) m.plAmount ??= c;
        else if (isHd) m.hd.amount ??= c;
        else if (isAdj) m.prop.amount ??= c;
      }
      continue;
    }
    if (t === "STT") m.stt ??= c;
    else if (t.startsWith("HANG MUC")) m.workName ??= c;
    else if (t.startsWith("NOI DUNG")) m.content ??= c;
    else if (t.startsWith("MA SP") || t.startsWith("MA HIEU") || t === "MA") m.code ??= c;
    else if (t.startsWith("NHAN HIEU") || t.startsWith("XUAT XU")) m.origin ??= c;
    else if (t === "DVT" || t.startsWith("DON VI")) m.unit ??= c;
    else if (t.startsWith("KICH THUOC")) m.dims.push(c);
    else if (t.startsWith("MO TA VAT LIEU") || t.startsWith("VAT LIEU")) m.material ??= c;
    else if (t.startsWith("HINH ANH")) continue; // ảnh: đọc theo vị trí ảnh trên dòng (extractSheetImages), không phải chữ trong ô
    else if (t.startsWith("GHI CHU")) m.note ??= c;
    else if (t.startsWith("KHOI LUONG") || t === "KL") {
      // "Khối lượng" gộp 2 cột (Hợp đồng | Điều chỉnh) ở PLHĐ điều chỉnh → không dùng làm KL chung
      if (isHd) m.hd.qty ??= c;
      else if (isAdj) m.prop.qty ??= c;
      else sharedQty ??= c;
    }
    else if (t.includes("CHU DAU TU")) trio(m.cdt);
    else if (t.includes("CO SO")) trio(m.base);
    else if (t.includes("DUYET")) trio(m.prop);
    else if (t.includes("THAU PHU") || /\(C\d+\)/.test(t) || /^(DON GIA|THANH TIEN|KHOI LUONG|DVT)/.test(s) || !!comp) {
      // khối của 1 thầu phụ báo giá: "THẦU PHỤ A (C1)" hoặc chỉ ghi tên công ty ("DAGECONS", "CÔNG TY TNHH ...") với dòng dưới Đơn giá / Thành tiền
      const name = raw.replace(/\s*\(C\d+\)\s*$/i, "").trim();
      const k = raw.match(/\((C\d+)\)/i)?.[1]?.toUpperCase() ?? bidders.find((b) => b.name === name)?.key ?? `C${bidders.length + 1}`;
      if (!bidders.some((b) => b.key === k)) bidders.push({ key: k, name: name || k });
      trio((m.bids[k] ??= {}));
    }
  }
  if (!m.content && m.workName && !ov) [m.content, m.workName] = [m.workName, undefined]; // mẫu NỘI THẤT: chỉ có cột HẠNG MỤC CÔNG VIỆC
  if (!m.content) return null;
  // cột khối lượng chung → dùng cho các khối giá không có cột khối lượng riêng
  if (sharedQty) for (const o of [m.cdt, m.base, m.prop, ...Object.values(m.bids)]) o.qty ??= sharedQty;
  const plKind = m.hd.qty || m.hd.price ? "DIEU_CHINH" : "";
  // PLHĐ điều chỉnh: khối CĐT / cơ sở không có cột riêng thì dùng chung cột KL (hợp đồng | điều chỉnh) và đơn giá của khối đó cho cả 2 giá trị — người dùng sửa lại ở bảng chọn cột
  if (plKind && !ov) {
    const cdtHd = (m.cdtHd ??= {});
    const baseHd = (m.baseHd ??= {});
    for (const [x, xh] of [[m.cdt, cdtHd], [m.base, baseHd]] as [Trio, Trio][]) {
      x.qty ??= m.prop.qty;
      xh.qty ??= m.hd.qty;
      xh.price ??= x.price;
      xh.amount ??= x.amount;
    }
  } // có cột theo hợp đồng gốc → PLHĐ điều chỉnh (file thường không có)

  // thông tin đầu file
  const head = { projectName: "", projectCode: "", cdtContract: "", itemName: "" };
  const headRows: Record<string, number> = { header: hr };
  for (let r = 1; r < hr; r++) {
    if (rowHidden(ws, r)) continue;
    const raw = text(ws.getRow(r).getCell(1));
    const i = raw.indexOf(":");
    if (i < 0) continue;
    const label = norm(raw.slice(0, i));
    const v = clean(raw.slice(i + 1).trim());
    const f = label.includes("MA SO") ? "projectCode" : label.includes("HOP DONG") ? "cdtContract" : label.includes("HANG MUC") ? "itemName" : label.includes("CONG TRINH") ? "projectName" : null;
    if (f) {
      head[f] = v;
      headRows[f] = r;
    }
  }
  // nhãn không nằm ở cột A (VD cột B "Công trình:" + giá trị ở ô bên cạnh): tìm thêm ở cột B-E, chỉ điền chỗ còn trống
  for (let r = 1; r < hr; r++) {
    if (rowHidden(ws, r)) continue;
    const row = ws.getRow(r);
    for (let c = 2; c <= 5; c++) {
      if (colHidden(ws, c)) continue;
      const raw = text(row.getCell(c)).replace(/\s+/g, " ").trim();
      const i = raw.indexOf(":");
      if (i < 0 || i > 40) continue; // chỉ nhận ô nhãn có dấu ":" (tránh nhầm tiêu đề "BẢNG ĐỀ XUẤT KÝ HỢP ĐỒNG...")
      const label = norm(raw.slice(0, i));
      const f = label.includes("MA SO") ? "projectCode" : label.includes("HOP DONG") ? "cdtContract" : label.includes("HANG MUC") ? "itemName" : label.includes("CONG TRINH") || label === "DU AN" ? "projectName" : null;
      if (!f || head[f]) continue;
      let v = clean(raw.slice(i + 1).trim());
      for (let k = c + 1; k <= c + 3 && !v; k++) {
        const t = text(row.getCell(k)).replace(/\s+/g, " ").trim();
        if (t.includes(":")) break; // ô kế bên cũng là nhãn → nhãn này không có giá trị
        v = clean(t);
      }
      if (v && !v.includes(":")) head[f] = v;
    }
  }

  const g = (row: ExcelJS.Row, c?: number) => (c ? row.getCell(c) : null);
  // MEP TẠM: ô thuê vật tư trong file là % (ô 54% = 0.54) → lưu số %, VD 54; ô gõ 54 giữ nguyên
  const khv = (v: number | null) => (v == null || !m.mepT ? v : v > 0 && v <= 1 ? Math.round(v * 1e6) / 1e4 : v);
  const lines: SubParsedLine[] = [];
  const terms: Term[] = [];
  const termCols: Record<string, number> = {};
  const prelim: Record<string, number> = {};
  const vat: Record<string, number> = {};
  const priceCols: [string, number | undefined][] = [["A", m.cdt.price], ["B", m.base.price], ...Object.entries(m.bids).map(([k, t]) => [k, t.price] as [string, number | undefined]), ["D", m.prop.price]];
  let inTerms = false;
  // file định dạng sẵn cả nghìn dòng trống (rowCount rất lớn): gặp liên tiếp 300 dòng trống thì coi như hết bảng
  // (tránh tạo hàng chục nghìn dòng rỗng trong bộ nhớ làm treo / tắt server)
  let blank = 0;
  for (let r = ov?.first && ov.first > hr ? ov.first : hr + 2; r <= ws.rowCount; r++) {
    if (!ws.findRow(r)?.hasValues) {
      if (++blank > 300) break;
      continue;
    }
    blank = 0;
    const row = ws.getRow(r);
    const stt = m.stt ? text(row.getCell(m.stt)).trim() : "";
    const work = m.workName ? text(row.getCell(m.workName)).trim() : "";
    const content = text(row.getCell(m.content)).replace(/\s+/g, " ").trim();
    const label = norm(content || work);
    // dòng mở phần điều khoản: "ĐIỀU KHOẢN CHI TIẾT HỢP ĐỒNG" / "CÁC ĐIỀU KHOẢN KÝ HỢP ĐỒNG" (ở cột HẠNG MỤC hoặc NỘI DUNG)
    // (mẫu mới đặt phần điều khoản "B. CÁC ĐIỀU KHOẢN..." NGAY SAU các dòng tổng cộng → tìm cả sau dòng TỔNG CỘNG)
    if (!headRows.terms && (norm(work).startsWith("DIEU KHOAN") || /^(CAC )?DIEU KHOAN/.test(label) || /^(CAC )?DIEU KHOAN/.test(norm(work)))) {
      inTerms = true;
      headRows.terms = r;
      // cột của 4 phương án điều khoản: CHỦ ĐẦU TƯ / CƠ SỞ / ĐỀ XUẤT / DUYỆT
      row.eachCell((c, col) => {
        const t = norm(text(c));
        if (t.includes("CHU DAU TU")) termCols.cdt ??= col;
        else if (t.includes("CO SO")) termCols.base ??= col;
        else if (t.includes("DE XUAT")) termCols.prop ??= col;
        else if (t.includes("DUYET")) termCols.appr ??= col;
      });
      continue;
    }
    // dòng VAT: chữ "VAT" viết đúng (KHÔNG dấu) trong chữ gốc — tránh nhầm "vật tư" (bỏ dấu cũng thành "VAT TU")
    const isVat = /(^|[\s%(])VAT\b/i.test(content || work) && !label.startsWith("TONG CONG");
    if (label.startsWith("TONG CONG") && !label.includes("VAT")) {
      headRows.total ??= r; // "TỔNG CỘNG" (hoặc "TỔNG CỘNG TRƯỚC THUẾ" nếu file không có dòng TỔNG CỘNG riêng)
      inTerms = false;
      continue;
    }
    if (!inTerms && (label.includes("PRELIM") || isVat)) {
      if (label.includes("PRELIM")) headRows.prelim = r;
      else headRows.vat = r;
      for (const [k, pc] of priceCols) {
        if (!pc) continue;
        const v = num(row.getCell(pc));
        // ô % để trống ("%") = chưa nhập; giá trị < 1 là tỉ lệ (0,08) → đổi ra %
        if (v != null) (label.includes("PRELIM") ? prelim : vat)[k] = +(Math.abs(v) < 1 ? v * 100 : v).toFixed(4); // làm tròn: 0,07×100 không ra 7,000000000000001
      }
      if (!label.includes("PRELIM") && !Object.keys(vat).length) {
        const pct = label.match(/(\d+(?:[.,]\d+)?)\s*%/);
        if (pct) for (const [k] of priceCols) vat[k] = Number(pct[1].replace(",", "."));
      }
      continue;
    }
    if (!inTerms && (label.startsWith("TONG CONG") || label.startsWith("CHENH LECH") || label.startsWith("TY LE"))) continue;
    // sau dòng TỔNG CỘNG còn vài dòng giảm giá / trước thuế / VAT / chênh lệch → đọc tiếp tối đa 20 dòng (lấy % VAT, tìm phần điều khoản), rồi hết bảng
    if (headRows.total && !inTerms) {
      if (r > headRows.total + 20) break;
      continue;
    }
    // phần điều khoản đặt SAU dòng tổng cộng: đọc tối đa 12 dòng (sau đó là chữ ký...)
    if (inTerms && headRows.total && headRows.terms > headRows.total && r > headRows.terms + 12) break;
    if (rowHidden(ws, r)) continue; // dòng ẩn: không đọc
    if (inTerms) {
      if (!work && !content) continue;
      // chữ của 1 khối: ô đầu tiên có chữ trong các cột của khối (ô gộp đọc ra cùng chữ)
      const blockText = (o: Trio) => {
        for (const c of [o.price, o.amount, o.qty]) {
          if (!c || c === sharedQty) continue;
          const v = text(row.getCell(c)).trim();
          if (v) return v;
        }
        return "";
      };
      const tx = (k: string, o: Trio) => (termCols[k] ? text(row.getCell(termCols[k])).trim() : blockText(o));
      const t: Term = {
        label: work || content,
        cdt: tx("cdt", m.cdt),
        base: tx("base", m.base),
        prop: tx("prop", m.prop),
        appr: termCols.appr ? text(row.getCell(termCols.appr)).trim() : "",
        bids: Object.fromEntries(Object.entries(m.bids).map(([k, o]) => [k, blockText(o)])),
      };
      // chữ điều khoản nằm ở cột khác các khối giá (VD cột GHI CHÚ / cột cuối): gom mọi ô có chữ bên phải cột tên điều khoản
      const known = new Set([t.cdt, t.base, t.prop, t.appr, ...Object.values(t.bids ?? {})].filter(Boolean));
      const labelCol = Math.max(m.content, m.workName ?? 0);
      row.eachCell((c, col) => {
        if (col <= labelCol || colHidden(ws, col)) return;
        const v = text(c).trim();
        if (v && !known.has(v) && v !== t.label) {
          known.add(v);
          (t.bids ??= {})[`_${col}`] = v;
        }
      });
      // file chỉ có 1 nội dung cho điều khoản → đó là ĐỀ XUẤT của BCH / QSĐT, điền sẵn (QSĐT vẫn sửa được)
      if (!t.prop) {
        const all = [...new Set([t.cdt, t.base, ...Object.values(t.bids ?? {})].map((x) => x.trim()).filter(Boolean))];
        if (all.length === 1) t.prop = all[0];
      }
      terms.push(t);
      continue;
    }
    if (!content && !work) continue;
    const bids: Record<string, Bid> = {};
    for (const [k, t] of Object.entries(m.bids)) {
      bids[k] = { qty: t.qty ? num(row.getCell(t.qty)) : null, price: t.price ? num(row.getCell(t.price)) : null };
      if (t.vt || t.nc || t.tb) Object.assign(bids[k], { vt: t.vt ? num(row.getCell(t.vt)) : null, nc: t.nc ? num(row.getCell(t.nc)) : null, tb: t.tb ? khv(num(row.getCell(t.tb))) : null });
    }
    const l: SubParsedLine = {
      sourceRow: r,
      level: "ITEM",
      stt,
      workName: work,
      content,
      code: m.code ? text(row.getCell(m.code)).trim() : "",
      origin: m.origin ? text(row.getCell(m.origin)).trim() : "",
      unit: m.unit ? text(row.getCell(m.unit)).trim() : "",
      dims: m.dims.filter((c) => c > 0).map((c) => text(row.getCell(c)).trim()).filter(Boolean).join(" × "),
      material: m.material ? text(row.getCell(m.material)).trim() : "",
      dimL: m.nt && m.dims[0] ? text(row.getCell(m.dims[0])).trim() : "",
      dimW: m.nt && m.dims[1] ? text(row.getCell(m.dims[1])).trim() : "",
      dimH: m.nt && m.dims[2] ? text(row.getCell(m.dims[2])).trim() : "",
      cdtQty: m.cdt.qty ? num(g(row, m.cdt.qty)!) : null,
      cdtPrice: m.cdt.price ? num(g(row, m.cdt.price)!) : null,
      cdtVt: m.cdt.vt ? num(g(row, m.cdt.vt)!) : null,
      cdtNc: m.cdt.nc ? num(g(row, m.cdt.nc)!) : null,
      cdtKh: m.cdt.tb ? khv(num(g(row, m.cdt.tb)!)) : null,
      baseQty: m.base.qty ? num(g(row, m.base.qty)!) : null,
      basePrice: m.base.price ? num(g(row, m.base.price)!) : null,
      bids,
      propQty: m.prop.qty ? num(g(row, m.prop.qty)!) : null,
      propPrice: m.prop.price ? num(g(row, m.prop.price)!) : null,
      hdQty: m.hd.qty ? num(g(row, m.hd.qty)!) : null,
      hdPrice: m.hd.price ? num(g(row, m.hd.price)!) : null,
      baseVt: m.base.vt ? num(g(row, m.base.vt)!) : null,
      baseNc: m.base.nc ? num(g(row, m.base.nc)!) : null,
      baseTb: m.base.tb ? khv(num(g(row, m.base.tb)!)) : null,
      propVt: m.prop.vt ? num(g(row, m.prop.vt)!) : null,
      propNc: m.prop.nc ? num(g(row, m.prop.nc)!) : null,
      propTb: m.prop.tb ? khv(num(g(row, m.prop.tb)!)) : null,
      cdtHdQty: m.cdtHd?.qty ? num(g(row, m.cdtHd.qty)!) : null,
      cdtHdPrice: m.cdtHd?.price ? num(g(row, m.cdtHd.price)!) : null,
      baseHdQty: m.baseHd?.qty ? num(g(row, m.baseHd.qty)!) : null,
      baseHdPrice: m.baseHd?.price ? num(g(row, m.baseHd.price)!) : null,
      note: m.note ? text(row.getCell(m.note)).trim() : "",
    };
    // MEP: CĐT chỉ có cột vật tư / nhân công (không có cột đơn giá tổng) → đơn giá CĐT = vật tư + nhân công
    if (l.cdtPrice == null && (l.cdtVt != null || l.cdtNc != null)) l.cdtPrice = (l.cdtVt ?? 0) * (m.mepT ? (l.cdtKh ?? 100) / 100 : 1) + (l.cdtNc ?? 0);
    // LỰA CHỌN PHÊ DUYỆT chia nhiều thầu phụ: khối lượng đề xuất = khối lượng thầu phụ đầu tiên có số liệu, đơn giá đề xuất = Σ (% × đơn giá từng thầu phụ) — thành tiền = KL × ĐG = Σ % × KL × ĐG
    const aw = (m.award ?? []).filter((a) => a.pct > 0 && bids[a.key]);
    if (aw.length > 1 && !m.prop.qty && !m.prop.price) {
      const tot = aw.reduce((s, a) => s + a.pct, 0) || 100;
      const prices = aw.map((a) => bids[a.key].price);
      l.propQty = aw.map((a) => bids[a.key].qty).find((q) => q != null) ?? null;
      l.propPrice = prices.every((p) => p != null) ? aw.reduce((s, a, i) => s + (a.pct / tot) * (prices[i] as number), 0) : null;
    }
    const s = stt.trim(); // chữ HOA (A, B / I, II) mới là đầu mục lớn; chữ thường a, b là dòng công việc con
    l.level = ROMAN.test(s) ? "SUB" : /^[A-Z]$/.test(s) ? "GROUP" : "ITEM";
    if (l.level !== "ITEM" && !l.content) l.content = work; // dòng nhóm: tên ở cột HẠNG MỤC
    lines.push(l);
  }
  if (m.nt) ntLevels(lines);
  return { sheetName: ws.name, head, headRows, colMap: m, bidders, lines, terms, termCols, prelim, vat, itemCount: lines.filter((l) => l.level === "ITEM").length, plKind };
}

// NỘI THẤT: dòng SẢN PHẨM = dòng số thứ tự nguyên (1, 2...) có các dòng PHẦN VIỆC liền bên dưới (STT 1.1, 1.2 / a, b / -, + / để trống
// nhưng có ĐVT hoặc số liệu) → level "SP". Trong các dòng phần việc: file có thầu phụ báo giá ở ít nhất 1 dòng phần việc thì dòng phần việc
// KHÔNG có giá nào (thầu phụ / đề xuất) = phần việc KHÁC, không trình lần này → "REF" (QSĐT đổi lại được ở menu ▾ của dòng).
function ntLevels(lines: SubParsedLine[]) {
  const priced = (l: SubParsedLine) => Object.values(l.bids).some((b) => b.price != null) || l.propPrice != null;
  const isChild = (parent: string, l: SubParsedLine) => {
    if (l.level !== "ITEM") return false;
    const s = l.stt.trim();
    if (s.startsWith(`${parent}.`) || /^[a-z]$|^[-+*•]$/.test(s)) return true;
    return !s && (!!l.unit.trim() || l.cdtQty != null || l.cdtPrice != null || priced(l));
  };
  const kids: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].stt.trim();
    if (lines[i].level !== "ITEM" || !/^\d+$/.test(s)) continue;
    const block: number[] = [];
    for (let j = i + 1; j < lines.length && isChild(s, lines[j]); j++) block.push(j);
    // dòng sản phẩm tự có giá thầu phụ mà các dòng bên dưới không có giá → chỉ là dòng diễn giải, sản phẩm vẫn là 1 dòng công tác
    if (!block.length || (priced(lines[i]) && !block.some((k) => priced(lines[k])))) continue;
    lines[i].level = "SP";
    kids.push(...block);
    i = block[block.length - 1];
  }
  if (kids.some((k) => priced(lines[k]))) for (const k of kids) if (!priced(lines[k])) lines[k].level = "REF";
}

// ---- TỰ NHẬN DIỆN CỘT (dự phòng khi cách đoán theo mẫu chuẩn không ra) ----
// Chấm điểm từng dòng trong 60 dòng đầu để tìm dòng tiêu đề (STT / NỘI DUNG / ĐVT / KL / ĐƠN GIÁ / THÀNH TIỀN...), đọc được cả 2 kiểu 2 tầng:
//  (A) tên khối giá ở dòng tiêu đề, ĐƠN GIÁ / THÀNH TIỀN ở dòng dưới;  (B) tên khối giá ở dòng TRÊN dòng tiêu đề, ĐƠN GIÁ / THÀNH TIỀN cùng dòng với STT.
// Khối: CHỦ ĐẦU TƯ / CƠ SỞ / ĐỀ XUẤT-DUYỆT; chữ khác (tên công ty, "THẦU PHỤ A (C1)") = 1 thầu phụ báo giá. Cột "SL" không thuộc khối nào = khối lượng chung.
type FKind = "stt" | "work" | "content" | "unit" | "qty" | "price" | "amount" | "code" | "origin" | "note" | "dims" | "material";
const gkey = (s: string) => norm(s).replace(/[^A-Z0-9]/g, "");
function fieldKind(raw: string): FKind | null {
  if (!raw || raw.length > 60) return null;
  const k = gkey(raw);
  if (/^(STT|TT|SOTT|SOTHUTU)$/.test(k)) return "stt";
  if (/^(MOTAVATLIEU|VATLIEU|MOTAVL)/.test(k)) return "material"; // NỘI THẤT: MÔ TẢ VẬT LIỆU (trước "MÔ TẢ" = nội dung)
  if (/^(HANGMUC|TENNHOM|NHOM|PHANLOAI)/.test(k)) return "work";
  if (/^(NOIDUNG|CONGVIEC|CONGTAC|DIENGIAI|MOTA|TEN)/.test(k)) return "content";
  if (/^(DVT|DONVI|DV)$|^DONVI/.test(k)) return "unit";
  if (/^(KHOILUONG|SOLUONG|KL|SL)/.test(k)) return "qty";
  if (/^(DONGIA|DG)/.test(k)) return "price";
  if (/^(THANHTIEN|GIATRI|TONGTIEN)/.test(k)) return "amount";
  if (/^(MASP|MASANPHAM|MA|MAHANG|MAVATTU)$|^MAHIEU/.test(k)) return "code";
  if (/^(NHANHIEU|XUATXU)/.test(k)) return "origin";
  if (/^GHICHU/.test(k)) return "note";
  if (/^KICHTHUOC/.test(k)) return "dims";
  return null;
}
const blockKind = (raw: string): "cdt" | "base" | "prop" | "bid" => {
  const k = gkey(raw);
  if (/CHUDAUTU|^CDT/.test(k)) return "cdt";
  if (/COSO/.test(k)) return "base";
  if (/DEXUAT|DUYET/.test(k)) return "prop";
  return "bid";
};
const TRIO_KINDS: FKind[] = ["qty", "price", "amount"];

export function guessSubMapping(ws: ExcelJS.Worksheet): SubMapping | null {
  const cellAt = (r: number, c: number) => (r < 1 ? "" : text(ws.getRow(r).getCell(c)).replace(/\s+/g, " ").trim());
  const nCols = Math.min(Math.max(ws.columnCount, 1), 45);
  const kindsOf = (r: number) => {
    const s = new Set<FKind>();
    if (r < 1 || r > ws.rowCount || rowHidden(ws, r)) return s;
    for (let c = 1; c <= nCols; c++) if (!colHidden(ws, c)) {
      const k = fieldKind(cellAt(r, c));
      if (k) s.add(k);
    }
    return s;
  };
  const hasNumber = (r: number) => {
    let f = false;
    ws.getRow(r).eachCell((c) => {
      if (typeof c.value === "number") f = true;
    });
    return f;
  };
  // 0) ƯU TIÊN: dòng tiêu đề = dòng ĐẦU TIÊN có ô "STT" / "TT" (đúng chữ) kèm 1 ô nội dung / hạng mục (NỘI DUNG, CÔNG VIỆC, HẠNG MỤC...)
  //    → dòng dữ liệu đầu tiên = dòng đầu tiên bên dưới có chữ ở cột STT (bỏ qua các dòng tiêu đề tầng 2, 3 lặp lại chữ STT)
  let hr = 0;
  let sttCol = 0;
  let sttBest = 0;
  // có nhiều dòng thoả (VD bảng phụ ở cột xa cũng có "STT / NỘI DUNG"): chọn dòng có NHIỀU LOẠI CỘT nhất (STT, nội dung, ĐVT, KL / đơn giá / thành tiền ở dòng ngay dưới); bằng nhau thì dòng trên
  for (let r = 1; r <= Math.min(ws.rowCount, 60); r++) {
    if (rowHidden(ws, r)) continue;
    let sc = 0;
    let other = false;
    for (let c = 1; c <= nCols; c++) {
      if (colHidden(ws, c)) continue;
      const k = fieldKind(cellAt(r, c));
      if (k === "stt") sc ||= c;
      else if (k === "content" || k === "work") other = true;
    }
    if (!(sc && other)) continue;
    const score = new Set<FKind>([...kindsOf(r), ...[...kindsOf(r + 1)].filter((k) => TRIO_KINDS.includes(k))]).size;
    if (score > sttBest) {
      sttBest = score;
      hr = r;
      sttCol = sc;
    }
  }
  const anchored = hr > 0;
  let firstData = 0;
  if (anchored) {
    for (let k = hr + 1; k <= Math.min(ws.rowCount, hr + 8) && !firstData; k++) {
      if (rowHidden(ws, k)) continue;
      const v = cellAt(k, sttCol);
      if (v && fieldKind(v) !== "stt") firstData = k;
    }
  }
  // 1) dòng tiêu đề: nhiều loại cột nhất, bắt buộc có cột nội dung
  let best = 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 60) && !anchored; r++) {
    const ks = kindsOf(r);
    const low = kindsOf(r + 1);
    const all = new Set<FKind>([...ks, ...[...low].filter((k) => TRIO_KINDS.includes(k))]);
    if (ks.has("content") && all.size >= 3 && all.size > best) {
      hr = r;
      best = all.size;
    }
  }
  if (!hr) return null;
  // 2) kiểu 2 tầng
  const here = kindsOf(hr);
  const lowRow = kindsOf(hr + 1);
  const caseB = here.has("price") || here.has("amount"); // ĐƠN GIÁ / THÀNH TIỀN cùng dòng với STT → tên khối ở dòng trên
  const caseA = !caseB && [...lowRow].some((k) => TRIO_KINDS.includes(k)) && !hasNumber(hr + 1);
  const upOk = caseB && hr > 1 && !rowHidden(ws, hr - 1) && !hasNumber(hr - 1);

  const m: SubColMap = { dims: [], cdt: {}, base: {}, prop: {}, hd: {}, bids: {} };
  const bidders: Bidder[] = [];
  let sharedQty: number | undefined;
  let carry = ""; // khối đang chạy (ô tên khối không gộp, chỉ ghi ở cột đầu của khối)
  for (let c = 1; c <= nCols; c++) {
    if (colHidden(ws, c)) continue;
    const L0 = cellAt(hr, c);
    let field: FKind | null;
    let block = "";
    if (caseB) {
      field = fieldKind(L0);
      block = upOk ? cellAt(hr - 1, c) : "";
    } else if (caseA) {
      const plain = fieldKind(L0);
      const sub = fieldKind(cellAt(hr + 1, c));
      if (plain && !TRIO_KINDS.includes(plain)) field = plain;
      else if (sub && TRIO_KINDS.includes(sub)) {
        field = sub;
        block = L0;
      } else field = plain;
    } else field = fieldKind(L0);
    if (!field) {
      carry = "";
      continue;
    }
    if (!TRIO_KINDS.includes(field)) {
      if (field === "stt") m.stt ??= c;
      else if (field === "work") m.workName ??= c;
      else if (field === "content") m.content ??= c;
      else if (field === "unit") m.unit ??= c;
      else if (field === "code") m.code ??= c;
      else if (field === "origin") m.origin ??= c;
      else if (field === "note") m.note ??= c;
      else if (field === "dims") m.dims.push(c);
      else if (field === "material") m.material ??= c;
      carry = "";
      continue;
    }
    if (block) carry = block;
    else block = carry;
    if (!block) {
      if (field === "qty") sharedQty ??= c; // "SL" chung, không thuộc khối giá nào
      continue;
    }
    const bk = blockKind(block);
    const trio = bk === "bid" ? (m.bids[bidKey(block, bidders)] ??= {}) : m[bk];
    if (field === "qty") trio.qty ??= c;
    else if (field === "price") trio.price ??= c;
    else trio.amount ??= c;
  }
  // mẫu NỘI THẤT: chỉ có cột "HẠNG MỤC CÔNG VIỆC" (không có cột NỘI DUNG riêng) → hạng mục là nội dung công việc
  if (!m.content && m.workName) [m.content, m.workName] = [m.workName, undefined];
  // không thấy cột nội dung theo chữ: lấy cột có nhiều ô chữ dài nhất bên dưới tiêu đề
  if (!m.content) {
    const used = new Set<number | undefined>([m.stt, m.workName, m.unit, m.code, m.origin, m.note, m.material]);
    const score: Record<number, number> = {};
    for (let r = hr + 1; r <= Math.min(ws.rowCount, hr + 30); r++)
      for (let c = 1; c <= nCols; c++) {
        if (used.has(c) || colHidden(ws, c)) continue;
        const t = cellAt(r, c);
        if (t.length >= 8 && num(ws.getRow(r).getCell(c)) == null) score[c] = (score[c] ?? 0) + 1;
      }
    const top = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
    if (top) m.content = Number(top[0]);
  }
  if (!m.content) return null;
  if (sharedQty) for (const o of [m.cdt, m.base, m.prop, ...Object.values(m.bids)]) o.qty ??= sharedQty;
  return { hr, first: firstData || (caseA ? hr + 2 : hr + 1), colMap: m, bidders };
}
// ---- DÒ CỘT THEO NHIỀU TẦNG TIÊU ĐỀ (3, 4 dòng, ô gộp) ----
// Mỗi cột: gom chữ các dòng tiêu đề từ trên xuống → tầng THẤP NHẤT có chữ loại cột (Khối lượng / Đơn giá / Thành tiền...) là loại cột; các tầng còn lại (CHỦ ĐẦU TƯ (A), BÁO GIÁ NHÀ THẦU (C), METTA...) là tên KHỐI giá.
// "Đơn giá vật tư" đứng 1 mình trong khối (không có đơn giá chung) → coi là đơn giá của khối đó; có từ 2 thành phần vật tư / nhân công / thiết bị → giá chi tiết.
function tieredGuess(ws: ExcelJS.Worksheet): SubMapping | null {
  const nCols = Math.min(Math.max(ws.columnCount, 1), 45);
  const cellAt = (r: number, c: number) => (r < 1 ? "" : text(ws.getRow(r).getCell(c)).replace(/\s+/g, " ").trim());
  const compOf = (raw: string): "vt" | "nc" | "tb" | "" => {
    const k = gkey(raw);
    if (/^(DONGIA|DG)?(VATTU|VT)$/.test(k)) return "vt";
    if (/^(DONGIA|DG)?(NHANCONG|NC)$/.test(k)) return "nc";
    if (/^(DONGIA|DG)?(THIETBI|TB)$/.test(k)) return "tb";
    return "";
  };
  const isField = (s: string) => !!fieldKind(s) || !!compOf(s);
  // 1) dòng tiêu đề: có ô STT + ô nội dung; nhiều dòng thoả thì chọn dòng mà 4 dòng từ đó trở xuống có NHIỀU LOẠI CỘT nhất, bằng nhau thì dòng trên
  let hr = 0;
  let sc = 0;
  let best = 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 60); r++) {
    if (rowHidden(ws, r)) continue;
    let s0 = 0;
    let other = false;
    for (let c = 1; c <= nCols; c++) {
      if (colHidden(ws, c)) continue;
      const k = fieldKind(cellAt(r, c));
      if (k === "stt") s0 ||= c;
      else if (k === "content" || k === "work") other = true;
    }
    if (!(s0 && other)) continue;
    const kinds = new Set<string>();
    for (let rr = r; rr <= r + 3; rr++) {
      if (rowHidden(ws, rr)) continue;
      for (let c = 1; c <= nCols; c++) if (!colHidden(ws, c)) {
        const t = cellAt(rr, c);
        const k = compOf(t) ? "price" : fieldKind(t);
        if (k) kinds.add(k);
      }
    }
    if (kinds.size > best) {
      best = kinds.size;
      hr = r;
      sc = s0;
    }
  }
  if (!hr) return null;
  let first = 0;
  for (let k = hr + 1; k <= Math.min(ws.rowCount, hr + 8) && !first; k++) {
    if (rowHidden(ws, k)) continue;
    const v = cellAt(k, sc);
    if (v && fieldKind(v) !== "stt") first = k;
  }
  if (!first) first = hr + 2;

  const m: SubColMap = { dims: [], cdt: {}, base: {}, prop: {}, hd: {}, bids: {} };
  const bidders: Bidder[] = [];
  const comps = new Map<Trio, Partial<Record<"vt" | "nc" | "tb", number>>>();
  let sharedQty: number | undefined;
  const grp = (s: string) => /BAO GIA|NHA THAU|THAU PHU|\(\s*C\s*\)/.test(norm(s)); // nhãn nhóm chung, không phải tên thầu phụ
  for (let c = 1; c <= nCols; c++) {
    if (colHidden(ws, c)) continue;
    const tiers: string[] = [];
    for (let r = hr; r < first; r++) {
      if (rowHidden(ws, r)) continue;
      const t = cellAt(r, c);
      if (t && gkey(t) !== gkey(tiers[tiers.length - 1] ?? "")) tiers.push(t);
    }
    let fi = -1;
    for (let i = tiers.length - 1; i >= 0; i--) if (isField(tiers[i])) { fi = i; break; }
    if (fi < 0) continue;
    const raw = tiers[fi];
    const comp = compOf(raw);
    // "Vật tư / Nhân công / Thiết bị" đứng dưới tầng "THÀNH TIỀN..." hoặc "KHỐI LƯỢNG..." là thành phần của thành tiền / khối lượng — không phải đơn giá thành phần → bỏ qua
    if (comp && /^(VATTU|NHANCONG|THIETBI|VT|NC|TB)$/.test(gkey(raw))) {
      const parent = tiers.slice(0, fi).reverse().map((t) => fieldKind(t)).find((k) => k === "qty" || k === "price" || k === "amount");
      if (parent === "amount" || parent === "qty") continue;
    }
    const fk = comp ? "price" : fieldKind(raw)!;
    if (fk !== "qty" && fk !== "price" && fk !== "amount") {
      if (fk === "stt") m.stt ??= c;
      else if (fk === "work") m.workName ??= c;
      else if (fk === "content") m.content ??= c;
      else if (fk === "unit") m.unit ??= c;
      else if (fk === "code") m.code ??= c;
      else if (fk === "origin") m.origin ??= c;
      else if (fk === "note") m.note ??= c;
      else if (fk === "dims") m.dims.push(c);
      else if (fk === "material") m.material ??= c;
      continue;
    }
    const blockTiers = tiers.filter((t, i) => i !== fi && !isField(t));
    if (!blockTiers.length) {
      if (fk === "qty") sharedQty ??= c; // "Khối lượng" chung, không thuộc khối giá nào
      continue;
    }
    let bk: "cdt" | "base" | "prop" | "bid" = "bid";
    for (const t of blockTiers) {
      const b = blockKind(t);
      if (b !== "bid") { bk = b; break; }
    }
    let trio: Trio;
    if (bk === "bid") {
      const name = blockTiers.filter((t) => !grp(t)).join(" / ") || blockTiers.join(" / ");
      trio = m.bids[bidKey(name, bidders)] ??= {};
    } else trio = m[bk];
    if (fk === "qty") trio.qty ??= c;
    else if (fk === "amount") trio.amount ??= c;
    else if (comp) {
      const cm = comps.get(trio) ?? {};
      cm[comp] ??= c;
      comps.set(trio, cm);
    } else trio.price ??= c;
  }
  for (const [trio, cm] of comps) {
    const cols = Object.entries(cm) as ["vt" | "nc" | "tb", number][];
    if (cols.length >= 2) for (const [k, c] of cols) trio[k] ??= c;
    else trio.price ??= cols[0]?.[1];
  }
  if (!m.content && m.workName) [m.content, m.workName] = [m.workName, undefined]; // mẫu NỘI THẤT: chỉ có cột HẠNG MỤC CÔNG VIỆC
  if (!m.content) return null;
  if (sharedQty) for (const o of [m.cdt, m.base, ...Object.values(m.bids), ...(Object.keys(m.prop).length ? [m.prop] : [])]) o.qty ??= sharedQty;
  return { hr, first, colMap: m, bidders };
}
// khoá thầu phụ (C1, C2...) theo tên khối: "THẦU PHỤ A (C1)" giữ C1; tên công ty thì đánh số theo thứ tự gặp
function bidKey(block: string, bidders: Bidder[]): string {
  const name = block.replace(/\s*\(C\d+\)\s*$/i, "").trim();
  const k = block.match(/\((C\d+)\)/i)?.[1]?.toUpperCase() ?? bidders.find((b) => b.name === name)?.key ?? `C${bidders.length + 1}`;
  if (!bidders.some((b) => b.key === k)) bidders.push({ key: k, name: name || k });
  return k;
}

export async function parseSubWorkbook(buf: ArrayBuffer): Promise<SubParsed[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb.worksheets.filter(sheetVisible).map((w) => parseSheet(w)).filter((x): x is SubParsed => !!x && x.itemCount > 0); // sheet ẩn bỏ qua
}

// ---- Nhập file thầu phụ bằng BẢNG CHỌN CỘT: người dùng chỉ định cột nội dung, giá CĐT, giá cơ sở, thầu phụ 1/2/3..., giá đề xuất duyệt ----
export async function subSheetNames(buf: ArrayBuffer): Promise<string[]> {
  const zip = await openZip(buf);
  return (await listSheets(zip)).filter((x) => x.state === "visible").map((x) => x.name);
}

// Sheet "PHẠM VI CÔNG VIỆC" (nếu file có): đọc thành bảng chữ để hiện chỉ-xem trên hồ sơ. Không có sheet → [].
export async function readScopeSheet(buf: ArrayBuffer): Promise<string[][]> {
  try {
    const zip = await openZip(buf);
    const hit = (await listSheets(zip)).find((x) => x.state === "visible" && norm(x.name).includes("PHAM VI"));
    if (!hit) return [];
    const wb = await loadSheets(buf, [hit.name]);
    const ws = wb.getWorksheet(hit.name);
    if (!ws) return [];
    // bỏ qua cột ẩn và dòng ẩn
    const colIdx: number[] = [];
    for (let c = 1; c <= Math.min(Math.max(ws.columnCount, 1), 40); c++) if (!colHidden(ws, c)) colIdx.push(c);
    const rows: string[][] = [];
    for (let r = 1; r <= Math.min(ws.rowCount, 600); r++) {
      if (rowHidden(ws, r)) continue;
      const cells: string[] = [];
      for (const c of colIdx) {
        const cell = ws.getRow(r).getCell(c);
        cells.push(cell.isMerged && cell.master.address !== cell.address ? "" : text(cell).replace(/[ \t]+/g, " ").trim().slice(0, 2000));
      }
      rows.push(cells);
    }
    while (rows.length && !rows[rows.length - 1].some(Boolean)) rows.pop();
    let keep = rows.filter((r) => r.some(Boolean));
    // chỉ lấy từ dòng tiêu đề bảng (TT | NỘI DUNG CÔNG VIỆC ...) trở xuống; phần trên (tên bảng, dự án, gói thầu, hình thức giao thầu) hồ sơ đã có
    const hi = keep.findIndex((r) => r.some((c) => norm(c) === "TT") && r.some((c) => norm(c).startsWith("NOI DUNG")));
    const hj = hi >= 0 ? hi : keep.findIndex((r) => r.some((c) => norm(c).startsWith("NOI DUNG CONG VIEC")));
    if (hj > 0) keep = keep.slice(hj);
    // bỏ cột trống hoàn toàn (cột chỉ để kẻ khung / đệm)
    const used = colIdx.map((_, i) => i).filter((i) => keep.some((r) => r[i]));
    return keep.map((r) => used.map((i) => r[i] ?? ""));
  } catch {
    return [];
  }
}

export type SubSheetPreview ={ rows: string[][]; cols: number; guess: SubMapping | null };
// Xem trước 1 sheet (chữ từng ô các dòng đầu, chỉ nạp ĐÚNG sheet này) + gợi ý cột theo cách đoán tự động
export async function previewSubSheet(buf: ArrayBuffer, sheetName: string): Promise<SubSheetPreview> {
  const wb = await loadSheets(buf, [sheetName]);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error("Không thấy sheet trong file");
  const cols = Math.min(Math.max(ws.columnCount, 1), 45);
  const rows: string[][] = [];
  let last = 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 70); r++) {
    const cells: string[] = [];
    for (let c = 1; c <= cols; c++) cells.push(text(ws.getRow(r).getCell(c)).replace(/\s+/g, " ").trim().slice(0, 60));
    rows.push(cells);
    if (cells.some(Boolean)) last = r;
  }
  let width = 0;
  for (const row of rows.slice(0, last)) row.forEach((t, i) => t && (width = Math.max(width, i + 1)));
  const g = parseSheet(ws);
  // cách đoán theo mẫu chuẩn trước; không ra thì dùng bộ nhận diện tổng quát (khối giá ở dòng trên / cột SL chung / tiêu đề tự do)
  const std: SubMapping | null = g ? { hr: g.headRows.header, first: g.headRows.header + 2, colMap: g.colMap, bidders: g.bidders } : null;
  // chấm điểm số cột giá nhận ra được (KL / đơn giá / thành tiền của mọi khối) → lấy cách dò nhận ra nhiều nhất; bằng nhau ưu tiên mẫu chuẩn
  const score = (mp: SubMapping | null) => (mp ? [mp.colMap.cdt, mp.colMap.base, ...Object.values(mp.colMap.bids)].reduce((s, t) => s + (t.qty ? 1 : 0) + (t.price ? 1 : 0) + (t.amount ? 1 : 0), 0) : -1);
  const cands = [std, tieredGuess(ws), guessSubMapping(ws)];
  let guess: SubMapping | null = null;
  for (const cd of cands) if (cd && (!guess || score(cd) > score(guess))) guess = cd;
  // dòng dữ liệu đầu tiên = dòng đầu tiên bên dưới tiêu đề có chữ ở cột STT (bỏ qua các tầng tiêu đề lặp chữ STT do ô gộp)
  if (guess?.colMap.stt) {
    const sc = guess.colMap.stt;
    for (let k = guess.hr + 1; k <= Math.min(ws.rowCount, guess.hr + 8); k++) {
      const v = text(ws.getRow(k).getCell(sc)).replace(/\s+/g, " ").trim();
      if (v && fieldKind(v) !== "stt") {
        guess = { ...guess, first: k };
        break;
      }
    }
  }
  return { rows: rows.slice(0, last).map((r) => r.slice(0, Math.max(width, 1))), cols: Math.max(width, 1), guess };
}

// Đọc sheet theo cột người dùng đã chọn
export async function parseSubSheetWith(buf: ArrayBuffer, sheetName: string, mapping: SubMapping): Promise<SubParsed | null> {
  const wb = await loadSheets(buf, [sheetName]);
  const ws = wb.getWorksheet(sheetName);
  return ws ? parseSheet(ws, mapping) : null;
}

// ---- QSĐT tự chọn SỐ LƯỢNG THẦU PHỤ + cột của từng thầu phụ (phần mềm hay nhận diện sai tiêu đề) ----
async function openSheet(fileData: Uint8Array, sheetName: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength) as ArrayBuffer);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error("Không thấy sheet trong file gốc");
  return ws;
}
export type SheetCol = { c: number; top: string; sub: string; hidden: boolean };
// các cột của bảng (chữ tiêu đề 2 dòng) để QSĐT chọn cột KL / đơn giá cho từng thầu phụ
export async function sheetColumns(fileData: Uint8Array, sheetName: string, hr: number): Promise<SheetCol[]> {
  const ws = await openSheet(fileData, sheetName);
  const n = Math.max(ws.columnCount, 10);
  const out: SheetCol[] = [];
  for (let c = 1; c <= n; c++) out.push({ c, top: text(ws.getRow(hr).getCell(c)).replace(/\s+/g, " ").trim(), sub: text(ws.getRow(hr + 1).getCell(c)).replace(/\s+/g, " ").trim(), hidden: colHidden(ws, c) });
  return out;
}
export type BidColDef = { name: string; qty?: number; price: number };
// đọc lại KL / đơn giá từng thầu phụ theo ĐÚNG cột QSĐT chọn; Prelim / VAT ở dòng đã nhận khi tải file
export async function readBidCols(fileData: Uint8Array, sheetName: string, defs: BidColDef[], rows: number[], hr: Record<string, number>) {
  const ws = await openSheet(fileData, sheetName);
  const keyOf = (i: number) => `C${i + 1}`;
  const bids = new Map<number, Record<string, Bid>>();
  for (const r of rows) {
    const row = ws.getRow(r);
    bids.set(r, Object.fromEntries(defs.map((d, i) => [keyOf(i), { qty: d.qty ? num(row.getCell(d.qty)) : null, price: num(row.getCell(d.price)) }])));
  }
  const pct = (r?: number) => {
    const o: Record<string, number> = {};
    if (!r) return o;
    defs.forEach((d, i) => {
      const v = num(ws.getRow(r).getCell(d.price));
      if (v != null) o[keyOf(i)] = +(Math.abs(v) < 1 ? v * 100 : v).toFixed(4);
    });
    return o;
  };
  return { bids, bidders: defs.map((d, i) => ({ key: keyOf(i), name: d.name.trim() || keyOf(i) })), colBids: Object.fromEntries(defs.map((d, i) => [keyOf(i), { qty: d.qty, price: d.price }])) as Record<string, Trio>, prelim: pct(hr.prelim), vat: pct(hr.vat) };
}

// Xuất lại file gốc: ghi KL / đơn giá DUYỆT vào khối "ĐƠN GIÁ DUYỆT (D)", điều khoản DUYỆT, giữ nguyên công thức thành tiền
// Bọc để khi lỗi báo rõ đang ở bước nào (file xuất lỗi trên máy chủ rất khó đoán nguyên nhân)
export async function buildSubWorkbook(p: Parameters<typeof buildSubWorkbookImpl>[0]): Promise<Buffer> {
  const st = { s: "đọc file gốc" };
  try {
    return await buildSubWorkbookImpl(p, st);
  } catch (e) {
    const err = e as Error;
    console.error("[excel thầu phụ] lỗi ở bước:", st.s, err.stack);
    throw new Error(`${err.message} (bước: ${st.s})`);
  }
}
async function buildSubWorkbookImpl(p: {
  fileData: Uint8Array | null;
  sheetName: string;
  colMap: string;
  headRows: string;
  terms: string;
  lines: {
    sourceRow: number; level: string; stt: string; content: string; unit: string; qty: number | null; price: number | null; note: string;
    // các ô QSĐT / QSTT đã sửa trên phần mềm (khối CĐT, cơ sở, từng thầu phụ) — ghi đè vào file khi khác với file gốc
    edit?: { hdQty?: number | null; hdPrice?: number | null; cdtHdQty?: number | null; cdtHdPrice?: number | null; baseHdQty?: number | null; baseHdPrice?: number | null; workName: string; code: string; origin?: string; cdtQty: number | null; cdtPrice: number | null; baseQty: number | null; basePrice: number | null; baseManual: boolean; bids: Record<string, Bid> };
  }[];
  extras?: ExtraRow[]; // dòng chi phí thêm dưới TỔNG CỘNG
  status: string;
  notes: string[];
}, st: { s: string }): Promise<Buffer> {
  if (!p.fileData) throw new Error("Hồ sơ không còn file gốc");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(p.fileData.buffer.slice(p.fileData.byteOffset, p.fileData.byteOffset + p.fileData.byteLength) as ArrayBuffer);
  for (const w of [...wb.worksheets]) if (w.name !== p.sheetName) wb.removeWorksheet(w.id);
  const ws = wb.getWorksheet(p.sheetName);
  if (!ws) throw new Error("Không thấy sheet trong file gốc");
  st.s = "đọc cột / dòng tiêu đề";
  const m = JSON.parse(p.colMap) as SubColMap;
  const hr = JSON.parse(p.headRows) as Record<string, number>;
  // dòng thêm / xoá trên phần mềm: chèn dòng mới đúng chỗ, dòng đã xoá thì xoá số + ẩn (src/lib/excel-rows.ts)
  st.s = "nhận diện dòng công việc trong file gốc";
  // đọc lại sheet gốc theo ĐÚNG cột đã lưu khi nhập (bảng chọn cột); nếu lỗi thì tự đoán; vẫn lỗi thì bỏ qua (dòng đã xoá sẽ không bị ẩn) chứ không làm hỏng cả file xuất
  const parseOrig = (): SubParsed | null => {
    try {
      if (hr.header && m.content) return parseSheet(ws, { hr: hr.header, first: hr.first ?? hr.header + 2, colMap: m, bidders: Object.keys(m.bids ?? {}).map((k) => ({ key: k, name: k })) });
    } catch {}
    try {
      return parseSheet(ws);
    } catch {
      return null;
    }
  };
  const origItemRows = (parseOrig()?.lines ?? []).filter((l) => l.level === "ITEM").map((l) => l.sourceRow);
  const clearCols = [m.cdt.qty, m.cdt.price, m.base.qty, m.base.price, m.prop.qty, m.prop.price, ...Object.values(m.bids).flatMap((t) => [t.qty, t.price])];
  st.s = "thêm / xoá dòng";
  const lines = applyRowEdits(ws, p.lines, { origItemRows, clearCols, hr, hrKeys: ["total", "prelim", "vat", "terms"] });
  const put = (r: number, c: number | undefined, v: ExcelJS.CellValue) => {
    if (!c || !r) return;
    const cell = ws.getRow(r).getCell(c);
    if (cell.formula) return;
    cell.value = v;
  };
  for (const l of lines) {
    if (l.level !== "ITEM") continue;
    if (l.isNew) {
      put(l.sourceRow, m.stt, l.stt);
      put(l.sourceRow, m.content, l.content);
      put(l.sourceRow, m.unit, l.unit);
    }
    put(l.sourceRow, m.prop.qty, l.qty);
    put(l.sourceRow, m.prop.price, l.price);
    if (l.note) put(l.sourceRow, m.note, l.note);
  }
  // ---- ô đã sửa trên phần mềm: chỉ ghi khi KHÁC với file gốc (ô công thức giữ nguyên) ----
  // cột KL / đơn giá của khối ĐỀ XUẤT (giá duyệt) được ưu tiên: file hay dùng chung 1 cột KL cho nhiều khối → không để giá trị CĐT / cơ sở ghi đè giá duyệt
  const protectedCols = new Set<number | undefined>([m.prop.qty, m.prop.price]);
  const putNum = (r: number, c: number | undefined, v: number | null) => {
    if (!c || !r || v == null || protectedCols.has(c)) return;
    const cell = ws.getRow(r).getCell(c);
    if (cell.formula || (typeof cell.value === "number" && Math.abs(cell.value - v) < 1e-9)) return;
    cell.value = v;
  };
  const putText = (r: number, c: number | undefined, v: string) => {
    if (!c || !r || !v.trim()) return;
    const cell = ws.getRow(r).getCell(c);
    if (cell.formula || text(cell).trim() === v.trim()) return;
    cell.value = v;
  };
  for (const l of lines) {
    putText(l.sourceRow, m.stt, l.stt);
    putText(l.sourceRow, m.content, l.content);
    if (l.level !== "ITEM" || !l.edit) {
      if (l.edit) putText(l.sourceRow, m.workName, l.edit.workName);
      continue;
    }
    putText(l.sourceRow, m.unit, l.unit);
    putText(l.sourceRow, m.workName, l.edit.workName);
    putText(l.sourceRow, m.code, l.edit.code);
    if (l.edit.origin !== undefined) putText(l.sourceRow, m.origin, l.edit.origin);
    // PLHĐ điều chỉnh: cột theo hợp đồng của khối CĐT, cơ sở trước; khối đề xuất (hdQty / hdPrice) ghi SAU CÙNG để thắng khi dùng chung cột
    putNum(l.sourceRow, m.cdtHd?.qty, l.edit.cdtHdQty ?? null);
    putNum(l.sourceRow, m.cdtHd?.price, l.edit.cdtHdPrice ?? null);
    putNum(l.sourceRow, m.baseHd?.qty, l.edit.baseHdQty ?? null);
    putNum(l.sourceRow, m.baseHd?.price, l.edit.baseHdPrice ?? null);
    putNum(l.sourceRow, m.hd?.qty, l.edit.hdQty ?? null);
    putNum(l.sourceRow, m.hd?.price, l.edit.hdPrice ?? null);
    putNum(l.sourceRow, m.cdt.qty, l.edit.cdtQty);
    putNum(l.sourceRow, m.cdt.price, l.edit.cdtPrice);
    putNum(l.sourceRow, m.base.qty, l.edit.baseQty);
    if (l.edit.baseManual) putNum(l.sourceRow, m.base.price, l.edit.basePrice); // giá cơ sở chỉ ghi khi người dùng tự nhập (không thì giữ giá trong file)
    for (const [k, t] of Object.entries(m.bids)) {
      putNum(l.sourceRow, t.qty, l.edit.bids[k]?.qty ?? null);
      putNum(l.sourceRow, t.price, l.edit.bids[k]?.price ?? null);
    }
  }
  // ---- dòng chi phí thêm dưới TỔNG CỘNG: chèn dòng ngay dưới, cộng vào dòng "TỔNG CỘNG TRƯỚC VAT" ----
  st.s = "dòng chi phí thêm";
  const extras = (p.extras ?? []).filter((x) => x.label.trim() || Object.values(x.vals).some((v) => v));
  const amountCols: [string, number | undefined][] = [["A", m.cdt.amount], ["B", m.base.amount], ...Object.entries(m.bids).map(([k, t]) => [k, t.amount] as [string, number | undefined]), ["D", m.prop.amount], ["D", m.plAmount]]; // PLHĐ điều chỉnh: dòng chi phí thêm cũng cộng vào cột thành tiền phụ lục
  let extrasDone = false;
  if (extras.length && hr.total) {
    const at = hr.total + 1;
    const n = extras.length;
    insertRowsAt(ws, at, n);
    for (const k of ["prelim", "vat", "terms"]) if (hr[k] && hr[k] >= at) hr[k] += n; // các dòng bên dưới dời xuống
    const tpl = ws.getRow(hr.total);
    extras.forEach((x, i) => {
      const row = ws.getRow(at + i);
      if (tpl.height) row.height = tpl.height;
      tpl.eachCell({ includeEmpty: true }, (cell, col) => {
        row.getCell(col).style = { ...cell.style, font: { ...(cell.style.font ?? {}), bold: false } };
      });
      if (m.stt && x.stt.trim()) row.getCell(m.stt).value = x.stt;
      if (m.content) row.getCell(m.content).value = x.label;
      for (const [k, c] of amountCols) if (c && x.vals[k] != null) row.getCell(c).value = x.vals[k];
    });
    // dòng "TỔNG CỘNG TRƯỚC VAT" (nằm dưới dòng Prelim): cộng thêm tổng các dòng vừa chèn ở từng cột thành tiền
    let before = 0;
    for (let r = at + n; r <= Math.min(ws.rowCount, at + n + 12) && !before; r++) {
      ws.getRow(r).eachCell((cell) => {
        if (!before && norm(text(cell)).includes("TRUOC VAT")) before = r;
      });
    }
    if (before) {
      for (const [, c] of amountCols) {
        if (!c) continue;
        const cell = ws.getRow(before).getCell(c);
        const colL = ws.getColumn(c).letter;
        const rng = `SUBTOTAL(9,${colL}${at}:${colL}${at + n - 1})`;
        if (cell.formula) cell.value = { formula: `${cell.formula}+${rng}` } as ExcelJS.CellFormulaValue;
        else if (typeof cell.value === "number") cell.value = cell.value + extras.reduce((t, x) => t + (Number(x.vals[amountCols.find(([, cc]) => cc === c)![0]]) || 0), 0);
      }
      extrasDone = true;
    } else if (hr.total) {
      // file không có dòng TRƯỚC VAT (VD chỉ có TỔNG CỘNG → VAT → SAU THUẾ): cộng thêm vào chính dòng TỔNG CỘNG để VAT / tổng sau thuế tính theo
      for (const [, c] of amountCols) {
        if (!c) continue;
        const cell = ws.getRow(hr.total).getCell(c);
        const colL = ws.getColumn(c).letter;
        if (cell.formula) cell.value = { formula: `${cell.formula}+SUBTOTAL(9,${colL}${at}:${colL}${at + n - 1})` } as ExcelJS.CellFormulaValue;
      }
      extrasDone = true;
    }
  }
  if (extras.length && !extrasDone) {
    // file không có dòng TỔNG CỘNG / TRƯỚC VAT để chèn → ghi ở phần ghi chú cuối bảng
    p.notes = [...p.notes, "Chi phí thêm (chưa cộng vào tổng trong file):", ...extras.map((x) => `   - ${x.stt ? `${x.stt} ` : ""}${x.label}: ${Math.round(Number(x.vals.D) || 0).toLocaleString("vi-VN")} đ`)];
  }
  st.s = "điều khoản duyệt";
  // điều khoản DUYỆT
  const terms = JSON.parse(p.terms) as Term[];
  if (hr.terms) {
    let r = hr.terms + 1;
    const termCol = (() => {
      let c: number | undefined;
      ws.getRow(hr.terms).eachCell((cell, col) => {
        if (norm(text(cell)).includes("DUYET")) c ??= col;
      });
      return c;
    })();
    for (const t of terms) put(r++, termCol, t.appr);
  }
  st.s = "ghi chú cuối bảng";
  wb.calcProperties.fullCalcOnLoad = true;
  if (p.notes.length && hr.total) {
    const r = ws.rowCount + 2;
    p.notes.forEach((n, i) => (ws.getRow(r + i).getCell(1).value = n));
  }
  st.s = "ghi file";
  // ExcelJS đôi khi không ghi được vì phần phụ lạ trong file gốc (tên vùng, hình, định dạng có điều kiện, kiểm tra dữ liệu, ô gộp, lọc).
  // Thử ghi bình thường; lỗi thì lần lượt bỏ từng phần phụ (không ảnh hưởng số liệu) rồi ghi lại.
  const wsx = ws as unknown as Record<string, unknown>;
  const wbx = wb as unknown as { definedNames?: { model: unknown } };
  const relax: [string, () => void][] = [
    ["tên vùng", () => { if (wbx.definedNames) wbx.definedNames.model = []; }],
    ["hình ảnh", () => { wsx._media = []; }],
    ["định dạng có điều kiện + kiểm tra dữ liệu", () => { wsx.conditionalFormattings = []; const dv = wsx.dataValidations as { model: unknown } | undefined; if (dv) dv.model = {}; }],
    ["ô gộp + bộ lọc", () => { for (const k of Object.keys((wsx._merges as Record<string, unknown>) ?? {})) { try { ws.unMergeCells(k); } catch {} } wsx.autoFilter = undefined; }],
  ];
  let firstErr: Error | null = null;
  for (let i = 0; i <= relax.length; i++) {
    if (i > 0) {
      try { relax[i - 1][1](); } catch {}
    }
    try {
      const out = await fixXlsx(await wb.xlsx.writeBuffer());
      if (i > 0) console.warn("[excel thầu phụ] ghi được sau khi bỏ:", relax.slice(0, i).map((x) => x[0]).join(", "));
      return out;
    } catch (e) {
      firstErr ??= e as Error;
    }
  }
  const frames = (firstErr?.stack ?? "").split("\n").filter((l) => /exceljs|xform/i.test(l)).slice(0, 4).map((l) => l.trim()).join(" <- ");
  throw new Error(`${firstErr?.message ?? "lỗi ghi file"}${frames ? ` [${frames}]` : ""}`);
}
