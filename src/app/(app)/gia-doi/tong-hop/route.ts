import ExcelJS from "exceljs";
import { fixXlsx } from "@/lib/excel-fix";
import { applyStandardStyle } from "@/lib/excel-style";
import { prisma } from "@/lib/prisma";
import { amount, apprAmountOf, approvedPriceOf, canSeePrice, categoryLabel, contractAreaWhere, getPriceUser, hasFormula, opinionOf, PRICE_STATUS, savedTotals, siteAmountOf, sitePriceOf } from "@/lib/gia-doi";

// XUẤT FILE TỔNG HỢP TRÌNH GIÁ ĐỘI theo TUẦN / THÁNG.
// Cơ cấu bậc: KHU VỰC → DỰ ÁN → HỢP ĐỒNG → hồ sơ (đội / đợt / lần) → các dòng công việc.
// 2 sheet theo 2 MẪU hồ sơ (anh chốt 11/11/2026): "Theo DT-CP" = mẫu trong HĐ (kind IN), "Ngoài DT-CP" = mẫu ngoài HĐ, phụ lục (kind OUT).
// Cột giá: CĐT | Giá cơ sở (DT-CP) | Giá công trình đề xuất | Phòng Đấu thầu - Thanh toán duyệt.
// Tham số: ky=week|month, v=2026-W45 | 2026-11, theo=trinh|duyet (ngày trình hay ngày duyệt), kv=khu vực (trống = tất cả).

const DAY = 86400000;
const VN = 7 * 3600000; // giờ Việt Nam UTC+7
const fd = (d: Date | null | undefined) => (d ? d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "");
// Excel báo "found a problem with some content" nếu ô có số NaN / Infinity hoặc chữ chứa ký tự điều khiển (VD gõ / dán từ file khác) → lọc trước khi ghi
const cleanText = (s: string | null | undefined): string => (s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "").replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
const finite = (v: number | null | undefined): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const rounded = (v: number | null | undefined): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined);

function periodOf(ky: string, v: string, from?: string, to?: string): { from: Date; to: Date; label: string } | null {
  if (ky === "range") {
    // khoảng ngày do người dùng chỉ định (tính cả ngày đầu và ngày cuối)
    const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from ?? "");
    const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to ?? "");
    if (!a || !b) return null;
    const f = new Date(Date.UTC(+a[1], +a[2] - 1, +a[3]) - VN);
    const t = new Date(Date.UTC(+b[1], +b[2] - 1, +b[3]) + DAY - VN);
    if (t <= f) return null;
    return { from: f, to: t, label: `TỪ ${fd(f)} ĐẾN ${fd(new Date(t.getTime() - 1))}` };
  }
  if (ky === "week") {
    const m = /^(\d{4})-W(\d{1,2})$/.exec(v);
    if (!m) return null;
    const y = Number(m[1]);
    const w = Number(m[2]);
    const jan4 = Date.UTC(y, 0, 4);
    const monday1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY;
    const start = monday1 + (w - 1) * 7 * DAY;
    const from = new Date(start - VN);
    const to = new Date(start + 7 * DAY - VN);
    return { from, to, label: `TUẦN ${w}/${y} (${fd(from)} – ${fd(new Date(to.getTime() - 1))})` };
  }
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return { from: new Date(Date.UTC(y, mo, 1) - VN), to: new Date(Date.UTC(y, mo + 1, 1) - VN), label: `THÁNG ${mo + 1}/${y}` };
}

type Line = {
  stt: string;
  content: string;
  unit: string;
  qty: number | null;
  cdt: number | null;
  cdtAmt: number | null;
  baseAmt: number | null; // thành tiền (kể cả ô QSTT / Trưởng phòng sửa bằng công thức)
  siteAmt: number | null;
  apprAmt: number | null;
  base: number | null;
  site: number | null;
  siteNote: string;
  opinion: string;
  appr: number | null;
  tpNote: string;
};
type Sub = { title: string; date: number; lines: Line[]; saved: ReturnType<typeof savedTotals>; apprOk: boolean }; // apprOk: hồ sơ đã DUYỆT (chỉ khi đó mới tính tổng duyệt)
type Node = { label: string; sort: string; children: Map<string, Node>; subs: Sub[] };
const node = (label: string, sort: string): Node => ({ label, sort, children: new Map(), subs: [] });
type Tot = { cdt: number; base: number; site: number; appr: number };

export async function GET(req: Request) {
  const u = await getPriceUser();
  if (!u || !canSeePrice(u)) return new Response("Không có quyền", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const ky = sp.get("ky") === "week" ? "week" : sp.get("ky") === "range" ? "range" : "month";
  const p = periodOf(ky, sp.get("v") ?? "", sp.get("from") ?? "", sp.get("to") ?? "");
  if (!p) return new Response("Chọn tuần / tháng / khoảng ngày cần xuất", { status: 400 });
  const byReview = sp.get("theo") === "duyet";
  const kv = sp.get("kv") ?? "";
  if (kv && u.areas && !u.areas.includes(kv)) return new Response("Khu vực ngoài phạm vi làm việc của bạn", { status: 403 });
  const pj = (sp.get("pj") ?? "").trim().toLowerCase(); // lọc theo dự án
  const ct = sp.get("ct") ?? ""; // lọc theo hợp đồng (id)

  const range = { gte: p.from, lt: p.to };
  // CHỈ lấy hồ sơ ĐÃ DUYỆT giá (bỏ hồ sơ chưa duyệt / không duyệt)
  const subsAll = await prisma.priceSubmission.findMany({
    where: {
      AND: [
        contractAreaWhere(u),
        { status: "APPROVED" },
        byReview ? { reviewedAt: range } : { OR: [{ submittedAt: range }, { submittedAt: null, reviewedAt: range }] },
        kv ? { contract: { area: kv } } : {},
        ct ? { contractId: ct } : {},
      ],
    },
    select: {
      code: true, kind: true, status: true, projectName: true, itemName: true, batch: true, batchDate: true, crewName: true, revision: true, category: true,
      submittedAt: true, reviewedAt: true, reviewedByName: true, imported: true, totalAmounts: true,
      contract: { select: { id: true, name: true, area: true, packageName: true, contractNo: true } },
      lines: {
        where: { level: "ITEM" },
        orderBy: { orderIndex: "asc" },
        select: {
          stt: true, content: true, unit: true, level: true, qty: true, cdtPrice: true, cdtAmount: true, basePrice: true, siteOpinion: true, sitePrice: true, siteNote: true,
          ptOpinion: true, ptPrice: true, tpPrice: true, tpOk: true, tpNote: true, formulas: true, baseAmount: true, siteAmount: true, tpAmount: true,
        },
      },
    },
  });

  const subs = pj ? subsAll.filter((s) => (s.contract?.name || s.projectName || "(chưa có tên công trình)").trim().toLowerCase() === pj) : subsAll;

  // dựng 2 cây (theo DT-CP / ngoài DT-CP)
  const roots = { in: node("", ""), out: node("", "") };
  for (const s of subs) {
    const reviewed = s.status === "APPROVED" || s.status === "REJECTED";
    const c = s.contract;
    const area = c?.area ?? "";
    const proj = c?.name || s.projectName || "(chưa có tên công trình)";
    const hd = c ? [c.contractNo ? `HĐ ${c.contractNo}` : "HĐ (chưa có số)", c.packageName].filter(Boolean).join(" — ") : "Chưa gắn hợp đồng";
    const title = [
      s.code,
      s.crewName ? `Đội: ${s.crewName}` : "",
      s.itemName,
      s.batch ? `Đợt ${s.batch}${s.batchDate ? ` (${s.batchDate})` : ""}` : "",
      `Lần ${s.revision}`,
      PRICE_STATUS[s.status]?.label ?? s.status,
      s.reviewedAt ? `${s.reviewedByName || categoryLabel(s.category)} duyệt ${fd(s.reviewedAt)}` : s.submittedAt ? `trình ${fd(s.submittedAt)}` : "",
      s.imported ? "hồ sơ cũ" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const split = { in: [] as Line[], out: [] as Line[] };
    for (const l of s.lines) {
      const site = sitePriceOf(s.kind, l);
      const appr = s.status === "APPROVED" ? approvedPriceOf(s.kind, l) : null;
      split[s.kind === "OUT" ? "out" : "in"].push({
        stt: l.stt,
        content: l.content,
        unit: l.unit,
        qty: l.qty,
        cdt: l.cdtPrice,
        cdtAmt: l.cdtAmount ?? amount(l.qty, l.cdtPrice),
        baseAmt: hasFormula(l, "baseAmount") ? (l.baseAmount ?? null) : amount(l.qty, l.basePrice),
        siteAmt: siteAmountOf(s.kind, l),
        apprAmt: s.status === "APPROVED" ? apprAmountOf(s.kind, l) : null,
        base: l.basePrice,
        site,
        siteNote: l.siteNote,
        opinion: s.status === "APPROVED" ? opinionOf(s.kind, l) : s.status === "REJECTED" ? "Không duyệt" : "",
        appr,
        tpNote: reviewed ? l.tpNote : "",
      });
    }
    for (const k of ["in", "out"] as const) {
      if (!split[k].length) continue;
      const root = roots[k];
      const aKey = area || "~";
      const an = root.children.get(aKey) ?? root.children.set(aKey, node(area ? `KHU VỰC ${area}` : "CHƯA CHỌN KHU VỰC", area ? area.padStart(3, "0") : "~")).get(aKey)!;
      const pKey = proj.trim().toLowerCase();
      const pn = an.children.get(pKey) ?? an.children.set(pKey, node(proj, proj)).get(pKey)!;
      const hKey = c?.id ?? `-${hd}`;
      const hn = pn.children.get(hKey) ?? pn.children.set(hKey, node(hd, c ? c.contractNo || c.packageName : "~")).get(hKey)!;
      hn.subs.push({ title, date: (s.reviewedAt ?? s.submittedAt ?? new Date(0)).getTime(), lines: split[k], saved: savedTotals(s.totalAmounts), apprOk: s.status === "APPROVED" });
    }
  }

  const wb = new ExcelJS.Workbook();
  const meta = `${p.label} · tính theo ${byReview ? "NGÀY DUYỆT" : "NGÀY TRÌNH"}${kv ? ` · Khu vực ${kv}` : ""}${pj ? ` · Dự án: ${sp.get("pj")}` : ""}${ct ? ` · ${subs[0]?.contract ? `HĐ ${subs[0].contract.contractNo || subs[0].contract.name}` : "1 hợp đồng"}` : ""} · chỉ hồ sơ đã duyệt giá`;
  writeSheet(wb, "Theo DT-CP", "TỔNG HỢP TRÌNH GIÁ TỔ ĐỘI — CÔNG VIỆC THEO DT-CP", meta, roots.in, "GIÁ CƠ SỞ (DT-CP)");
  writeSheet(wb, "Ngoài DT-CP", "TỔNG HỢP TRÌNH GIÁ TỔ ĐỘI — CÔNG VIỆC NGOÀI DT-CP (NGOÀI HĐ, PHỤ LỤC)", meta, roots.out, "GIÁ CƠ SỞ / ĐƠN GIÁ DT-CP");

  applyStandardStyle(wb); // Times New Roman, canh giữa dọc, số tiền kiểu Comma
  const buf = await fixXlsx(await wb.xlsx.writeBuffer());
  const tag = ky === "week" ? (sp.get("v") ?? "") : ky === "range" ? `${sp.get("from")} den ${sp.get("to")}` : `Thang ${sp.get("v")}`;
  const name = `Tong hop trinh gia doi - ${tag}${kv ? ` - KV${kv}` : ""}.xlsx`.replace(/[\\/:*?"<>|]/g, "-");
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}

// Cột: A STT | B NỘI DUNG | C ĐVT | D KL | CĐT E ĐG F TT | CƠ SỞ G ĐG H TT | CÔNG TRÌNH I ĐG J TT K Ghi chú | DUYỆT L Ý kiến M ĐG N TT O Ghi chú
const N_COLS = 15;
const AMT = { cdt: 6, base: 8, site: 10, appr: 14 } as const;
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"];
const LEVEL_FILL = ["FF1E3A8A", "FFDBEAFE", "FFFEF3C7", "FFF1F5F9"];

function writeSheet(wb: ExcelJS.Workbook, sheetName: string, title: string, meta: string, root: Node, baseHead: string) {
  // outlineLevelRow = cấp lớn nhất đang dùng (0..4) để Excel hiện đúng nút nhóm / thu gọn
  const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", xSplit: 2, ySplit: 6 }], properties: { outlineLevelRow: 4, outlineProperties: { summaryBelow: false, summaryRight: true } } as Partial<ExcelJS.WorksheetProperties> });
  ws.mergeCells(1, 1, 1, N_COLS);
  ws.getCell(1, 1).value = cleanText(title);
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.getCell(1, 1).alignment = { horizontal: "center" };
  ws.mergeCells(2, 1, 2, N_COLS);
  ws.getCell(2, 1).value = cleanText(meta);
  ws.getCell(2, 1).alignment = { horizontal: "center" };
  ws.getCell(3, 1).value = `Ngày lập: ${fd(new Date())}`;

  const h1 = 5;
  const h2 = 6;
  const group = (c1: number, c2: number, t: string, sub?: string[]) => {
    if (!sub) {
      ws.mergeCells(h1, c1, h2, c1);
      ws.getCell(h1, c1).value = t;
      return;
    }
    ws.mergeCells(h1, c1, h1, c2);
    ws.getCell(h1, c1).value = t;
    sub.forEach((x, i) => (ws.getCell(h2, c1 + i).value = x));
  };
  group(1, 1, "STT");
  group(2, 2, "NỘI DUNG");
  group(3, 3, "ĐVT");
  group(4, 4, "KHỐI LƯỢNG");
  group(5, 6, "CHỦ ĐẦU TƯ", ["Đơn giá", "Thành tiền"]);
  group(7, 8, baseHead, ["Đơn giá", "Thành tiền"]);
  group(9, 11, "GIÁ CÔNG TRÌNH ĐỀ XUẤT", ["Đơn giá", "Thành tiền", "Ghi chú"]);
  group(12, 15, "KHỐI KT-KH DUYỆT", ["Ý kiến", "Đơn giá", "Thành tiền", "Ghi chú"]);
  for (const r of [h1, h2])
    for (let col = 1; col <= N_COLS; col++) {
      const cell = ws.getCell(r, col);
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: col >= 12 ? "FFD1FAE5" : "FFE2E8F0" } };
    }

  // tổng theo nút
  const totOf = (n: Node): Tot => {
    const t: Tot = { cdt: 0, base: 0, site: 0, appr: 0 };
    const add = (x: Tot) => ((t.cdt += x.cdt), (t.base += x.base), (t.site += x.site), (t.appr += x.appr));
    for (const s of n.subs) add(subTot(s));
    for (const c of n.children.values()) add(totOf(c));
    return t;
  };
  // tổng hồ sơ: dùng TỔNG CỘNG đã lưu (kể cả công thức sửa tay ở tổng nhóm / tổng cộng); hồ sơ cũ chưa lưu thì cộng các dòng
  const subTot = (s: Sub): Tot => {
    const sum = s.lines.reduce(
      (t, l) => ({ cdt: t.cdt + (l.cdtAmt ?? 0), base: t.base + (l.baseAmt ?? 0), site: t.site + (l.siteAmt ?? 0), appr: t.appr + (l.apprAmt ?? 0) }),
      { cdt: 0, base: 0, site: 0, appr: 0 },
    );
    return { cdt: s.saved.cdt ?? sum.cdt, base: s.saved.base ?? sum.base, site: s.saved.site ?? sum.site, appr: s.apprOk ? (s.saved.appr ?? sum.appr) : sum.appr };
  };
  const sorted = (n: Node) => [...n.children.values()].sort((a, b) => a.sort.localeCompare(b.sort, "vi", { numeric: true }));

  let r = h2 + 1;
  const head = (stt: string, label: string, t: Tot, level: number) => {
    const row = ws.getRow(r);
    row.getCell(1).value = cleanText(stt);
    row.getCell(2).value = cleanText(label);
    row.getCell(AMT.cdt).value = rounded(t.cdt) || null;
    row.getCell(AMT.base).value = rounded(t.base) || null;
    row.getCell(AMT.site).value = rounded(t.site) || null;
    row.getCell(AMT.appr).value = rounded(t.appr) || null;
    row.font = { bold: true, color: level === 0 ? { argb: "FFFFFFFF" } : undefined, italic: level === 3 };
    for (let col = 1; col <= N_COLS; col++) row.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LEVEL_FILL[level] } };
    row.outlineLevel = level;
    r++;
  };

  const all = totOf(root);
  head("", "TỔNG CỘNG", all, 0);
  sorted(root).forEach((a, ia) => {
    head(String.fromCharCode(65 + ia), a.label, totOf(a), 0);
    sorted(a).forEach((pj, ip) => {
      head(ROMAN[ip] ?? String(ip + 1), `DỰ ÁN: ${pj.label}`, totOf(pj), 1);
      sorted(pj).forEach((h, ih) => {
        head(`${ROMAN[ip] ?? ip + 1}.${ih + 1}`, h.label, totOf(h), 2);
        h.subs
          .sort((x, y) => x.date - y.date)
          .forEach((s) => {
            head("", s.title, subTot(s), 3);
            for (const l of s.lines) {
              const row = ws.getRow(r);
              row.values = [
                cleanText(l.stt),
                cleanText(l.content),
                cleanText(l.unit),
                finite(l.qty),
                finite(l.cdt),
                rounded(l.cdtAmt),
                finite(l.base),
                rounded(l.baseAmt),
                finite(l.site),
                rounded(l.siteAmt),
                cleanText(l.siteNote) || undefined,
                cleanText(l.opinion) || undefined,
                finite(l.appr),
                rounded(l.apprAmt),
                cleanText(l.tpNote) || undefined,
              ];
              row.outlineLevel = 4;
              // đơn giá đề xuất / duyệt vượt giá cơ sở: tô đỏ
              if (l.base != null && l.site != null && l.site > l.base + 0.5) row.getCell(9).font = { color: { argb: "FFDC2626" }, bold: true };
              if (l.base != null && l.appr != null && l.appr > l.base + 0.5) row.getCell(13).font = { color: { argb: "FFDC2626" }, bold: true };
              r++;
            }
          });
      });
    });
  });
  if (r === h2 + 2) {
    ws.mergeCells(r, 1, r, N_COLS);
    ws.getCell(r, 1).value = "(Không có hồ sơ trong kỳ)";
    ws.getCell(r, 1).alignment = { horizontal: "center" };
    r++;
  }

  const widths = [7, 48, 8, 11, 13, 15, 13, 15, 13, 15, 22, 12, 13, 15, 22];
  for (let col = 1; col <= N_COLS; col++) {
    ws.getColumn(col).width = widths[col - 1];
    if (col === 4) ws.getColumn(col).numFmt = "#,##0.###";
    else if (col >= 5 && ![11, 12, 15].includes(col)) ws.getColumn(col).numFmt = "#,##0";
    for (let rr = h1; rr < r; rr++) {
      const cell = ws.getCell(rr, col);
      cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
      if (rr > h2 && [2, 11, 15].includes(col)) cell.alignment = { wrapText: true, vertical: "top" };
    }
  }
  ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "5:6" };
}
