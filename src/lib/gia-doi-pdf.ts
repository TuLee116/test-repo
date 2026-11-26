import path from "path";
import fs from "fs";
import PDFDocument from "pdfkit";
import { apprAmountOf, approvedPriceOf, categoryLabel, cdtAmountOf, hasFormula, KIND_LABEL, opinionOf, savedTotals, siteAmountOf, sitePriceOf } from "@/lib/gia-doi-calc";

// File PDF hồ sơ đệ trình giá đội kèm kết quả Trưởng phòng duyệt — đính kèm thư Outlook gửi BCH.
// BỐ CỤC GIỐNG HỆT file Excel xuất ra (2 mẫu đệ trình giá đội: trong HĐ / ngoài HĐ): cùng tiêu đề công ty, cùng nhóm cột, cùng màu
// (tiêu đề + TỔNG CỘNG xanh, đầu mục lớn tô nhạt, dòng công việc không tô, chữ đen, đơn giá điều chỉnh chữ đỏ), cùng chân ký tên.
// Khổ A4 ngang; font DejaVu Serif Condensed (đủ dấu tiếng Việt, có sẵn trong node_modules nên chạy được cả trên Railway).

type PdfLine = {
  level: string;
  stt: string;
  content: string;
  unit: string;
  qty: number | null;
  cdtPrice: number | null;
  cdtAmount?: number | null;
  basePrice: number | null;
  baseAmount?: number | null;
  baseNote?: string;
  siteOpinion: string;
  sitePrice: number | null;
  siteNote?: string;
  ptOpinion: string;
  ptPrice: number | null;
  qsNote: string;
  tpPrice: number | null;
  tpOk: boolean;
  tpNote: string;
  // thành tiền / tổng nhóm do QSTT hoặc Trưởng phòng sửa bằng công thức (chỉ có giá trị khi `formulas` có khoá cột đó)
  formulas?: string;
  siteAmount?: number | null;
  tpAmount?: number | null;
};
export type PdfSub = {
  totalAmounts?: string; // TỔNG CỘNG đã lưu (kể cả công thức sửa tay)
  code: string;
  crewName: string;
  revision: number;
  kind: string;
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
  createdByName: string;
  submittedAt: Date | null;
  reviewedByName: string;
  reviewedAt: Date | null;
  lines: PdfLine[];
};

const FONT_DIR = path.join(process.cwd(), "node_modules", "dejavu-fonts-ttf", "ttf");
const fm = (n: number | null | undefined) => (n ? Math.round(n).toLocaleString("vi-VN") : "");
const fq = (n: number | null | undefined) => (n == null ? "" : n.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fd = (d: Date | null) => (d ? d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "");

// màu như file Excel xuất ra
const C_HEAD = "#5B9BD5"; // tiêu đề bảng + dòng TỔNG CỘNG (màu mẫu chuẩn)
const C_GROUP = "#FCE4D6"; // đầu mục lớn A, B...
const C_SUB = "#FFF2CC"; // đầu mục nhỏ I, II...
const RED = "#FF0000";
const C_GREEN = "#1B8A3A"; // đã duyệt
const C_BLUE = "#1F4E79"; // khối BCH công trình / nhãn thông tin

export async function buildPricePdf(sub: PdfSub): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margins: { top: 20, bottom: 20, left: 20, right: 20 }, info: { Title: `Đơn giá đội ${sub.code}` } });
  doc.registerFont("R", path.join(FONT_DIR, "DejaVuSerifCondensed.ttf"));
  doc.registerFont("B", path.join(FONT_DIR, "DejaVuSerifCondensed-Bold.ttf"));
  doc.registerFont("I", path.join(FONT_DIR, "DejaVuSerifCondensed-Italic.ttf"));
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));

  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const isOut = sub.kind === "OUT";

  // ---- tiêu đề công ty (giống đầu file Excel mẫu) ----
  const logo = path.join(process.cwd(), "public", "tmn-logo.png");
  if (fs.existsSync(logo)) doc.image(logo, L, 20, { height: 44 });
  doc.font("B").fontSize(11).text("CÔNG TY CỔ PHẦN XÂY DỰNG KIẾN TRÚC TÂN MINH NHÂN", L, 22, { width: W, align: "center" });
  doc.font("R").fontSize(8);
  [
    "Trụ sở chính: Tổ 3, Khối Ngân Giang, Phường Điện Ngọc, Thị xã Điện Bàn",
    "VPĐD: 248-250 Lê Văn Hiến, Phường Khuê Mỹ, Quận Ngũ Hành Sơn, TP. Đà Nẵng",
    "Tell/Hotline: (0236) 3958 718; Email: contact@tanminhnhan.com.vn",
    "Web: tanminhnhan.com.vn",
  ].forEach((t) => doc.text(t, { width: W, align: "center" }));
  doc.moveTo(L, doc.y + 2).lineTo(L + W, doc.y + 2).lineWidth(1).stroke();
  doc.font("I").fontSize(7.5).text("Mẫu : ĐTKSTT- ĐXĐGĐ 01/2020", L, doc.y + 5, { width: W, align: "right" });
  doc.font("B").fontSize(14).text(isOut ? "BẢNG TỔNG HỢP ĐỀ XUẤT ĐƠN GIÁ NHÂN CÔNG NGOÀI HỢP ĐỒNG, PHỤ LỤC" : "BẢNG TỔNG HỢP ĐƠN GIÁ NHÂN CÔNG TRÌNH DUYỆT", L, doc.y + 1, { width: W, align: "center" });
  const result = sub.status === "APPROVED" ? "ĐÃ DUYỆT" : sub.status === "REJECTED" ? "KHÔNG DUYỆT" : "CHƯA DUYỆT";
  // kết quả: ĐÃ DUYỆT xanh lá · KHÔNG DUYỆT / CHƯA DUYỆT đỏ
  const resColor = sub.status === "APPROVED" ? C_GREEN : RED;
  const resTint = sub.status === "APPROVED" ? "#E8F5E9" : "#FDECEA";
  doc.font("B").fontSize(10).fillColor(resColor).text(`Kết quả: ${result}`, { width: W, align: "center" });
  doc.fillColor("black");

  // ---- thông tin hồ sơ (nhãn : giá trị — như các dòng CÔNG TRÌNH, HỢP ĐỒNG... của mẫu) ----
  const info: [string, string][] = [
    ["CÔNG TRÌNH", sub.projectName],
    ["THUỘC HỢP ĐỒNG VỚI CĐT SỐ", sub.contractNo],
    ["MÃ SỐ DỰ ÁN", sub.projectCode],
    ["HẠNG MỤC", sub.itemName],
    ...(isOut ? ([["TÌNH TRẠNG BÁO GIÁ", sub.quoteStatus]] as [string, string][]) : []),
    ["TÊN TỔ ĐỘI", sub.crewName || "(chưa có đội)"],
    ["ĐỢT", `${sub.batch}${sub.batchDate ? `  (Ngày ${sub.batchDate})` : ""}  —  Lần ${sub.revision}`],
  ];
  let y = doc.y + 4;
  doc.fontSize(9);
  for (const [k, v] of info) {
    doc.font("B").fillColor(C_BLUE).text(k, L + 40, y, { width: 190 });
    doc.font("B").fillColor("black").text(`:  ${v || "………………"}`, L + 230, y, { width: W - 270 });
    y = doc.y + 1;
  }
  y += 5;

  // ---- bảng: cột & nhóm cột đúng như file Excel (rộng theo mẫu) ----
  type Col = { key: string; title: string; w: number; align?: "left" | "right" | "center" };
  type Grp = { title: string; span: number };
  const cols: Col[] = isOut
    ? [
        { key: "stt", title: "STT", w: 8, align: "center" },
        { key: "content", title: "NỘI DUNG", w: 43 },
        { key: "unit", title: "ĐVT", w: 11, align: "center" },
        { key: "qty", title: "Khối lượng hợp đồng", w: 16, align: "right" },
        { key: "cdtPrice", title: "Đơn giá\n(Bao gồm nhân công + vật tư hoàn thiện)", w: 25, align: "right" },
        { key: "cdtAmt", title: "Thành tiền", w: 24, align: "right" },
        { key: "basePrice", title: "Đơn giá DT-CP", w: 16, align: "right" },
        { key: "sitePrice", title: "Đơn giá", w: 16, align: "right" },
        { key: "siteAmt", title: "Thành tiền", w: 24, align: "right" },
        { key: "siteNote", title: "Ghi chú", w: 22 },
        { key: "ok", title: "Ý kiến\n(Đồng ý hoặc điều chỉnh)", w: 14, align: "center" },
        { key: "apprPrice", title: "Đơn giá đề xuất lại nếu điều chỉnh", w: 17, align: "right" },
        { key: "apprAmt", title: "Thành tiền", w: 24, align: "right" },
        { key: "note", title: "Ghi chú\n(Tham chiếu công trình nào gần đây nhất)", w: 26 },
      ]
    : [
        { key: "stt", title: "STT", w: 8, align: "center" },
        { key: "content", title: "NỘI DUNG", w: 43 },
        { key: "unit", title: "ĐVT", w: 11, align: "center" },
        { key: "qty", title: "Khối lượng hợp đồng", w: 16, align: "right" },
        { key: "cdtPrice", title: "Đơn giá\n(Bao gồm nhân công + vật tư hoàn thiện)", w: 25, align: "right" },
        { key: "cdtAmt", title: "Thành tiền", w: 24, align: "right" },
        { key: "basePrice", title: "Đơn giá", w: 16, align: "right" },
        { key: "baseAmt", title: "Thành tiền", w: 24, align: "right" },
        { key: "baseNote", title: "Ghi chú", w: 19 },
        { key: "siteOp", title: "Ý kiến\n(Đồng ý hoặc điều chỉnh)", w: 15, align: "center" },
        { key: "sitePrice", title: "Đơn giá đề xuất lại nếu điều chỉnh", w: 18, align: "right" },
        { key: "siteAmt", title: "Thành tiền", w: 24, align: "right" },
        { key: "siteNote", title: "Ghi chú\n(Tham chiếu công trình nào gần đây nhất)", w: 24 },
        { key: "ok", title: "Ý kiến\n(Đồng ý / điều chỉnh)", w: 12, align: "center" },
        { key: "apprPrice", title: "Đơn giá duyệt", w: 15, align: "right" },
        { key: "apprAmt", title: "Thành tiền duyệt", w: 24, align: "right" },
        { key: "note", title: "Ghi chú QSTT / TP", w: 22 },
      ];
  const groups: Grp[] = isOut
    ? [
        { title: "STT", span: 1 },
        { title: "NỘI DUNG", span: 1 },
        { title: "ĐVT", span: 1 },
        { title: "CHỦ ĐẦU TƯ ( DỰ KIẾN )", span: 3 },
        { title: "Đơn giá DT-CP", span: 1 },
        { title: "GIÁ ĐỀ XUẤT CỦA CÔNG TRÌNH", span: 3 },
        { title: "GIÁ DUYỆT CỦA KHỐI KT-KH", span: 4 },
      ]
    : [
        { title: "STT", span: 1 },
        { title: "NỘI DUNG", span: 1 },
        { title: "ĐVT", span: 1 },
        { title: "CHỦ ĐẦU TƯ", span: 3 },
        { title: "GIÁ CƠ SỞ ĐỀ XUẤT", span: 3 },
        { title: "GIÁ ĐỀ XUẤT CỦA CÔNG TRÌNH", span: 4 },
        { title: "GIÁ DUYỆT CỦA KHỐI KT-KH", span: 4 },
      ];
  const unit = W / cols.reduce((s, c) => s + c.w, 0);
  cols.forEach((c) => (c.w *= unit));
  const xs: number[] = [];
  cols.reduce((x, c) => (xs.push(x), x + c.w), L);
  const pad = 2;
  const FS = 6.6;

  const header_ = (o: { header?: boolean }) => !!o.header;
  type Cell = { text: string; red?: boolean };
  const drawRow = (cells: (string | Cell)[], opts: { font?: string; size?: number; fill?: string; header?: boolean } = {}) => {
    const size = opts.size ?? FS;
    doc.font(opts.font ?? "R").fontSize(size);
    const txt = cells.map((c) => (typeof c === "string" ? c : c.text));
    // ô số (khối lượng, đơn giá, thành tiền): KHÔNG xuống dòng — thu nhỏ chữ vừa độ rộng cột
    const isNum = (i: number) => cols[i].align === "right" && !header_(opts);
    const fit = (t: string, i: number) => {
      if (!isNum(i) || !t) return size;
      const w = doc.widthOfString(t);
      const room = cols[i].w - pad * 2;
      return w > room ? Math.max(4, (size * room) / w) : size;
    };
    const h = Math.max(...txt.map((t, i) => (isNum(i) ? size : doc.heightOfString(t || " ", { width: cols[i].w - pad * 2 }))), size) + pad * 2;
    if (y + h > bottom()) {
      doc.addPage();
      y = doc.page.margins.top;
      if (!opts.header) drawHeader();
      doc.font(opts.font ?? "R").fontSize(size);
    }
    cols.forEach((c, i) => {
      if (opts.fill) doc.rect(xs[i], y, c.w, h).fill(opts.fill);
      doc.rect(xs[i], y, c.w, h).lineWidth(0.4).stroke("#000");
      const red = typeof cells[i] !== "string" && (cells[i] as Cell).red;
      const fs2 = fit(txt[i] ?? "", i);
      doc.fontSize(fs2).fillColor(red ? RED : "black").text(txt[i] ?? "", xs[i] + pad, y + pad, { width: c.w - pad * 2, align: opts.header ? "center" : (c.align ?? "left"), lineBreak: !isNum(i) });
      doc.fontSize(size).fillColor("black");
    });
    y += h;
  };
  // 2 dòng tiêu đề: dòng 1 = nhóm cột (gộp ô), dòng 2 = tên cột (STT / NỘI DUNG / ĐVT gộp dọc)
  const drawHeader = () => {
    const sz = 6.8;
    doc.font("B").fontSize(sz);
    const h2 = Math.max(...cols.map((c) => doc.heightOfString(c.title, { width: c.w - pad * 2 })), sz) + pad * 2;
    const h1 = sz + pad * 2 + 1;
    if (y + h1 + h2 > bottom()) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    let ci = 0;
    const singles = new Set<number>(); // cột thuộc nhóm 1 cột (STT / NỘI DUNG / ĐVT / Đơn giá DT-CP): gộp dọc 2 dòng tiêu đề
    for (const g of groups) {
      if (g.span === 1) singles.add(ci);
      ci += g.span;
    }
    ci = 0;
    for (const g of groups) {
      const x0 = xs[ci];
      const w = cols.slice(ci, ci + g.span).reduce((s, c) => s + c.w, 0);
      const single = g.span === 1;
      const hh = single ? h1 + h2 : h1;
      doc.rect(x0, y, w, hh).fill(C_HEAD);
      doc.rect(x0, y, w, hh).lineWidth(0.4).stroke("#000");
      doc.font("B").fontSize(sz).fillColor("black").text(g.title, x0 + pad, y + (single ? (hh - sz) / 2 : pad) , { width: w - pad * 2, align: "center" });
      ci += g.span;
    }
    cols.forEach((c, i) => {
      if (singles.has(i)) return;
      doc.rect(xs[i], y + h1, c.w, h2).fill(C_HEAD);
      doc.rect(xs[i], y + h1, c.w, h2).lineWidth(0.4).stroke("#000");
      doc.font("B").fontSize(sz).fillColor("black").text(c.title, xs[i] + pad, y + h1 + pad, { width: c.w - pad * 2, align: "center" });
    });
    y += h1 + h2;
  };
  drawHeader();

  const items = sub.lines.map((l) => (l.level === "ITEM" ? { cdt: cdtAmountOf(l), base: hasFormula(l, "baseAmount") ? (l.baseAmount ?? null) : l.qty != null && l.basePrice != null ? l.qty * l.basePrice : null, site: siteAmountOf(sub.kind, l), appr: apprAmountOf(sub.kind, l) } : null));
  type Sums = { cdt: number; base: number; site: number; appr: number };
  const tot: Sums = { cdt: 0, base: 0, site: 0, appr: 0 };
  const amtCells = (s: Sums) => ({ cdtAmt: fm(s.cdt), baseAmt: fm(s.base), siteAmt: fm(s.site), apprAmt: fm(s.appr) });
  const keys = (v: Record<string, string>, red?: string[]): Cell[] => cols.map((c) => ({ text: v[c.key] ?? "", red: !!red?.includes(c.key) }));

  sub.lines.forEach((l, i) => {
    if (l.level === "NOTE") {
      drawRow(keys({ content: l.content }), { font: "B" });
      return;
    }
    if (l.level === "GROUP" || l.level === "SUB") {
      const s: Sums = { cdt: 0, base: 0, site: 0, appr: 0 };
      for (let j = i + 1; j < sub.lines.length; j++) {
        const lj = sub.lines[j];
        if (lj.level === "GROUP" || (l.level === "SUB" && lj.level === "SUB")) break;
        s.cdt += items[j]?.cdt ?? 0;
        s.base += items[j]?.base ?? 0;
        s.site += items[j]?.site ?? 0;
        s.appr += items[j]?.appr ?? 0;
      }
      if (hasFormula(l, "cdtAmount")) s.cdt = l.cdtAmount ?? 0; // tổng nhóm sửa bằng công thức
      if (hasFormula(l, "baseAmount")) s.base = l.baseAmount ?? 0;
      if (hasFormula(l, "siteAmount")) s.site = l.siteAmount ?? 0;
      if (hasFormula(l, "apprAmount")) s.appr = l.tpAmount ?? 0;
      drawRow(keys({ stt: l.stt, content: l.content, ...amtCells(s) }), { font: "B", fill: l.level === "GROUP" ? C_GROUP : C_SUB });
      return;
    }
    const r = items[i]!;
    tot.cdt += r.cdt ?? 0;
    tot.base += r.base ?? 0;
    tot.site += r.site ?? 0;
    tot.appr += r.appr ?? 0;
    const opinion = opinionOf(sub.kind, l);
    const v: Record<string, string> = {
      stt: l.stt,
      content: l.content,
      unit: l.unit,
      qty: fq(l.qty),
      cdtPrice: fm(l.cdtPrice),
      cdtAmt: fm(r.cdt),
      basePrice: fm(l.basePrice),
      baseAmt: fm(r.base),
      baseNote: l.baseNote ?? "",
      siteOp: l.siteOpinion,
      sitePrice: fm(sitePriceOf(sub.kind, l)),
      siteAmt: fm(r.site),
      siteNote: l.siteNote ?? "",
      ok: opinion,
      apprPrice: fm(approvedPriceOf(sub.kind, l)),
      apprAmt: fm(r.appr),
      note: [l.qsNote && `QSTT: ${l.qsNote}`, l.tpNote && `TP: ${l.tpNote}`].filter(Boolean).join("; "),
    };
    // dòng công việc không tô màu, chữ đen; chỉ ĐƠN GIÁ Trưởng phòng ĐIỀU CHỈNH chữ đỏ (như file Excel)
    drawRow(keys(v, opinion === "Điều chỉnh" ? ["apprPrice"] : []));
  });
  const saved = savedTotals(sub.totalAmounts); // TỔNG CỘNG đã lưu (kể cả công thức sửa tay) — hồ sơ cũ chưa lưu thì dùng số cộng lại
  drawRow(keys({ content: "TỔNG CỘNG", ...amtCells({ cdt: saved.cdt ?? tot.cdt, base: saved.base ?? tot.base, site: saved.site ?? tot.site, appr: saved.appr ?? tot.appr }) }), { font: "B", size: 7.5, fill: C_HEAD });

  // ---- chân bảng: ký tên + ý kiến (như cuối mẫu Excel) ----
  if (y + 120 > bottom()) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  y += 8;
  // 2 khối ký: BCH công trình + Khối KT-KH (không có Ban giám đốc trong quy trình duyệt)
  const half = W / 2;
  const signs = [
    { title: "BCH CÔNG TRÌNH", name: sub.createdByName, line: sub.submittedAt ? `Đã trình ngày ${fd(sub.submittedAt)}` : "", color: C_BLUE, tint: "#EAF2FB" },
    { title: "KHỐI KT-KH", name: sub.reviewedByName, line: sub.reviewedAt ? `${result} ngày ${fd(sub.reviewedAt)}` : categoryLabel(sub.category), color: resColor, tint: resTint },
  ];
  signs.forEach((s, i) => {
    const x = L + i * half;
    doc.rect(x + 4, y - 3, half - 8, 17).fill(s.color);
    doc.font("B").fontSize(10).fillColor("#FFFFFF").text(s.title, x, y + 1, { width: half, align: "center" });
    doc.font("I").fontSize(7.5).fillColor(s.color).text(s.line, x, y + 17, { width: half, align: "center" });
    doc.font("B").fontSize(9).fillColor("black").text(s.name, x, y + 42, { width: half, align: "center" });
  });
  y += 60;
  const dots = "…………………………………………………………………………………………";
  const opinions = [
    { title: "Ý kiến của BCH Công trình", text: sub.qsNote, color: C_BLUE, tint: "#EAF2FB" },
    { title: "Ý kiến của khối KT-KH", text: sub.tpNote, color: resColor, tint: resTint },
  ];
  let yEnd = y;
  opinions.forEach((o, i) => {
    const x = L + i * half + 6;
    const w = half - 12;
    // dựng nội dung trước để biết chiều cao khung tô nền nhạt
    const body = o.text ? [o.text] : [1, 2, 3].map((n) => `${n}/${dots}`);
    doc.font("R").fontSize(8.5);
    const bodyH = body.reduce((a, t) => a + doc.heightOfString(t, { width: w - 10 }) + (o.text ? 1 : 4), 0);
    const boxH = 14 + bodyH + 6;
    doc.rect(x, y, w, boxH).fill(o.tint);
    doc.rect(x, y, 3, boxH).fill(o.color);
    doc.font("B").fontSize(9).fillColor(o.color).text(o.title, x + 8, y + 3, { width: w - 10 });
    let yy = y + 16;
    doc.font("R").fontSize(8.5).fillColor("black");
    for (const t of body) {
      doc.text(t, x + 8, yy + (o.text ? 0 : 3), { width: w - 10 });
      yy = doc.y + (o.text ? 1 : 1);
    }
    yEnd = Math.max(yEnd, y + boxH);
  });
  doc.font("I").fontSize(7).fillColor("#666").text(`${sub.code} · ${KIND_LABEL[sub.kind] ?? ""} · Xuất từ DT-CP Online ${fd(new Date())}`, L, bottom() - 10, { width: W, align: "right", lineBreak: false });

  doc.end();
  return done;
}
