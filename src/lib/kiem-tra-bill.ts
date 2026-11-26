"use server";

import type ExcelJS from "exceljs";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/friendly-error";
import { prisma } from "@/lib/prisma";
import { canSeePrice, getPriceUser, inPriceAreas } from "@/lib/gia-doi";
import { approvedPriceOf } from "@/lib/gia-doi-calc";
import { lineKeyOf, normText } from "@/lib/hop-dong-calc";
import { parsePastedNumber } from "@/lib/parse-number";
import { listSheets, loadSheets, openZip, XlsxTooBigError } from "@/lib/xlsx-subset";

// KIỂM TRA BILL ĐỘI — chỉ hỗ trợ QSTT kiểm nhanh: đọc file Bill, so 3 yếu tố (nội dung, ĐVT, đơn giá) với sổ giá duyệt + hồ sơ đang trình TP
// của hợp đồng. KHÔNG lưu gì: file chỉ đọc trong bộ nhớ rồi bỏ, kết quả chỉ trả về màn hình.

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
class BillError extends Error {}
const fail = (m: string): never => {
  throw new BillError(m);
};
async function run<T extends object>(fn: () => Promise<T>): Promise<R<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof BillError || e instanceof XlsxTooBigError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Lỗi hệ thống, thử lại hoặc báo quản trị." };
  }
}
async function need() {
  const u = await getPriceUser();
  if (!u) return fail("Chưa đăng nhập");
  if (!canSeePrice(u!)) return fail("Bạn chưa được phân quyền Trình giá tổ đội");
  return u!;
}
async function fileOf(form: FormData): Promise<ArrayBuffer> {
  const f = form.get("file");
  if (!(f instanceof File) || !f.size) return fail("Chưa chọn file Excel Bill");
  const file = f as File;
  if (!/\.xlsx$/i.test(file.name)) return fail("Chỉ nhận file .xlsx (file .xls cũ: mở bằng Excel rồi Lưu thành .xlsx)");
  if (file.size > MAX_UPLOAD_BYTES) return fail(`File quá lớn (tối đa ${MAX_UPLOAD_MB}MB)`);
  return file.arrayBuffer();
}

function text(c: ExcelJS.Cell): string {
  const v = c.value as unknown;
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as { richText?: { text: string }[]; result?: unknown; text?: string };
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if ("result" in o) return o.result == null || typeof o.result === "object" ? "" : String(o.result);
    if (o.text) return o.text;
    if (v instanceof Date) return v.toLocaleDateString("vi-VN");
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
    return typeof r === "number" && Number.isFinite(r) ? r : typeof r === "string" ? parsePastedNumber(r) : null;
  }
  return parsePastedNumber(text(c));
}
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

// ---- Bước 1: danh sách sheet (chỉ sheet hiện) ----
export async function billSheetsAction(form: FormData) {
  return run(async () => {
    await need();
    const buf = await fileOf(form);
    const zip = await openZip(buf);
    const sheets = (await listSheets(zip)).filter((s) => s.state === "visible").map((s) => s.name);
    if (!sheets.length) fail("File không có sheet nào đang hiện");
    return { sheets };
  });
}

// ---- Bước 2: xem trước 1 sheet + đoán cột ----
export type BillPreview = {
  maxCol: number;
  rows: { row: number; cells: string[] }[]; // 40 dòng đầu (bỏ dòng ẩn)
  guess: { nameCol: number; unitCol: number; priceCol: number; startRow: number };
};
const HEAD_NAME = /^(noi dung|ten cong viec|cong tac|cong viec|dien giai|hang muc|ten hang muc|noi dung cong viec)/;
const HEAD_UNIT = /^(dvt|don vi|don vi tinh)$/;
const HEAD_PRICE = /^(don gia|d gia|dg)/;

export async function billPreviewAction(form: FormData, sheet: string) {
  return run(async () => {
    await need();
    const buf = await fileOf(form);
    const wb = await loadSheets(buf, [sheet]);
    const ws = wb.getWorksheet(sheet);
    if (!ws) return fail("Không thấy sheet trong file");
    const sh = ws!;
    const maxCol = Math.min(Math.max(sh.columnCount, 6), 30);
    const rows: BillPreview["rows"] = [];
    const guess = { nameCol: 0, unitCol: 0, priceCol: 0, startRow: 1 };
    let headerRow = 0;
    const last = Math.min(sh.rowCount, 60);
    for (let r = 1; r <= last; r++) {
      const row = sh.getRow(r);
      if (row.hidden) continue;
      const cells: string[] = [];
      for (let c = 1; c <= maxCol; c++) cells.push(sh.getColumn(c).hidden ? "" : clean(text(row.getCell(c))).slice(0, 70));
      if (rows.length < 40) rows.push({ row: r, cells });
      // đoán dòng tiêu đề: dòng có ô "NỘI DUNG" (hoặc tương tự); đơn giá có thể nằm ở dòng tiêu đề tầng 2
      if (!headerRow) {
        const names = cells.map((x) => normText(x));
        const n = names.findIndex((x) => HEAD_NAME.test(x));
        if (n >= 0) {
          headerRow = r;
          guess.nameCol = n + 1;
          const u = names.findIndex((x) => HEAD_UNIT.test(x));
          if (u >= 0) guess.unitCol = u + 1;
        }
      }
      if (headerRow && r >= headerRow && r <= headerRow + 2 && !guess.priceCol) {
        const p = cells.findIndex((x) => HEAD_PRICE.test(normText(x)));
        if (p >= 0) guess.priceCol = p + 1;
      }
      if (headerRow && !guess.unitCol && r <= headerRow + 2) {
        const u = cells.findIndex((x) => HEAD_UNIT.test(normText(x)));
        if (u >= 0) guess.unitCol = u + 1;
      }
    }
    if (headerRow) guess.startRow = headerRow + 1;
    return { preview: { maxCol, rows, guess } satisfies BillPreview };
  });
}

// ---- Bước 3: kiểm tra ----
export type BillStatus = "MATCH" | "DIFF" | "PENDING" | "NONE";
export type BillResult = {
  row: number;
  name: string;
  unit: string;
  price: number;
  status: BillStatus;
  approved: { price: number; date: string; code: string }[]; // giá đã duyệt tìm thấy (đang hiệu lực)
  pending: { price: number; code: string; revision: number }[]; // giá trong hồ sơ đã trình Trưởng phòng, chưa duyệt
  matchedName: string; // tên công tác trong sổ giá / hồ sơ mà phần mềm khớp
};
export type BillCheck = { results: BillResult[]; skipped: number; sheet: string };
export type BillParams = { contractId: string; sheet: string; nameCol: number; unitCol: number; priceCol: number; startRow: number };

const PRICE_TOL = 0.5; // đồng
const FUZZY_COST = 0.6; // khớp dòng DT-CP (giống tự khớp ở hồ sơ)
const FUZZY_NAME = 0.75; // khớp tên trực tiếp với sổ giá / hồ sơ (chặt hơn để không khớp nhầm)

const tokens = (s: string) => new Set(normText(s).split(" ").filter((w) => w.length > 1));
function dice(A: Set<string>, B: Set<string>) {
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return (2 * common) / (A.size + B.size);
}
const fd = (d: Date) => d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

type Item = { name: string; unitN: string; nk: string; tok: Set<string>; lineKey: string };

export async function billCheckAction(form: FormData, p: BillParams) {
  return run(async () => {
    const u = await need();
    const contract = await prisma.costContract.findUnique({ where: { id: p.contractId }, select: { id: true, area: true } });
    if (!contract) return fail("Không thấy hợp đồng");
    if (!inPriceAreas(u, contract!.area)) return fail("Hợp đồng không thuộc khu vực của bạn");
    if (!p.nameCol || !p.priceCol) return fail("Chọn cột Nội dung và cột Đơn giá");
    const buf = await fileOf(form);
    const wb = await loadSheets(buf, [p.sheet]);
    const ws = wb.getWorksheet(p.sheet);
    if (!ws) return fail("Không thấy sheet trong file");
    const sh = ws!;

    const now = new Date();
    const [costLines, approvals, subs] = await Promise.all([
      prisma.costLine.findMany({ where: { contractId: p.contractId, kind: "NC", level: "ITEM" }, select: { key: true, name: true, unit: true } }),
      prisma.approvedPrice.findMany({ where: { contractId: p.contractId, kind: "NC", approvedAt: { lte: now } }, orderBy: { approvedAt: "desc" } }),
      // chỉ hồ sơ ĐÃ TRÌNH Trưởng phòng (SUBMITTED), bỏ hồ sơ đã có lần trình sau thay thế
      prisma.priceSubmission.findMany({ where: { contractId: p.contractId, status: "SUBMITTED" }, include: { lines: { where: { level: "ITEM" } } } }),
    ]);
    const replaced = new Set(
      (await prisma.priceSubmission.findMany({ where: { contractId: p.contractId, parentId: { not: null } }, select: { parentId: true } })).map((x) => x.parentId as string),
    );

    const mk = (name: string, unit: string, lineKey: string): Item => ({ name, unitN: normText(unit), nk: lineKeyOf(name, unit), tok: tokens(name), lineKey });
    const costItems = costLines.map((c) => ({ ...mk(c.name, c.unit, c.key) }));
    const apItems = approvals.map((a) => ({ it: mk(a.name, a.unit, a.lineKey), price: a.price, date: fd(a.approvedAt), code: a.submissionCode }));
    const pdItems: { it: Item; price: number; code: string; revision: number }[] = [];
    for (const s of subs) {
      if (replaced.has(s.id)) continue;
      for (const l of s.lines) {
        if (!l.tpOk) continue; // Trưởng phòng đã bỏ dòng này
        const price = approvedPriceOf(s.kind, l);
        if (price == null || !l.content.trim()) continue;
        pdItems.push({ it: mk(l.content, l.unit, l.lineKey === "-" ? "" : l.lineKey), price, code: s.code, revision: s.revision });
      }
    }

    const results: BillResult[] = [];
    let skipped = 0;
    for (let r = Math.max(1, p.startRow || 1); r <= sh.rowCount; r++) {
      const row = sh.getRow(r);
      if (row.hidden) continue;
      const name = clean(text(row.getCell(p.nameCol)));
      const unit = p.unitCol ? clean(text(row.getCell(p.unitCol))) : "";
      const price = num(row.getCell(p.priceCol));
      if (!name || price == null) {
        if (name) skipped++; // có tên nhưng không có đơn giá (dòng nhóm / ghi chú)
        continue;
      }
      const bill = mk(name, unit, "");
      const unitOk = (x: Item) => !bill.unitN || !x.unitN || x.unitN === bill.unitN;
      // dòng DT-CP tương ứng (để lấy giá duyệt / hồ sơ ghi theo dòng DT-CP dù tên viết khác)
      let lk = "";
      const exact = costItems.find((c) => c.nk === bill.nk);
      if (exact) lk = exact.lineKey;
      else {
        let best = 0;
        for (const c of costItems) {
          if (!unitOk(c)) continue;
          const s = dice(bill.tok, c.tok);
          if (s >= FUZZY_COST && s > best) {
            best = s;
            lk = c.lineKey;
          }
        }
      }
      const same = (x: Item) => x.nk === bill.nk || (!!lk && x.lineKey === lk) || (unitOk(x) && dice(bill.tok, x.tok) >= FUZZY_NAME);

      const ap = apItems.filter((a) => same(a.it));
      const pd = pdItems.filter((a) => same(a.it));
      const approved: BillResult["approved"] = [];
      for (const a of ap) if (!approved.some((x) => Math.abs(x.price - a.price) <= PRICE_TOL && x.code === a.code)) approved.push({ price: a.price, date: a.date, code: a.code });
      const pending: BillResult["pending"] = [];
      for (const a of pd) if (!pending.some((x) => Math.abs(x.price - a.price) <= PRICE_TOL && x.code === a.code)) pending.push({ price: a.price, code: a.code, revision: a.revision });

      const hit = (x: { price: number }) => Math.abs(x.price - price) <= PRICE_TOL;
      let status: BillStatus;
      if (approved.some(hit)) status = "MATCH";
      else if (pending.some(hit)) status = "PENDING"; // giá Bill đang nằm trong hồ sơ chờ duyệt
      else if (approved.length) status = "DIFF";
      else if (pending.length) status = "PENDING";
      else status = "NONE";
      const matchedName = (ap[0]?.it.name ?? pd[0]?.it.name) || "";
      results.push({ row: r, name, unit, price, status, approved: approved.slice(0, 4), pending: pending.slice(0, 4), matchedName: matchedName === name ? "" : matchedName });
    }
    if (!results.length) fail("Không đọc được dòng nào có Nội dung + Đơn giá — kiểm tra lại cột / dòng bắt đầu đã chọn");
    return { check: { results, skipped, sheet: p.sheet } satisfies BillCheck };
  });
}
