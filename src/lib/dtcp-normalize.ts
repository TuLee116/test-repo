import type ExcelJS from "exceljs";
import { detectColumns, findHeader, norm, num, text, type ColMap, type ParsedLine, type SheetChoice } from "@/lib/hop-dong-excel";
import { lineKeyOf, type CostKind } from "@/lib/hop-dong-calc";

// "LÀM CHUẨN DT-CP CŨ 7 SHEET": lấy sheet DT-CP làm chuẩn, đi từng dòng chi phí:
//  - dòng link tới sheet NGOÀI 7 sheet cơ bản (hoặc sang TH khác loại) → copy chi tiết về TH đúng loại, đúng thứ tự
//  - dòng đã link đúng TH nhưng ở TH dòng đó chỉ có tổng (link ra sheet ngoài) → thay bằng đầu mục + chi tiết, tổng không đổi
//  - số cố định không link → giữ nguyên, CẢNH BÁO
// Hệ số `*1.08` trong công thức DT-CP KHÔNG nhân vào đơn giá: ghi vào cột VAT % (đơn giá / thành tiền giữ nguyên như sheet nguồn = trước VAT).

export type NormStatus = "ok" | "copied" | "converted" | "warn" | "fixed" | "lot";
export type NormRow = { dtRow: number; stt: string; name: string; kind: CostKind | null; status: NormStatus; message: string; dtAmount: number | null; got: number | null; lines: number; source: string };
export type NormResult = { lines: ParsedLine[]; report: NormRow[]; needSheets: string[] };
export type NormCtx = { dtcpSheet: string; choices: Partial<Record<CostKind, SheetChoice>>; lines: ParsedLine[]; approved: number; skipSheets?: string[] }; // skipSheets: DT-CP / BOQ / CHI TIẾT — link tới đây là hợp lệ, không copy

const TOL = (a: number) => Math.max(1000, Math.abs(a) * 0.0005);
const letters = (n: number) => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};
const colNum = (s: string) => [...s].reduce((t, ch) => t * 26 + ch.charCodeAt(0) - 64, 0);

type Cell = ExcelJS.Cell;
const fx = (c: Cell): string | null => {
  const v = c.value as unknown;
  if (v && typeof v === "object" && ("formula" in (v as object) || "sharedFormula" in (v as object))) {
    try {
      return ((c as unknown as { formula?: string }).formula ?? (v as { formula?: string }).formula ?? null) || null;
    } catch {
      return (v as { formula?: string }).formula ?? null;
    }
  }
  return null;
};
const val = (c: Cell): number | null => num(c);

type Ref = { sheet: string; col: number; row: number };
const REF = /(?:'((?:[^']|'')+)'|([A-Za-z0-9_.À-ỹ]+))!\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?/g;
function refsOf(f: string): Ref[] {
  const out: Ref[] = [];
  const s = f.replace(/"[^"]*"/g, '""');
  let m: RegExpExecArray | null;
  REF.lastIndex = 0;
  while ((m = REF.exec(s))) {
    const sheet = (m[1] ?? m[2] ?? "").replace(/''/g, "'");
    if (/^\[\d+\]/.test(sheet)) continue; // file ngoài
    // vùng (A1:B2) → từng ô đầu của vùng (hiếm gặp trong công thức DT-CP)
    out.push({ sheet, col: colNum(m[3]), row: Number(m[4]) });
  }
  return out;
}
const SUMRANGE = /^\s*\+?\s*(?:ROUND\(\s*)?(?:SUBTOTAL\(\s*\d+\s*,|SUM\()\s*\$?([A-Z]+)\$?(\d+)\s*:\s*\$?([A-Z]+)\$?(\d+)\s*\)\s*(?:,\s*-?\d\s*\))?\s*$/i;
const sumRange = (f: string | null) => {
  const m = f && SUMRANGE.exec(f);
  return m ? { c1: colNum(m[1]), r1: Number(m[2]), c2: colNum(m[3]), r2: Number(m[4]) } : null;
};
// Công thức "chỉ cộng các ô link" (kể cả nhân 1 hệ số VAT chung, bọc ROUND/SUM) → chi tiết các ô link cộng lại mới đúng giá trị
function isPureSum(f: string): boolean {
  let s = f.replace(/"[^"]*"/g, "");
  s = s.replace(/(?:'(?:[^']|'')+'|[A-Za-z0-9_.À-ỹ]+)!\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/g, "R").replace(/\$?[A-Z]{1,3}\$?\d+/g, "R");
  s = s.replace(/\*\s*\(?\s*1\.\d{1,4}\s*\)?/g, "").replace(/\*\s*\(\s*1\s*\+\s*\d+(?:\.\d+)?\s*%\s*\)/g, "");
  s = s.replace(/ROUND\(/gi, "(").replace(/,\s*-?\d\s*\)/g, ")").replace(/SUM\(/gi, "(");
  return /^[R+\-()\s]*$/.test(s) && s.includes("R");
}
const vatOf = (f: string): number | null => {
  const m = /\*\s*\(?\s*(1\.\d{1,4})\s*\)?(?![\d.])/.exec(f) ?? /\*\s*\(\s*1\s*\+\s*(\d+(?:\.\d+)?)\s*%\s*\)/.exec(f);
  if (!m) return null;
  const v = m[1].startsWith("1.") ? (Number(m[1]) - 1) * 100 : Number(m[1]);
  return Number.isFinite(v) && v > 0 && v < 30 ? Math.round(v * 100) / 100 : null;
};

type Leaf = { sheet: string; row: number; heading: boolean; stt: string; name: string; unit: string; qty: number | null; price: number | null; amount: number; note: string; ref?: string };
type Cols = { name: number; stt: number; unit: number; qty: number; price: number; note: number };

function sectionKind(name: string): CostKind | null {
  const n = norm(name);
  if (n.includes("THAU PHU")) return "TP";
  if (n.includes("NHAN CONG")) return "NC";
  if (n.includes("VAT TU") || n.includes("VAT LIEU")) return "VT";
  if (n.includes("THIET BI") || n.includes("MAY MOC")) return "TB";
  return null;
}

export function normalizeDtcp(wb: ExcelJS.Workbook, ctx: NormCtx): NormResult {
  const report: NormRow[] = [];
  const needSheets = new Set<string>();
  const dt = wb.getWorksheet(ctx.dtcpSheet);
  const thName = new Map<string, CostKind>(); // chuẩn hoá tên sheet TH → loại
  for (const [k, ch] of Object.entries(ctx.choices) as [CostKind, SheetChoice][]) if (ch?.sheet) thName.set(norm(ch.sheet), k);
  const kindOfSheet = (s: string) => thName.get(norm(s)) ?? null;
  const skipSet = new Set((ctx.skipSheets ?? []).map(norm));
  const sheetOf = (s: string) => wb.worksheets.find((w) => norm(w.name) === norm(s));

  const colsCache = new Map<string, Cols>();
  const colsOf = (ws: ExcelJS.Worksheet): Cols => {
    const hit = colsCache.get(ws.name);
    if (hit) return hit;
    const hr = findHeader(ws);
    const m: ColMap = detectColumns(ws, hr);
    let name = m.name ?? 0;
    if (!name) {
      const score: Record<number, number> = {};
      for (let r = 1; r <= Math.min(ws.rowCount, 40); r++)
        ws.getRow(r).eachCell((c, col) => {
          const t = text(c).trim();
          if (t.length >= 6 && num(c) == null) score[col] = (score[col] ?? 0) + 1;
        });
      name = Number(Object.entries(score).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 2);
    }
    const pk = Object.keys(m.prices).sort((a, b) => Number(b) - Number(a))[0];
    const c: Cols = { name, stt: m.stt ?? 1, unit: m.unit ?? 0, qty: m.qty ?? 0, price: pk != null ? m.prices[pk] : 0, note: m.note ?? 0 };
    colsCache.set(ws.name, c);
    return c;
  };

  // ---- 1 dòng của sheet → Leaf (hoặc tiêu đề) ----
  const rowText = (ws: ExcelJS.Worksheet, r: number, c: Cols) => {
    let name = text(ws.getCell(r, c.name)).replace(/\s+/g, " ").trim();
    if (!name) for (let x = 1; x < 6 && !name; x++) if (x !== c.stt) name = text(ws.getCell(r, x)).replace(/\s+/g, " ").trim();
    return name;
  };
  const leafOf = (ws: ExcelJS.Worksheet, r: number, col: number, c: Cols, heading: boolean): Leaf => ({
    sheet: ws.name,
    row: r,
    heading,
    stt: text(ws.getCell(r, c.stt)).trim(),
    name: rowText(ws, r, c),
    unit: c.unit ? text(ws.getCell(r, c.unit)).trim() : "",
    qty: c.qty ? val(ws.getCell(r, c.qty)) : null,
    price: c.price ? val(ws.getCell(r, c.price)) : null,
    amount: heading ? 0 : (val(ws.getCell(r, col)) ?? 0),
    note: c.note ? text(ws.getCell(r, c.note)).trim() : "",
  });

  // ---- Mở 1 ô thành các dòng chi tiết (theo công thức): tổng SUBTOTAL/SUM → các dòng trong vùng; link sang sheet khác → mở tiếp; còn lại = 1 dòng ----
  const expand = (sheet: string, row: number, col: number, depth: number, seen: Set<string>): Leaf[] => {
    const ws = sheetOf(sheet);
    if (!ws) {
      needSheets.add(sheet);
      return [];
    }
    const k = `${norm(ws.name)}!${col},${row}`;
    if (depth > 8 || seen.has(k)) return [];
    seen.add(k);
    const cols = colsOf(ws);
    const cell = ws.getCell(row, col);
    const f = fx(cell);
    const rg = sumRange(f);
    if (rg && rg.c1 === rg.c2) {
      const out: Leaf[] = [];
      for (let r = rg.r1; r <= rg.r2; r++) {
        const c = ws.getCell(r, rg.c1);
        const cf = fx(c);
        if (sumRange(cf)) {
          out.push(leafOf(ws, r, rg.c1, cols, true)); // dòng tổng phụ → tiêu đề nhóm (chi tiết nằm ở các dòng ngay sau)
          continue;
        }
        if (cf && isPureSum(cf) && refsOf(cf).some((x) => norm(x.sheet) !== norm(ws.name))) {
          const sub = expand(sheet, r, rg.c1, depth + 1, seen);
          if (sub.length) out.push({ ...leafOf(ws, r, rg.c1, cols, true) }, ...sub);
          continue;
        }
        const v = val(c);
        if (v == null) {
          if (rowText(ws, r, cols)) out.push(leafOf(ws, r, rg.c1, cols, true));
          continue;
        }
        if (v !== 0) out.push(leafOf(ws, r, rg.c1, cols, false));
      }
      return out;
    }
    if (f && isPureSum(f)) {
      const rs = refsOf(f).filter((x) => norm(x.sheet) !== norm(ws.name));
      if (rs.length) return rs.flatMap((x) => expand(x.sheet, x.row, x.col, depth + 1, seen));
      // chỉ cộng các ô cùng sheet (vd "Tổng sau thuế" = tổng + thuế) → mở từng ô
      const local = [...f.replace(/(?:'(?:[^']|'')+'|[A-Za-z0-9_.À-ỹ]+)!\$?[A-Z]{1,3}\$?\d+/g, "").matchAll(/\$?([A-Z]{1,3})\$?(\d+)/g)].map((m) => ({ col: colNum(m[1]), row: Number(m[2]) }));
      if (local.length && local.length <= 6 && !local.some((x) => x.row === row && x.col === col)) return local.flatMap((x) => expand(sheet, x.row, x.col, depth + 1, seen));
    }
    const pct = f ? /^\+?\s*\$?[A-Z]{1,3}\$?\d+\s*\*\s*(\d+(?:\.\d+)?)\s*%\s*$/.exec(f) : null;
    if (pct && norm(rowText(ws, row, cols)).includes("THUE")) {
      foundVat = Number(pct[1]);
      return [];
    }
    const v = val(cell);
    return v ? [leafOf(ws, row, col, cols, false)] : [];
  };
  let foundVat: number | null = null; // dòng "Thuế VAT n%" trong sheet nguồn: không copy thành dòng chi tiết mà ghi vào cột VAT %
  const sumLeaves = (ls: Leaf[]) => ls.filter((l) => !l.heading).reduce((t, l) => t + l.amount, 0);
  // bỏ tiêu đề không có dòng chi tiết đi kèm
  const trim = (ls: Leaf[]) => {
    const out: Leaf[] = [];
    for (let i = 0; i < ls.length; i++) if (!ls[i].heading || (ls[i + 1] && !ls[i + 1].heading) || (ls[i + 1]?.heading && ls.slice(i + 1).some((x) => !x.heading))) out.push(ls[i]);
    return out;
  };

  // ---- TH hiện có: dòng chỉ có tổng và tổng đó link ra sheet khác → cần mở chi tiết ----
  type Conv = { kind: CostKind; row: number; leaves: Leaf[]; ref: string; vat: number | null };
  const convs: Conv[] = [];
  const convSeen = new Set<string>();
  const scanTh = (kind: CostKind, sheet: string, row: number, col: number, vat: number | null, depth = 0) => {
    const ws = sheetOf(sheet);
    if (!ws || depth > 6) return;
    const key = `${kind}|${row}`;
    if (convSeen.has(key)) return;
    convSeen.add(key);
    const c = ws.getCell(row, col);
    const f = fx(c);
    const rg = sumRange(f);
    if (rg && rg.c1 === rg.c2) {
      for (let r = rg.r1; r <= rg.r2; r++) scanTh(kind, sheet, r, rg.c1, vat, depth + 1);
      return;
    }
    if (!f || !isPureSum(f)) return;
    const rs = refsOf(f).filter((x) => norm(x.sheet) !== norm(ws.name) && kindOfSheet(x.sheet) !== kind && !skipSet.has(norm(x.sheet)));
    if (!rs.length) return;
    foundVat = null;
    const leaves = trim(rs.flatMap((x) => expand(x.sheet, x.row, x.col, 0, new Set())));
    const vatEff = vat ?? foundVat;
    if (leaves.length) convs.push({ kind, row, leaves, vat: vatEff, ref: rs.map((x) => `${x.sheet}!${letters(x.col)}${x.row}`).join(" + ") });
  };

  // ---- DT-CP: từng dòng chi phí ----
  type Block = { kind: CostKind; stt: string; name: string; vat: number | null; leaves: Leaf[]; after: { kind: CostKind; row: number } | null; ref: string; rep: NormRow };
  const blocks: Block[] = [];
  if (!dt) return { lines: ctx.lines, report, needSheets: [] };
  const hr = findHeader(dt);
  const dm = detectColumns(dt, hr);
  const amountCol = dm.amount ?? 0;
  const sttCol = dm.stt ?? 1;
  const nameCol = dm.name ?? 2;
  let section: CostKind | null = null;
  const lastTh = new Map<CostKind, number>(); // dòng TH (cùng loại) mà DT-CP dòng trước đó đã trỏ tới → chèn khối mới ngay sau đó
  for (let r = hr + 1; r <= Math.min(dt.rowCount, 800) && amountCol; r++) {
    const stt = text(dt.getCell(r, sttCol)).trim();
    const name = text(dt.getCell(r, nameCol)).replace(/\s+/g, " ").trim();
    if (/^\d+$/.test(stt)) section = sectionKind(name);
    else if (/^[IVX]+$|^[A-Z]$/.test(stt)) section = null;
    if (!name) continue;
    const cell = dt.getCell(r, amountCol);
    const f = fx(cell);
    const dtAmount = val(cell);
    if (sumRange(f)) continue; // dòng tổng phụ của chính DT-CP
    const kindHere = section;
    const mk = (status: NormStatus, message: string, extra: Partial<NormRow> = {}): NormRow => ({ dtRow: r, stt, name, kind: kindHere, status, message, dtAmount, got: null, lines: 0, source: "", ...extra });
    if (!kindHere) continue;
    if (!f) {
      if (dtAmount && Math.abs(dtAmount) >= 1000) report.push(mk("warn", "Số cố định, không link sang sheet nào — phần mềm vẫn ghi nhận số này nhưng KHÔNG kiểm soát được chi tiết. Nên kiểm tra lại."));
      continue;
    }
    // số hạng nhân 0 (vd 'Chi tiết'!T918*0+500000000) = số cố định nhập kiểu công thức
    const live = f.replace(/\+?-?\s*(?:'[^']+'|[A-Za-z0-9_.À-ỹ]+)!\$?[A-Z]+\$?\d+\s*\*\s*0(?![\d.])/g, "");
    const skip = new Set((ctx.skipSheets ?? []).map(norm));
    const refs = refsOf(live).filter((x) => !skip.has(norm(x.sheet)));
    if (live !== f && !refs.length) {
      report.push(mk("warn", "Số cố định (công thức nhân 0 với link) — không kiểm soát được chi tiết. Nên kiểm tra lại."));
      continue;
    }
    if (!refs.length) {
      if (refsOf(f).length) continue; // chỉ link về DT-CP / BOQ / CHI TIẾT: hợp lệ
      if (!/[A-Z]+\d+/i.test(f.replace(/"[^"]*"/g, ""))) report.push(mk("warn", `Công thức tính cố định (=${f.slice(0, 40)}), không link sang sheet nào — kiểm tra lại.`));
      continue;
    }
    let vat = vatOf(f);
    const where = kindHere === "TP" ? "Thầu Phụ" : kindHere === "NC" ? "Nhân Công" : kindHere === "VT" ? "Vật Tư" : "Thiết Bị";
    const copyRefs = refs.filter((x) => kindOfSheet(x.sheet) !== kindHere);
    const sameRefs = refs.filter((x) => kindOfSheet(x.sheet) === kindHere);
    const afterOf = () => (lastTh.has(kindHere) ? { kind: kindHere, row: lastTh.get(kindHere)! } : null);
    const srcOf = (x: Ref) => `${x.sheet}!${letters(x.col)}${x.row}`;

    // Công thức có phần tính thêm (nhân %, chia, IF...) → không tách chi tiết được: giữ 1 dòng khoán gọn đúng giá trị DT-CP, cảnh báo
    if (!isPureSum(live)) {
      const rep = mk("lot", `Công thức DT-CP có phần tính toán thêm (=${f.slice(0, 60)}${f.length > 60 ? "…" : ""}) nên không tự tách chi tiết được — giữ 1 dòng khoán gọn theo đúng giá trị DT-CP. Cần xử lý tay nếu muốn có chi tiết.`, { got: dtAmount, lines: 1, source: refs.map(srcOf).join(" + ") });
      if (dtAmount) blocks.push({ kind: kindHere, stt, name, vat: null, leaves: [{ sheet: "", row: r, heading: false, stt: "", name, unit: "", qty: null, price: null, amount: dtAmount, note: `Khoán gọn — công thức DT-CP: ${f.slice(0, 80)}` }], after: afterOf(), ref: "", rep });
      report.push(rep);
      continue;
    }

    let gotTotal = 0;
    let converted = 0;
    let copied = 0;
    let warn = "";
    const sources: string[] = [];
    // (a) phần đã link đúng TH cùng loại: chỉ xem TH có dòng chỉ-có-tổng link ra ngoài không
    for (const x of sameRefs) {
      const before = convs.length;
      scanTh(kindHere, x.sheet, x.row, x.col, vat);
      const added = convs.slice(before);
      const cellV = val(sheetOf(x.sheet)?.getCell(x.row, x.col) as Cell) ?? 0;
      if (added.length) {
        const g = added.reduce((t, c) => t + sumLeaves(c.leaves), 0);
        converted += added.reduce((t, c) => t + c.leaves.filter((l) => !l.heading).length, 0);
        gotTotal += g;
        sources.push(...added.map((c) => c.ref));
        if (Math.abs(g - cellV) > TOL(cellV)) warn += ` Mở chi tiết ${srcOf(x)} nhưng lệch ${Math.round(g - cellV).toLocaleString("vi-VN")} đ so với tổng ở TH.`;
      } else gotTotal += cellV;
      const thCell = sheetOf(x.sheet)?.getCell(x.row, x.col);
      const rg = thCell ? sumRange(fx(thCell)) : null;
      lastTh.set(kindHere, rg ? rg.r2 : x.row);
    }
    // (b) phần link sheet ngoài / TH khác loại → copy chi tiết về TH đúng loại
    if (copyRefs.length) {
      const leaves: Leaf[] = [];
      let srcVat: number | null = null;
      for (const x of copyRefs) {
        const sheetWs = sheetOf(x.sheet);
        if (!sheetWs) {
          needSheets.add(x.sheet);
          continue;
        }
        foundVat = null;
        const part = trim(expand(x.sheet, x.row, x.col, 0, new Set()));
        if (foundVat != null) srcVat = foundVat;
        const want = (val(sheetWs.getCell(x.row, x.col)) ?? 0) / (1 + ((foundVat as number | null) ?? 0) / 100); // ô nguồn đã gồm VAT → so với chi tiết trước VAT
        const got = sumLeaves(part);
        sources.push(srcOf(x));
        if (copyRefs.length > 1 && part.length) leaves.push({ sheet: x.sheet, row: x.row, heading: true, stt: "", name: rowText(sheetWs, x.row, colsOf(sheetWs)) || x.sheet, unit: "", qty: null, price: null, amount: 0, note: "", ref: srcOf(x) });
        leaves.push(...part);
        if (Math.abs(want - got) > TOL(want)) {
          leaves.push({ sheet: x.sheet, row: x.row, heading: false, stt: "", name: "Chênh lệch chưa rõ nguồn (tổng sheet nguồn − chi tiết đọc được)", unit: "", qty: null, price: null, amount: want - got, note: srcOf(x) });
          warn += ` ${srcOf(x)}: có phần chênh lệch chưa tách được chi tiết.`;
        }
      }
      if (vat == null && srcVat != null) vat = srcVat; // sheet nguồn có dòng Thuế VAT n% → ghi vào cột VAT %
      if (leaves.length) {
        copied = leaves.filter((l) => !l.heading).length;
        gotTotal += sumLeaves(leaves);
        const rep0 = mk("copied", "", {});
        blocks.push({ kind: kindHere, stt, name, vat, leaves, after: afterOf(), ref: sources.join(" + "), rep: rep0 });
      } else if (dtAmount) {
        // không đọc được chi tiết: khoán gọn đúng giá trị DT-CP
        const rep0 = mk("lot", "", {});
        blocks.push({ kind: kindHere, stt, name, vat: null, leaves: [{ sheet: "", row: r, heading: false, stt: "", name, unit: "", qty: null, price: null, amount: dtAmount, note: `Khoán gọn — nguồn ${copyRefs.map(srcOf).join(" + ")}` }], after: afterOf(), ref: "", rep: rep0 });
        gotTotal += dtAmount / (1 + (vat ?? 0) / 100);
        warn += " Không đọc được chi tiết ở sheet nguồn — giữ 1 dòng khoán gọn.";
      }
    }
    const total = gotTotal * (1 + (vat ?? 0) / 100);
    if (dtAmount != null && Math.abs(total - dtAmount) > TOL(dtAmount)) warn += ` Tổng chi tiết ${Math.round(total).toLocaleString("vi-VN")} lệch giá trị DT-CP ${Math.round(dtAmount).toLocaleString("vi-VN")}.`;
    const parts = [copied ? `Copy ${copied} dòng chi tiết từ sheet nguồn vào TH ${where}${vat ? `, VAT ${vat}%` : ""}.` : "", converted ? `TH chỉ có dòng tổng → mở ${converted} dòng chi tiết từ sheet nguồn${vat ? `, VAT ${vat}%` : ""}.` : "", !copied && !converted ? "Đã link đúng sheet TH và có chi tiết." : ""].filter(Boolean);
    const rep = mk(warn ? "warn" : copied ? "copied" : converted ? "converted" : "ok", `${parts.join(" ")}${warn}`, { got: total, lines: copied + converted, source: sources.join(" + ") || refs.map(srcOf).join(" + ") });
    for (const b of blocks) if (b.rep.dtRow === r) b.rep = rep;
    report.push(rep);
  }

  // ---- Ghép vào danh sách dòng ----
  const out: ParsedLine[] = [...ctx.lines];
  const approvedKey = String(ctx.approved || 0);
  const seenKey = new Set(out.map((l) => `${l.kind}|${l.key}`));
  const uniq = (kind: CostKind, name: string, unit: string) => {
    let key = lineKeyOf(name, unit);
    let n = 1;
    while (seenKey.has(`${kind}|${key}`)) key = `${lineKeyOf(name, unit)}#${++n}`;
    seenKey.add(`${kind}|${key}`);
    return key;
  };
  const toLines = (kind: CostKind, stt: string, name: string, vat: number | null, leaves: Leaf[], srcRow: number): ParsedLine[] => {
    const ls: ParsedLine[] = [{ kind, key: uniq(kind, `#norm-${stt}-${name}`, ""), level: "SUB", stt, name, unit: "", qty: null, prices: {}, amount: null, note: "Chuẩn hoá từ DT-CP cũ", sourceRow: srcRow, vatPct: vat }];
    let n = 0;
    for (const l of leaves) {
      if (l.heading) {
        ls.push({ kind, key: uniq(kind, `#norm-h-${l.name}`, ""), level: "SUB", stt: l.stt, name: l.name || "(không tên)", unit: "", qty: null, prices: {}, amount: null, note: l.ref ? `Nguồn ${l.ref}` : "", sourceRow: srcRow, vatPct: vat });
        continue;
      }
      const hasPrice = l.price != null && l.qty != null;
      ls.push({
        kind,
        key: uniq(kind, l.name, l.unit),
        level: "ITEM",
        stt: l.stt || String(++n),
        name: l.name || "(không tên)",
        unit: l.unit,
        qty: hasPrice ? l.qty : null,
        prices: hasPrice ? { [approvedKey]: l.price as number } : {},
        amount: l.amount,
        note: [l.note, l.sheet ? `Từ sheet "${l.sheet}" dòng ${l.row}` : ""].filter(Boolean).join(" · "),
        sourceRow: srcRow,
        vatPct: vat,
      });
    }
    return ls;
  };
  const idxAfterRow = (kind: CostKind, row: number) => {
    let at = -1;
    out.forEach((l, i) => l.kind === kind && l.sourceRow > 0 && l.sourceRow <= row && (at = i)); // dòng mới chuẩn hoá có sourceRow = 0 → không tính
    return at;
  };
  // 1) dòng TH chỉ-có-tổng → đầu mục + chi tiết (thay dòng đó thành đầu mục, chi tiết ngay sau)
  for (const c of convs) {
    const i = out.findIndex((l) => l.kind === c.kind && l.sourceRow === c.row);
    if (i < 0) continue;
    const cur = out[i];
    const kids = toLines(c.kind, "", "", c.vat, c.leaves, cur.sourceRow).slice(1);
    out[i] = { ...cur, level: "SUB", qty: null, prices: {}, amount: null, vatPct: c.vat, note: [cur.note, `Chi tiết lấy từ ${c.ref}`].filter(Boolean).join(" · ") };
    out.splice(i + 1, 0, ...kids);
  }
  // 2) khối chi tiết mới (DT-CP link sheet ngoài) → ngay sau dòng TH của mục trước đó trong DT-CP
  const cursor = new Map<CostKind, number>();
  for (const b of blocks) {
    const first = out.findIndex((l) => l.kind === b.kind);
    let at = cursor.get(b.kind) ?? (b.after ? idxAfterRow(b.kind, b.after.row) : -1);
    if (at < 0) at = out.reduce((t, l, i) => (l.kind === b.kind ? i : t), first >= 0 ? first : out.length - 1); // chưa có mục trước: cuối TH
    const add = toLines(b.kind, b.stt, b.name, b.vat, b.leaves, 0);
    out.splice(at + 1, 0, ...add);
    cursor.set(b.kind, at + add.length);
  }
  return { lines: out, report, needSheets: [...needSheets] };
}
