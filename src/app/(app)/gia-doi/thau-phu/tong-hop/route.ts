import ExcelJS from "exceljs";
import { fixXlsx } from "@/lib/excel-fix";
import { applyStandardStyle } from "@/lib/excel-style";
import { prisma } from "@/lib/prisma";
import { canExportSub, getPriceUser, subAreaWhere } from "@/lib/gia-doi";
import { parseJson, type Bidder } from "@/lib/thau-phu-calc";
import { proposalTotals, subChain, subRefs, type SubRef } from "@/lib/thau-phu";
import { loadContractInfo } from "@/lib/project-site";
import { contractKey, tidyText } from "@/lib/project-site-calc";

// XUẤT FILE TỔNG HỢP ĐỀ XUẤT THẦU PHỤ theo TUẦN / THÁNG / NĂM / KHOẢNG NGÀY — theo FORM CHUẨN anh sửa tay 25/11/2026 ("0.DE XUAT THAU PHU 25.11.2026.xlsx").
// Chỉ hồ sơ ĐÃ DUYỆT. Gom theo KHU VỰC (I, II...; khu vực không có gói trong đợt thì bỏ), cuối bảng có TỔNG CỘNG.
// Trong khu vực: xếp theo GIÁ TRỊ GÓI THẦU từ cao xuống thấp (dự án → hợp đồng → gói; tên công trình / hợp đồng gộp ô theo dự án / hợp đồng).
// Mỗi gói = 1 nhóm dòng (cùng STT, gộp ô A, D, E, G, J, K, L, M, N, O):
//   - HĐ thầu phụ:  dòng "HĐTP" (+ dòng "VT + TB" nếu có vật tư / thiết bị).
//   - PHỤ LỤC:       "Ký PL" (giá trị phụ lục lần này) · "HĐ + PL đã ký" (trước phụ lục này) · "PLĐC" (= 2 dòng trên) (+ "VT + TB").
// Cột: (0) STT | (1) Tên công trình | (2) HĐ ký CĐT "HĐ số … - nội dung" | (3) Hạng mục | (4) Thầu phụ (tên ngắn) | Đề xuất HĐHP/PL |
//      (5) Giá trị ký với CĐT | (6) Giá trị DT-CP (= giá trị CƠ SỞ) | (7) Giá trị thầu phụ đề xuất | (8) = (5) − HĐTP/PLĐC − VT+TB | (9) = (8)/(5) |
//      (10) Thầu phụ BCH/P.ĐT-TT đề xuất (= E) | (11) Giá trị đề xuất (= I dòng đầu: HĐTP hoặc phụ lục lần này) | (12) Người duyệt | (13) Ghi chú.
// Tham số: ky=week|month|year|range, v=2026-W45 | 2026-11 | 2026, from/to (range), theo=trinh|duyet (mặc định duyệt), kv=khu vực, pj=dự án, ct=hợp đồng.
// Quyền: quản trị hoặc tài khoản được tick "Xuất file tổng hợp đệ trình thầu phụ" (EXPORT) ở Người dùng → Sửa quyền.

const DAY = 86400000;
const VN = 7 * 3600000; // giờ Việt Nam UTC+7

function periodOf(ky: string, v: string, from?: string, to?: string): { from: Date; to: Date } | null {
  if (ky === "range") {
    // khoảng ngày do người dùng chỉ định (tính cả ngày đầu và ngày cuối)
    const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from ?? "");
    const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to ?? "");
    if (!a || !b) return null;
    const f = new Date(Date.UTC(+a[1], +a[2] - 1, +a[3]) - VN);
    const t = new Date(Date.UTC(+b[1], +b[2] - 1, +b[3]) + DAY - VN);
    if (t <= f) return null;
    return { from: f, to: t };
  }
  if (ky === "week") {
    const m = /^(\d{4})-W(\d{1,2})$/.exec(v);
    if (!m) return null;
    const y = Number(m[1]);
    const w = Number(m[2]);
    const jan4 = Date.UTC(y, 0, 4);
    const monday1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY;
    const start = monday1 + (w - 1) * 7 * DAY;
    return { from: new Date(start - VN), to: new Date(start + 7 * DAY - VN) };
  }
  if (ky === "year") {
    const m = /^(\d{4})$/.exec(v);
    if (!m) return null;
    const y = Number(m[1]);
    return { from: new Date(Date.UTC(y, 0, 1) - VN), to: new Date(Date.UTC(y + 1, 0, 1) - VN) };
  }
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return { from: new Date(Date.UTC(y, mo, 1) - VN), to: new Date(Date.UTC(y, mo + 1, 1) - VN) };
}

// TÊN NGẮN THẦU PHỤ: bỏ loại hình công ty / ngành nghề ở đầu, bỏ người liên hệ / SĐT ở cuối; chữ HOA TOÀN BỘ → hoa chữ đầu
// ("CÔNG TY CỔ PHẦN XÂY DỰNG KHẢI TOÀN -Mr Vương SĐT : 097…" → "Khải Toàn", "THẦU PHỤ 4D&T" → "4D&T", "NGỌC TRƯỜNG KỲ" → "Ngọc Trường Kỳ")
const SUB_PREFIX = [
  "doanh nghiệp tư nhân", "hộ kinh doanh", "một thành viên", "công ty", "cty", "cổ phần", "tnhh", "mtv", "dntn", "tập đoàn", "xây dựng", "xây lắp", "thương mại",
  "dịch vụ", "đầu tư", "kỹ thuật", "kĩ thuật", "sản xuất", "tư vấn", "thiết kế", "cơ điện", "thầu phụ", "nhà thầu", "và", "&", "cp", "xd", "tm", "dv", "tp",
].sort((a, b) => b.length - a.length);
const hasMark = (w: string) => /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(w);
function shortSub(name: string): string {
  const full = (name || "").replace(/\s+/g, " ").trim();
  let s = full
    .replace(/[\s\-–,;:(]+(mr|mrs|ms|sđt|sdt|đt|dt|tel|hotline|phone)(?=[\s.:]|$).*$/i, "")
    .replace(/\s*[-–,;:]?\s*\(?\+?\d[\d .]{7,}\)?\s*$/, "")
    .replace(/[\s,;:–-]+$/, "")
    .trim();
  for (let again = true; again; ) {
    again = false;
    const low = s.toLowerCase();
    for (const p of SUB_PREFIX)
      if (low.startsWith(p + " ")) {
        s = s.slice(p.length).trim();
        again = true;
        break;
      }
  }
  if (!s) s = full;
  if (/\p{Ll}/u.test(s)) return s; // đã viết thường / hoa chữ đầu → giữ nguyên
  return s
    .split(" ")
    .map((w) => (/\d|&/.test(w) || (w.length <= 3 && !hasMark(w)) ? w : w[0] + w.slice(1).toLowerCase()))
    .join(" ");
}
// HẠNG MỤC: viết thường kiểu câu (giữ hoa mã / tên riêng), bỏ hậu tố "(Toà …)" vì hợp đồng đã ghi rõ toà
const itemText = (s: string) => tidyText(s).replace(/\s*\((toà|tòa|tháp|block)(?=\s)[^)]*\)\s*$/iu, "").trim();

// 1 gói = 1 nhóm dòng
type Group = {
  area: string;
  project: string;
  contract: string; // "HĐ số … - nội dung"
  item: string;
  sub: string;
  approver: string;
  kind: "HDTP" | "PL" | "";
  cdt: number; // (5)
  base: number; // (6) giá trị cơ sở
  first: { value: number; approved: number }; // dòng đầu: HĐTP hoặc "Ký PL" (phụ lục lần này)
  pl: { signed: number; after: number } | null; // phụ lục: HĐ + PL đã ký, PLĐC
  vtb: number; // VT + TB (+ chi phí khác)
  size: number; // giá trị gói để sắp xếp (HĐTP / PLĐC)
};

export async function GET(req: Request) {
  const u = await getPriceUser();
  if (!u || !canExportSub(u)) return new Response("Không có quyền xuất file tổng hợp đệ trình thầu phụ", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const ky = sp.get("ky") === "week" ? "week" : sp.get("ky") === "year" ? "year" : sp.get("ky") === "range" ? "range" : "month";
  const p = periodOf(ky, sp.get("v") ?? "", sp.get("from") ?? "", sp.get("to") ?? "");
  if (!p) return new Response("Chọn tuần / tháng / năm / khoảng ngày cần xuất", { status: 400 });
  const byTrinh = sp.get("theo") === "trinh";
  const kv = sp.get("kv") ?? "";
  if (kv && u.areas && !u.areas.includes(kv)) return new Response("Khu vực ngoài phạm vi làm việc của bạn", { status: 403 });
  const pj = (sp.get("pj") ?? "").trim().toLowerCase(); // lọc theo dự án
  const ct = sp.get("ct") ?? ""; // lọc theo hợp đồng: "c:<id>" (hợp đồng trên phần mềm) hoặc "t:<số HĐ gõ tay>"
  const ctWhere = ct.startsWith("c:") ? { contractId: ct.slice(2) } : ct.startsWith("t:") ? { contractId: null, cdtContract: ct.slice(2) } : {};

  const range = { gte: p.from, lt: p.to };
  // CHỈ lấy hồ sơ ĐÃ DUYỆT
  const propsAll = await prisma.subProposal.findMany({
    where: {
      AND: [
        subAreaWhere(u),
        { status: "APPROVED" },
        byTrinh ? { submittedAt: range } : { OR: [{ tpAt: range }, { ptgAt: range }] },
        kv ? { OR: [{ area: kv }, { contract: { area: kv } }] } : {},
        ctWhere,
      ],
    },
    select: {
      id: true, code: true, status: true, area: true, projectName: true, cdtContract: true, itemName: true, bidders: true, selectedBidder: true, subName: true, prelim: true, vat: true, extraRows: true, vatRows: true, totalAmounts: true,
      proposalType: true, plKind: true, hdtpId: true, vtValue: true, tbValue: true, otherValue: true, signedValue: true, branch: true, tpByName: true, tpAt: true, ptgByName: true, ptgAt: true, submittedAt: true, contractId: true,
      contract: { select: { area: true, name: true } },
      lines: { orderBy: { orderIndex: "asc" }, select: { level: true, noMgmt: true, lineKey: true, baseManual: true, cdtQty: true, cdtPrice: true, baseQty: true, basePrice: true, bids: true, propQty: true, propPrice: true, tpPrice: true, tpOk: true, hdQty: true, hdPrice: true } },
    },
  });
  const props = pj ? propsAll.filter((s) => ((s.contract?.name || s.projectName || "").trim() || "(chưa có tên dự án)").toLowerCase() === pj) : propsAll;
  const ctInfo = await loadContractInfo(); // nội dung hợp đồng theo BẢNG TT DỰ ÁN (tra bằng số HĐ)

  const refsOf = new Map<string, Map<string, SubRef>>(); // giá cơ sở từng hợp đồng (DT-CP đã khớp) — mỗi hợp đồng đọc 1 lần
  const groups: Group[] = [];
  for (const s of props) {
    // thời điểm quyết định: nhánh A = ngày Trưởng phòng duyệt; nhánh B = ngày Phó Tổng duyệt
    const decidedAt = s.branch === "A" ? s.tpAt : (s.ptgAt ?? s.tpAt);
    if (!byTrinh && (!decidedAt || decidedAt < p.from || decidedAt >= p.to)) continue;
    let refs = s.contractId ? refsOf.get(s.contractId) : undefined;
    if (s.contractId && !refs) {
      refs = new Map((await subRefs(s.contractId)).map((r) => [r.key, r]));
      refsOf.set(s.contractId, refs);
    }
    const t = proposalTotals(s, s.lines, refs ?? new Map());
    const bidders = parseJson<Bidder[]>(s.bidders, []);
    const chosen = bidders.find((b) => b.key === s.selectedBidder)?.name || s.subName;
    const isPl = s.proposalType === "PL";
    const adj = isPl && s.plKind === "DIEU_CHINH";
    // giá trị hồ sơ: PLHĐ điều chỉnh = điều chỉnh − hợp đồng (cột Phụ lục); PL cộng gộp / HĐTP = cả giá trị hồ sơ (giống màn hình)
    const hd = adj ? t.H.afterVat : 0;
    const first = { value: Math.round(t.D.afterVat - hd), approved: Math.round(t.R.afterVat - hd) };
    let pl: Group["pl"] = null;
    if (isPl) {
      // HĐ + PL đã ký: chọn HĐTP trên hệ thống → HĐ gốc + các PL đã duyệt trước; PL điều chỉnh → cột Hợp đồng; PL cộng gộp HĐ gõ tay → ô QSĐT nhập
      const chain = await subChain(s);
      const signed = Math.round(chain ? chain.rootValue + chain.priors.reduce((x, y) => x + y.value, 0) : adj ? hd : (s.signedValue ?? 0));
      pl = { signed, after: signed + first.value };
    }
    const no = s.cdtContract.trim();
    const title = ctInfo.get(contractKey(no))?.title ?? "";
    groups.push({
      area: s.contract?.area || s.area || "",
      project: s.projectName || "(chưa có tên công trình)",
      contract: no ? `HĐ số ${no}${title ? ` - ${title}` : ""}` : "",
      item: itemText(s.itemName),
      sub: shortSub(chosen),
      approver: (s.branch === "B" ? s.ptgByName || s.tpByName : s.tpByName) || "",
      kind: s.proposalType === "HDTP" ? "HDTP" : isPl ? "PL" : "",
      cdt: Math.round(t.A.afterVat),
      base: Math.round(t.B.afterVat),
      first,
      pl,
      vtb: Math.round((s.vtValue ?? 0) + (s.tbValue ?? 0) + (s.otherValue ?? 0)),
      size: pl ? pl.after : first.value,
    });
  }

  const vnNow = new Date(Date.now() + VN); // ngày lập báo cáo (giờ Việt Nam), dạng dd/mm/yyyy
  const today = `${String(vnNow.getUTCDate()).padStart(2, "0")}/${String(vnNow.getUTCMonth() + 1).padStart(2, "0")}/${vnNow.getUTCFullYear()}`;
  const wb = new ExcelJS.Workbook();
  writeSheet(wb, today, groups);
  applyStandardStyle(wb); // Times New Roman, canh giữa dọc
  const buf = await fixXlsx(await wb.xlsx.writeBuffer());
  const tag = ky === "week" ? (sp.get("v") ?? "") : ky === "year" ? `Nam ${sp.get("v")}` : ky === "range" ? `${sp.get("from")} den ${sp.get("to")}` : `Thang ${sp.get("v")}`;
  const name = `De xuat thau phu - ${tag}${kv ? ` - KV${kv}` : ""}.xlsx`.replace(/[\\/:*?"<>|]/g, "-");
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}

const N_COLS = 15; // A..O
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const HEADERS = [
  "STT", "TÊN CÔNG TRÌNH", "HỢP ĐỒNG KÝ CĐT", "HẠNG MỤC TRÌNH ĐƠN GIÁ", "THẦU PHỤ THAM GIA BÁO GIÁ", "ĐỀ XUẤT HĐHP/PL",
  "GIÁ TRỊ KÝ VỚI CĐT", "GIÁ TRỊ DTCP", "GIÁ TRỊ THẦU PHỤ ĐỀ XUẤT", "CHÊNH LỆCH CĐT VÀ THẦU PHỤ", "% CHÊNH LỆCH",
  "THẦU PHỤ BCH/P.ĐT-TT ĐỀ XUẤT", "GIÁ TRỊ ĐỀ XUẤT", "NGƯỜI DUYỆT (A)", "Ghi chú",
];
const NUMBERING = ["(0)", "(1)", "(2)", "(3)", "(4)", "", "(5)", "(6)", "(7)", "(8) = (5)-(7)", "(9) = (8)/(5)", "(10)", "(11)", "(12)", "(13)"];
const WIDTHS = [6.25, 25.875, 42.5, 30.625, 17.25, 12.5, 16.875, 17.25, 17.25, 15.5, 13.75, 17.875, 17.75, 15, 10];
const NF = '_(* #,##0_);_(* (#,##0);_(* "-"_);_(@_)';
const NAVY = "FF002060";
const YELLOW = "FFFFFF00";
const ROW_H = 39.95;
type Side = ExcelJS.Border["style"];

function writeSheet(wb: ExcelJS.Workbook, today: string, all: Group[]) {
  const ws = wb.addWorksheet(today.replace(/\//g, "."), {
    views: [{ state: "frozen", xSplit: 0, ySplit: 11, topLeftCell: "A12", zoomScale: 70, zoomScaleNormal: 70, style: "pageBreakPreview" }],
  });
  WIDTHS.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const font = (size = 12, extra: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: "Times New Roman", size, ...extra });
  const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
  const box = (top: Side = "thin", bottom: Side = "thin"): Partial<ExcelJS.Borders> => ({ top: { style: top }, bottom: { style: bottom }, left: { style: "thin" }, right: { style: "thin" } });

  // ---- đầu trang: thông tin công ty (dòng 1-5 gom nhóm thu gọn được), tiêu đề, ngày ----
  const line = (r: number, text: string, f: Partial<ExcelJS.Font>, h?: number) => {
    ws.mergeCells(r, 1, r, N_COLS);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = f;
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    if (h) ws.getRow(r).height = h;
  };
  line(1, "CÔNG TY CỔ PHẦN XÂY DỰNG KIẾN TRÚC TÂN MINH NHÂN", font(12, { bold: true }), 22.15);
  line(2, "Trụ sở chính: Tổ 3, khối Ngân Giang, Phường Điện Bàn Đông, TP Đà Nẵng", font(11));
  line(3, "VPĐD: 248-250 Lê Văn Hiến, Phường Khuê Mỹ, Quận Ngũ Hành Sơn, TP. Đà Nẵng", font(11));
  line(4, "Tell/Hotline: (0236) 3958 718; Email: contact@tanminhnhan.com.vn;", font(11));
  line(5, "Web: tanminhnhan.com.vn", font(11));
  for (let c = 1; c <= N_COLS; c++) ws.getCell(5, c).border = { bottom: { style: "thin" } };
  for (let r = 1; r <= 5; r++) ws.getRow(r).outlineLevel = 1;
  ws.getRow(6).height = 9;
  line(7, "BẢNG ĐỀ XUẤT ĐƠN GIÁ THẦU PHỤ", font(20, { bold: true }), 34.9);
  line(8, `Ngày ${today}`, font(15, { bold: true, italic: true }), 29.45);
  ws.getRow(9).height = 10.5;

  // ---- tiêu đề cột + dòng đánh số: nền xanh đậm, chữ trắng đậm ----
  const H = 10;
  HEADERS.forEach((t, i) => (ws.getCell(H, i + 1).value = t));
  NUMBERING.forEach((t, i) => (ws.getCell(H + 1, i + 1).value = t));
  for (const r of [H, H + 1])
    for (let c = 1; c <= N_COLS; c++) {
      const cell = ws.getCell(r, c);
      cell.font = font(12, { bold: true, color: { argb: "FFFFFFFF" } });
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.fill = fill(NAVY);
      cell.border = box();
    }
  ws.getRow(H).height = 54.75;
  ws.getRow(H + 1).height = 22.5;

  const money = (cell: ExcelJS.Cell, v: number | null | undefined) => {
    if (v != null && v !== 0) cell.value = v;
    cell.numFmt = NF;
  };
  const formula = (cell: ExcelJS.Cell, f: string, result: number | string) => {
    cell.value = { formula: f, result };
    if (typeof result === "number") cell.numFmt = NF;
  };
  const merge = (r0: number, r1: number, c: number) => {
    if (r1 > r0) ws.mergeCells(r0, c, r1, c);
  };

  // khu vực: chỉ khu vực có gói trong đợt; số La Mã theo số khu vực (KV3 → III)
  const byArea = new Map<string, Group[]>();
  for (const g of all) byArea.set(g.area, [...(byArea.get(g.area) ?? []), g]);
  const areas = [...byArea.keys()].sort((a, b) => (Number(a) || 99) - (Number(b) || 99) || a.localeCompare(b));
  let r = H + 2;
  const first = r;
  const areaRows: number[] = [];
  const tot = { g: 0, h: 0, i: 0, m: 0 };

  areas.forEach((area, ai) => {
    // xếp theo GIÁ TRỊ GÓI THẦU cao → thấp: dự án (tổng các gói) → hợp đồng (tổng) → gói
    const list = byArea.get(area) ?? [];
    const sumBy = (key: (g: Group) => string) => {
      const m = new Map<string, number>();
      for (const g of list) m.set(key(g), (m.get(key(g)) ?? 0) + g.size);
      return m;
    };
    const pjSum = sumBy((g) => g.project);
    const ctSum = sumBy((g) => `${g.project}|${g.contract}`);
    list.sort((x, y) => (pjSum.get(y.project) ?? 0) - (pjSum.get(x.project) ?? 0) || x.project.localeCompare(y.project) || (ctSum.get(`${y.project}|${y.contract}`) ?? 0) - (ctSum.get(`${x.project}|${x.contract}`) ?? 0) || x.contract.localeCompare(y.contract) || y.size - x.size);

    const head = r++;
    areaRows.push(head);
    const a = head + 1;
    const iRows: number[] = []; // dòng cộng vào cột (7): HĐTP / PLĐC / VT + TB (không cộng "Ký PL", "HĐ + PL đã ký" để khỏi đếm đôi)
    const sum = { g: 0, h: 0, i: 0, m: 0 };
    const spans: { b: [number, number][]; c: [number, number][] } = { b: [], c: [] }; // dải dòng cùng dự án / cùng hợp đồng để gộp ô B, C

    list.forEach((x, idx) => {
      const r0 = r;
      const rows: { label: string; i: number | { f: string; v: number } | null; h?: number }[] = [];
      if (x.pl) {
        rows.push({ label: "Ký PL", i: x.first.value });
        rows.push({ label: "HĐ + PL đã ký", i: x.pl.signed });
        rows.push({ label: "PLĐC", i: { f: `+I${r0}+I${r0 + 1}`, v: x.pl.after } });
      } else rows.push({ label: x.kind === "HDTP" ? "HĐTP" : "", i: x.first.value });
      const rMain = r0 + rows.length - 1; // HĐTP hoặc PLĐC
      if (x.vtb) rows.push({ label: "VT + TB", i: x.vtb, h: x.vtb });
      const rVt = x.vtb ? r0 + rows.length - 1 : null;
      const last = r0 + rows.length - 1;

      rows.forEach((row, k) => {
        const rr = r0 + k;
        ws.getCell(rr, 6).value = row.label;
        const ci = ws.getCell(rr, 9);
        if (row.i != null && typeof row.i === "object") formula(ci, row.i.f, row.i.v);
        else money(ci, row.i);
        if (row.h != null) money(ws.getCell(rr, 8), row.h);
        ws.getRow(rr).height = ROW_H;
        for (let c = 1; c <= N_COLS; c++) {
          const cell = ws.getCell(rr, c);
          cell.font = c === 2 ? font(12, { bold: true, color: { argb: "FF0000FF" } }) : font(12);
          cell.alignment = { horizontal: [2, 3, 4].includes(c) ? "left" : "center", vertical: "middle", wrapText: true };
          cell.border = box(k === 0 ? "thin" : "dotted", rr === last ? "thin" : "dotted");
          if ([7, 8, 9, 10, 13].includes(c)) cell.numFmt = NF;
        }
      });
      r = last + 1;

      // thông tin gói ở dòng đầu (gộp ô theo nhóm)
      ws.getCell(r0, 1).value = idx + 1;
      ws.getCell(r0, 2).value = x.project;
      ws.getCell(r0, 3).value = x.contract;
      ws.getCell(r0, 4).value = x.item;
      ws.getCell(r0, 5).value = x.sub;
      ws.getCell(r0, 14).value = x.approver;
      money(ws.getCell(r0, 7), x.cdt);
      money(ws.getCell(r0, 8), x.base); // giá trị cơ sở: gộp các dòng HĐTP / phụ lục (dòng VT + TB riêng)
      formula(ws.getCell(r0, 12), `+E${r0}`, x.sub);
      // (11) = (7) dòng đầu; giá duyệt khác giá đề xuất thì ghi số duyệt
      if (x.first.approved === x.first.value) formula(ws.getCell(r0, 13), `+I${r0}`, x.first.value);
      else money(ws.getCell(r0, 13), x.first.approved);
      if (x.cdt) {
        const cost = (x.pl ? x.pl.after : x.first.value) + x.vtb;
        formula(ws.getCell(r0, 10), `+G${r0}-I${rMain}${rVt ? `-I${rVt}` : ""}`, x.cdt - cost);
        ws.getCell(r0, 11).value = { formula: `+J${r0}/G${r0}`, result: (x.cdt - cost) / x.cdt };
        ws.getCell(r0, 11).numFmt = "0%";
      }
      for (const c of [1, 4, 5, 7, 10, 11, 12, 13, 14, 15]) merge(r0, last, c);
      merge(r0, rMain, 8);

      iRows.push(rMain, ...(rVt ? [rVt] : []));
      sum.g += x.cdt;
      sum.h += x.base + x.vtb;
      sum.i += (x.pl ? x.pl.after : x.first.value) + x.vtb;
      sum.m += x.first.approved;
      const prev = list[idx - 1];
      if (prev && prev.project === x.project) spans.b[spans.b.length - 1][1] = last;
      else spans.b.push([r0, last]);
      if (prev && prev.project === x.project && prev.contract === x.contract) spans.c[spans.c.length - 1][1] = last;
      else spans.c.push([r0, last]);
    });
    for (const [s0, s1] of spans.b) merge(s0, s1, 2);
    for (const [s0, s1] of spans.c) merge(s0, s1, 3);

    // dòng KHU VỰC: nền vàng; G, H, M = SUBTOTAL; I = cộng các dòng HĐTP / PLĐC / VT + TB
    const b = r - 1;
    ws.getCell(head, 1).value = ROMAN[(Number(area) || ai + 1) - 1] ?? String(ai + 1);
    ws.getCell(head, 2).value = area ? `KHU VỰC ${area}` : "CHƯA CHỌN KHU VỰC";
    formula(ws.getCell(head, 7), `SUBTOTAL(9,G${a}:G${b})`, sum.g);
    formula(ws.getCell(head, 8), `SUBTOTAL(9,H${a}:H${b})`, sum.h);
    formula(ws.getCell(head, 9), iRows.map((x) => `I${x}`).join("+") || "0", sum.i);
    formula(ws.getCell(head, 13), `SUBTOTAL(9,M${a}:M${b})`, sum.m);
    ws.getRow(head).height = ROW_H;
    for (let c = 1; c <= N_COLS; c++) {
      const cell = ws.getCell(head, c);
      cell.font = font(12, { bold: true });
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.fill = fill(YELLOW);
      cell.border = box();
    }
    tot.g += sum.g;
    tot.h += sum.h;
    tot.i += sum.i;
    tot.m += sum.m;
  });

  if (areas.length === 0) {
    ws.mergeCells(r, 1, r, N_COLS);
    ws.getCell(r, 1).value = "(Không có hồ sơ thầu phụ đã duyệt trong kỳ)";
    ws.getCell(r, 1).font = font(12, { italic: true });
    ws.getCell(r, 1).alignment = { horizontal: "center", vertical: "middle" };
    r++;
  }
  // TỔNG CỘNG: nền xanh đậm chữ trắng; G, H, M = SUBTOTAL toàn bảng (bỏ qua dòng khu vực); I = cộng các dòng khu vực; ô M chữ đỏ nền vàng
  const T = r;
  const last = Math.max(T - 1, first);
  ws.getCell(T, 2).value = "TỔNG CỘNG";
  formula(ws.getCell(T, 7), `SUBTOTAL(9,G${first}:G${last})`, tot.g);
  formula(ws.getCell(T, 8), `SUBTOTAL(9,H${first}:H${last})`, tot.h);
  formula(ws.getCell(T, 9), areaRows.map((x) => `I${x}`).join("+") || "0", tot.i);
  formula(ws.getCell(T, 13), `SUBTOTAL(9,M${first}:M${last})`, tot.m);
  ws.getRow(T).height = 44.25;
  for (let c = 1; c <= N_COLS; c++) {
    const cell = ws.getCell(T, c);
    const red = c === 13;
    cell.font = font(12, { bold: true, color: { argb: red ? "FFFF0000" : "FFFFFFFF" } });
    cell.alignment = { horizontal: red ? "right" : "center", vertical: "middle", wrapText: true };
    cell.fill = fill(red ? YELLOW : NAVY);
    cell.border = box();
  }

  ws.pageSetup = {
    orientation: "landscape",
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    showGridLines: false,
    margins: { left: 0, right: 0, top: 0.2, bottom: 0.39, header: 0.12, footer: 0.12 },
    printArea: `A1:O${T}`,
    printTitlesRow: `${H}:${H + 1}`,
  };
  ws.headerFooter = { oddFooter: "Page &P of &N" };
}
