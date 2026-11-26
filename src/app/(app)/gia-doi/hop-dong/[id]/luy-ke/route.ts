import ExcelJS from "exceljs";
import { fixXlsx } from "@/lib/excel-fix";
import { canSeePrice, getPriceUser, inPriceAreas } from "@/lib/gia-doi";
import { loadCumulative } from "@/lib/luy-ke";

// Tải Excel "TỔNG HỢP LŨY KẾ CÁC ĐỢT DUYỆT ĐƠN GIÁ TỔ ĐỘI" của 1 hợp đồng (giống bảng ở tab Lũy kế).
// Trình bày (anh chốt 11/11/2026): font Times New Roman, tiêu đề tô màu, khổ A4 ngang vừa 1 trang bề ngang.
// Toàn bộ bảng là CÔNG THỨC: Thành tiền đợt = KL × ĐG; LŨY KẾ KL = tổng KL các đợt; ĐG lũy kế = đơn giá của đợt MỚI NHẤT
// (cột đợt xếp theo ngày trình) có giá; Thành tiền lũy kế = tổng thành tiền các đợt; KL còn lại = KL DT-CP − lũy kế (mọi đội cùng dòng).

const FONT = "Times New Roman";
const C = {
  navy: "FF1F3864", // tiêu đề bảng
  head: "FF2F5597", // hàng tiêu đề cột
  batchA: "FFDDEBF7",
  batchB: "FFE2EFDA",
  cum: "FFFCE4D6", // khối LŨY KẾ
  cumHead: "FFC55A11",
  outside: "FFFFF2CC",
  total: "FFD9E1F2",
  line: "FF8EA9DB",
};
const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const thin = (argb = C.line): Partial<ExcelJS.Borders> => ({ top: { style: "thin", color: { argb } }, left: { style: "thin", color: { argb } }, bottom: { style: "thin", color: { argb } }, right: { style: "thin", color: { argb } } });

function colName(n: number) {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await getPriceUser();
  if (!u || !canSeePrice(u)) return new Response("Không có quyền", { status: 403 });
  const d = await loadCumulative(id);
  if (!d) return new Response("Không tìm thấy hợp đồng", { status: 404 });
  if (!inPriceAreas(u, d.contract.area)) return new Response("Hợp đồng ngoài khu vực làm việc của bạn", { status: 403 });
  const { contract: c, batches, rows } = d;

  const wb = new ExcelJS.Workbook();
  wb.creator = "DT-CP Online";
  const h1 = 7; // hàng tiêu đề nhóm cột
  const h2 = 8; // hàng tiêu đề con
  const h3 = 9; // hàng đánh số cột
  const ws = wb.addWorksheet("Lũy kế đơn giá đội", {
    views: [{ state: "frozen", xSplit: 4, ySplit: h3, showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.55, bottom: 0.55, header: 0.25, footer: 0.25 },
      printTitlesRow: `${h1}:${h3}`,
    },
    headerFooter: { oddFooter: `&L&"${FONT},Italic"&8Lũy kế đơn giá đội — ${c.name.replace(/&/g, "&&")}&R&"${FONT},Italic"&8Trang &P / &N` },
  });

  // ---- bố cục cột ----
  const B0 = 7; // cột đầu của đợt 1
  const cL = B0 + batches.length * 3; // khối LŨY KẾ: KL | Đơn giá | Thành tiền | KL còn lại
  const nCols = cL + 3;
  const qtyCols = new Set<number>([5, cL, cL + 3, ...batches.map((_, k) => B0 + k * 3)]);
  const widths: Record<number, number> = { 1: 6, 2: 46, 3: 8, 4: 20, 5: 11, 6: 13 };
  for (let col = 1; col <= nCols; col++) {
    const w = widths[col] ?? (qtyCols.has(col) ? 11 : col === cL + 2 || (col >= B0 && col < cL && (col - B0) % 3 === 2) ? 16 : 13);
    ws.getColumn(col).width = w;
  }
  ws.properties.defaultRowHeight = 18;

  // ---- đầu trang ----
  const put = (r: number, text: string, opt: { size?: number; bold?: boolean; italic?: boolean; color?: string; align?: "left" | "center" | "right" } = {}) => {
    ws.mergeCells(r, 1, r, nCols);
    const cell = ws.getCell(r, 1);
    cell.value = text;
    cell.font = { name: FONT, size: opt.size ?? 11, bold: opt.bold, italic: opt.italic, color: { argb: opt.color ?? "FF000000" } };
    cell.alignment = { horizontal: opt.align ?? "left", vertical: "middle" };
  };
  put(1, "CÔNG TY CỔ PHẦN XÂY DỰNG KIẾN TRÚC TÂN MINH NHÂN", { bold: true, size: 11, color: C.navy });
  put(2, "KHỐI KINH TẾ - KẾ HOẠCH", { bold: true, size: 10, color: C.navy });
  put(3, "TỔNG HỢP LŨY KẾ CÁC ĐỢT DUYỆT ĐƠN GIÁ TỔ ĐỘI", { bold: true, size: 16, color: C.navy, align: "center" });
  ws.getRow(3).height = 28;
  put(4, `Dự án: ${c.name}${c.packageName ? `   —   Gói thầu: ${c.packageName}` : ""}${c.contractNo ? `   —   Hợp đồng số: ${c.contractNo}` : ""}`, { bold: true, align: "center" });
  put(5, `Ngày lập: ${new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}   ·   Đơn vị tính tiền: đồng`, { italic: true, size: 10, align: "center", color: "FF595959" });

  // ---- tiêu đề cột ----
  const hcell = (r: number, col: number, text: string, bg: string, color = "FFFFFFFF", size = 10) => {
    const cell = ws.getCell(r, col);
    cell.value = text;
    cell.font = { name: FONT, size, bold: true, color: { argb: color } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = fill(bg);
    cell.border = thin("FFFFFFFF");
  };
  ["STT", "NỘI DUNG CÔNG VIỆC", "ĐVT", "TỔ ĐỘI", "KL DT-CP", "ĐƠN GIÁ DT-CP (kiểm soát)"].forEach((t, i) => {
    ws.mergeCells(h1, i + 1, h2, i + 1);
    hcell(h1, i + 1, t, C.head);
  });
  batches.forEach((b, k) => {
    const c0 = B0 + k * 3;
    const bg = k % 2 ? C.batchB : C.batchA;
    ws.mergeCells(h1, c0, h1, c0 + 2);
    hcell(h1, c0, `${b.label.toUpperCase()}\n(duyệt ${b.date})`, bg, C.navy);
    ["Khối lượng", "Đơn giá duyệt", "Thành tiền"].forEach((t, i) => hcell(h2, c0 + i, t, bg, C.navy));
  });
  ws.mergeCells(h1, cL, h1, cL + 3);
  hcell(h1, cL, "LŨY KẾ", C.cumHead);
  ["Khối lượng", "Đơn giá\n(đợt mới nhất)", "Thành tiền", "KL còn lại\ntheo DT-CP"].forEach((t, i) => hcell(h2, cL + i, t, C.cumHead));
  ws.getRow(h1).height = 34;
  ws.getRow(h2).height = 32;
  for (let col = 1; col <= nCols; col++) {
    const cell = ws.getCell(h3, col);
    cell.value = `(${col})`;
    cell.font = { name: FONT, size: 8, italic: true, color: { argb: "FF595959" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = fill("FFF2F2F2");
    cell.border = thin();
  }
  ws.getRow(h3).height = 14;

  // ---- dữ liệu (công thức) ----
  const L = colName;
  const numFmt = '#,##0;[Red]-#,##0;"-"';
  const qtyFmt = '#,##0.###;[Red]-#,##0.###;"-"';
  const first = h3 + 1;
  let r = first;
  let outsideHead = false;
  // các dòng cùng 1 dòng DT-CP (nhiều đội) nằm liền nhau → KL còn lại trừ tổng lũy kế của cả nhóm
  const groupStart = new Map<number, number>();
  const groupEnd = new Map<number, number>();
  const dataRows: { r: number; x: (typeof rows)[number] }[] = [];
  for (const x of rows) {
    if (x.outside && !outsideHead) {
      outsideHead = true;
      ws.mergeCells(r, 1, r, nCols);
      const cell = ws.getCell(r, 1);
      cell.value = "CÔNG VIỆC NGOÀI DT-CP";
      cell.font = { name: FONT, size: 11, bold: true, color: { argb: "FF7F6000" } };
      cell.fill = fill(C.outside);
      cell.alignment = { vertical: "middle" };
      cell.border = thin();
      ws.getRow(r).height = 20;
      r++;
    }
    dataRows.push({ r, x });
    r++;
  }
  const last = r - 1;
  for (let i = 0; i < dataRows.length; i++) {
    const { r: rr, x } = dataRows[i];
    if (x.outside || x.dtQty == null) continue;
    let j = i;
    while (j + 1 < dataRows.length && !dataRows[j + 1].x.outside && dataRows[j + 1].x.lineKey === x.lineKey) j++;
    for (let k = i; k <= j; k++) {
      groupStart.set(dataRows[k].r, rr);
      groupEnd.set(dataRows[k].r, dataRows[j].r);
    }
    i = j;
  }

  for (const { r: rr, x } of dataRows) {
    const row = ws.getRow(rr);
    row.getCell(1).value = x.stt || null;
    row.getCell(2).value = x.name;
    row.getCell(3).value = x.unit;
    row.getCell(4).value = x.crew || "(chưa có đội)";
    row.getCell(5).value = x.dtQty ?? null;
    row.getCell(6).value = x.dtPrice != null ? Math.round(x.dtPrice) : null;
    const qRefs: string[] = [];
    const aRefs: string[] = [];
    batches.forEach((b, k) => {
      const c0 = B0 + k * 3;
      const cell = x.cells[b.key];
      if (cell) {
        row.getCell(c0).value = cell.qty;
        row.getCell(c0 + 1).value = Math.round(cell.price);
      }
      row.getCell(c0 + 2).value = { formula: `IF(OR(${L(c0)}${rr}="",${L(c0 + 1)}${rr}=""),0,ROUND(${L(c0)}${rr}*${L(c0 + 1)}${rr},0))`, result: cell ? Math.round(cell.qty * Math.round(cell.price)) : 0 };
      qRefs.push(`${L(c0)}${rr}`);
      aRefs.push(`${L(c0 + 2)}${rr}`);
    });
    // đơn giá mới nhất: xét từ đợt cuối về đợt đầu, đợt nào có đơn giá thì lấy
    let latest = '""';
    let latestVal: number | null = null;
    batches.forEach((b, k) => {
      const p = `${L(B0 + k * 3 + 1)}${rr}`;
      latest = `IF(${p}<>"",${p},${latest})`;
      if (x.cells[b.key]) latestVal = Math.round(x.cells[b.key].price);
    });
    const sumQ = qRefs.length ? `SUM(${qRefs.join(",")})` : "0";
    const sumA = aRefs.length ? `SUM(${aRefs.join(",")})` : "0";
    row.getCell(cL).value = { formula: sumQ, result: x.qty };
    row.getCell(cL + 1).value = { formula: latest, result: latestVal ?? "" };
    row.getCell(cL + 2).value = { formula: sumA, result: Math.round(x.amount) };
    if (!x.outside && x.dtQty != null) {
      const g0 = groupStart.get(rr) ?? rr;
      const g1 = groupEnd.get(rr) ?? rr;
      row.getCell(cL + 3).value = { formula: `E${rr}-SUM(${L(cL)}$${g0}:${L(cL)}$${g1})`, result: x.dtQty - (d.lineQty.get(x.lineKey) ?? 0) };
    }
  }

  // ---- định dạng vùng dữ liệu ----
  for (let rr = first; rr <= last; rr++) {
    const row = ws.getRow(rr);
    if (ws.getCell(rr, 1).isMerged) continue; // dòng nhóm "ngoài DT-CP"
    for (let col = 1; col <= nCols; col++) {
      const cell = row.getCell(col);
      cell.font = { name: FONT, size: 10.5, bold: col === cL || col === cL + 2 };
      cell.border = thin();
      cell.alignment = { vertical: "middle", horizontal: col === 1 || col === 3 ? "center" : col === 2 || col === 4 ? "left" : "right", wrapText: col === 2 || col === 4 };
      if (col >= 5) cell.numFmt = qtyCols.has(col) ? qtyFmt : numFmt;
      if (col >= B0 && col < cL) {
        const k = Math.floor((col - B0) / 3);
        if (k % 2) cell.fill = fill("FFF7FBF4");
      } else if (col >= cL) cell.fill = fill("FFFFF8F3");
    }
  }
  // đơn giá lũy kế vượt đơn giá DT-CP → chữ đỏ đậm
  if (last >= first)
    ws.addConditionalFormatting({
      ref: `${L(cL + 1)}${first}:${L(cL + 1)}${last}`,
      rules: [{ type: "expression", priority: 1, formulae: [`AND(ISNUMBER($F${first}),ISNUMBER(${L(cL + 1)}${first}),${L(cL + 1)}${first}>$F${first})`], style: { font: { color: { argb: "FFC00000" }, bold: true } } }],
    });

  // ---- TỔNG CỘNG ----
  const tr = ws.getRow(last + 1);
  ws.mergeCells(last + 1, 1, last + 1, 4);
  tr.getCell(1).value = "TỔNG CỘNG";
  const sumCols = [...batches.map((_, k) => B0 + k * 3 + 2), cL + 2];
  for (const col of sumCols) tr.getCell(col).value = { formula: `SUM(${L(col)}${first}:${L(col)}${Math.max(last, first)})` };
  for (let col = 1; col <= nCols; col++) {
    const cell = tr.getCell(col);
    cell.font = { name: FONT, size: 11, bold: true, color: { argb: C.navy } };
    cell.fill = fill(C.total);
    cell.border = { ...thin(), top: { style: "medium", color: { argb: C.navy } }, bottom: { style: "double", color: { argb: C.navy } } };
    cell.alignment = { vertical: "middle", horizontal: col === 1 ? "center" : "right" };
    if (col >= 5) cell.numFmt = numFmt;
  }
  tr.height = 22;

  // ---- ghi chú + chữ ký ----
  let n = last + 3;
  const note = (t: string) => {
    ws.mergeCells(n, 1, n, nCols);
    const cell = ws.getCell(n++, 1);
    cell.value = t;
    cell.font = { name: FONT, size: 9.5, italic: true, color: { argb: "FF595959" } };
  };
  note("Ghi chú: Thành tiền từng đợt = Khối lượng × Đơn giá duyệt của đợt; Lũy kế khối lượng = tổng khối lượng các đợt; Đơn giá lũy kế = đơn giá của đợt trình gần nhất có giá;");
  note("Thành tiền lũy kế = tổng thành tiền các đợt; KL còn lại = KL DT-CP − lũy kế khối lượng của mọi tổ đội cùng công việc. Đơn giá lũy kế chữ đỏ = vượt đơn giá DT-CP.");
  n++;
  const half = Math.max(5, Math.floor(nCols / 2));
  const sign = (c1: number, c2: number, title: string) => {
    ws.mergeCells(n, c1, n, c2);
    ws.mergeCells(n + 1, c1, n + 1, c2);
    const a = ws.getCell(n, c1);
    a.value = title;
    a.font = { name: FONT, size: 11, bold: true };
    a.alignment = { horizontal: "center" };
    const b = ws.getCell(n + 1, c1);
    b.value = "(Ký, ghi rõ họ tên)";
    b.font = { name: FONT, size: 9.5, italic: true, color: { argb: "FF595959" } };
    b.alignment = { horizontal: "center" };
  };
  sign(1, Math.min(4, half), "NGƯỜI LẬP");
  sign(half + 1, nCols, "KHỐI KINH TẾ - KẾ HOẠCH");

  const buf = await fixXlsx(await wb.xlsx.writeBuffer());
  const name = `Luy ke don gia doi - ${c.name}${c.contractNo ? ` - HD ${c.contractNo}` : ""}.xlsx`.replace(/[\\/:*?"<>|]/g, "-");
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
