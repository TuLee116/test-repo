"use server";

import { putFile } from "@/lib/file-store";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/friendly-error";
import { slimXlsx } from "@/lib/xlsx-slim";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { canPrice, canSeePrice, CATEGORIES, getPriceUser, inPriceAreas, KIND_LABEL, logPrice, nextPriceCode, releasePriceFile } from "@/lib/gia-doi";
import { parsePriceWorkbook, type ParsedLine, type ParsedSheet } from "@/lib/gia-doi-excel";
import { autoMatchLines } from "@/lib/hop-dong";
import { loadSites, siteFromName } from "@/lib/project-site";

// NHẬP HỒ SƠ GIÁ ĐỘI CŨ ĐÃ DUYỆT (các đợt duyệt trước khi có phần mềm): mỗi sheet của file = 1 đợt.
// Giá duyệt từng dòng: cột "Đơn giá" của P.ĐT-TT nếu có; không có thì lấy giá BCH (công trình) đề xuất.
// Dòng được coi là ĐÃ DUYỆT khi có dấu hiệu duyệt: có đơn giá P.ĐT-TT, ý kiến Đồng ý / Điều chỉnh, hoặc có thành tiền duyệt.
// Dòng không có dấu hiệu (dòng phân tích con, "chưa có PMI trình sau"...) chỉ lưu ở hồ sơ, không vào sổ giá.

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });

const isNo = (s: string) => /kh[oô]ng\s*(đ[oồ]ng\s*[yý]|duy[eệ]t)|khong dong y/i.test(s);
const isYes = (s: string) => /đ[oồ]ng\s*[yý]|dong y|đi[eềể]u ch[iỉ]nh|dieu chinh/i.test(s);

// giá duyệt của 1 dòng trong file cũ (null = dòng không có kết quả duyệt)
function oldApproval(kind: string, l: ParsedLine): { ok: boolean; price: number | null } {
  if (kind === "OUT" || l.ptOpinion || l.ptPrice != null || l.ptAmount != null) {
    if (isNo(l.ptOpinion)) return { ok: false, price: null };
    if (l.ptPrice != null && l.ptPrice > 0) return { ok: true, price: l.ptPrice };
    if (isYes(l.ptOpinion) || (l.ptAmount ?? 0) > 0) {
      const p = l.sitePrice ?? (l.ptAmount && l.qty ? l.ptAmount / l.qty : null);
      return p != null && p > 0 ? { ok: true, price: p } : { ok: false, price: null };
    }
    return { ok: false, price: null };
  }
  // mẫu không có khối P.ĐT-TT: lấy giá BCH (công trình) đề xuất
  if (isNo(l.siteOpinion)) return { ok: false, price: null };
  if (isYes(l.siteOpinion) || (l.siteAmount ?? 0) > 0) {
    const p = l.sitePrice ?? l.basePrice;
    return p != null && p > 0 ? { ok: true, price: p } : { ok: false, price: null };
  }
  return { ok: false, price: null };
}

// ngày duyệt gợi ý từ tên sheet "28.10.26", "15.7.26", "11.09" (thiếu năm → năm của sheet có năm gần nhất / năm nay)
function dateFromName(name: string, fallbackYear: number): string {
  const m = name.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/);
  if (!m) return "";
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = m[3] ? Number(m[3]) : fallbackYear;
  if (y < 100) y += 2000;
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return "";
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

async function readFile(form: FormData): Promise<{ name: string; buf: ArrayBuffer; sheets: ParsedSheet[] } | string> {
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return "Chưa chọn file Excel";
  if (!/\.xlsx$/i.test(file.name)) return "Chỉ nhận file Excel .xlsx (file .xls cũ: mở bằng Excel rồi Lưu thành .xlsx)";
  if (file.size > MAX_UPLOAD_BYTES) return `File quá lớn (tối đa ${MAX_UPLOAD_MB}MB) — xoá ảnh / sheet không cần rồi lưu file mới`;
  const buf = await file.arrayBuffer();
  try {
    const sheets = await parsePriceWorkbook(buf);
    if (!sheets.length) return "Không thấy bảng đề xuất đơn giá nào có dữ liệu (cần đúng mẫu: dòng tiêu đề STT | NỘI DUNG | ĐVT ...)";
    return { name: file.name, buf, sheets };
  } catch {
    return "Không đọc được file Excel (file hỏng hoặc không phải .xlsx)";
  }
}

async function needQs() {
  const u = await getPriceUser();
  if (!u) return null;
  if (!canSeePrice(u) || !canPrice(u, "QSTT")) return null;
  return u;
}

export type OldSheetInfo = { sheetName: string; kind: string; kindLabel: string; items: number; approved: number; total: number; date: string; batch: string };

// Bước 1: đọc file, liệt kê các sheet (đợt) + số dòng đã duyệt + ngày duyệt gợi ý
export async function analyzeOldPriceAction(form: FormData): Promise<R<{ sheets: OldSheetInfo[] }>> {
  if (!(await needQs())) return fail("Chỉ QSTT / quản trị được nhập hồ sơ cũ");
  const f = await readFile(form);
  if (typeof f === "string") return fail(f);
  const years = f.sheets.map((s) => s.sheetName.match(/\d{1,2}[./-]\d{1,2}[./-](\d{2,4})/)?.[1]).filter(Boolean).map((y) => (Number(y) < 100 ? Number(y) + 2000 : Number(y)));
  const fallbackYear = years[0] ?? new Date().getFullYear();
  return {
    ok: true,
    sheets: f.sheets.map((s) => {
      const items = s.lines.filter((l) => l.level === "ITEM");
      const ap = items.map((l) => ({ l, a: oldApproval(s.kind, l) })).filter((x) => x.a.ok);
      return {
        sheetName: s.sheetName,
        kind: s.kind,
        kindLabel: KIND_LABEL[s.kind] ?? s.kind,
        items: items.length,
        approved: ap.length,
        total: ap.reduce((t, x) => t + (x.l.qty ?? 0) * (x.a.price ?? 0), 0),
        date: dateFromName(s.sheetName, fallbackYear),
        batch: s.head.batch || `Đợt ${s.sheetName.trim()}`,
      };
    }),
  };
}

export type OldSheetConfig = { sheetName: string; date: string; crew: string; batch: string; reviewer: string };

// Bước 2: ghi nhận các sheet được chọn thành hồ sơ ĐÃ DUYỆT + ghi giá vào sổ giá hợp đồng (hiệu lực từ ngày duyệt)
export async function importOldPriceAction(form: FormData): Promise<R<{ count: number; prices: number }>> {
  const u = await needQs();
  if (!u) return fail("Chỉ QSTT / quản trị được nhập hồ sơ cũ");
  const contractId = String(form.get("contractId") || "");
  const category = String(form.get("category") || "");
  let cfg: OldSheetConfig[] = [];
  try {
    cfg = JSON.parse(String(form.get("config") || "[]"));
  } catch {
    return fail("Dữ liệu cấu hình không hợp lệ");
  }
  if (!contractId) return fail("Chọn hợp đồng (DT-CP) của hồ sơ");
  if (!cfg.length) return fail("Chưa chọn đợt (sheet) nào để nhập");
  if (category && !CATEGORIES.some((c) => c.value === category)) return fail("Hạng mục không hợp lệ");
  const contract = await prisma.costContract.findUnique({ where: { id: contractId }, select: { id: true, area: true } });
  if (!contract) return fail("Không tìm thấy hợp đồng");
  if (!inPriceAreas(u, contract.area)) return fail("Hợp đồng thuộc khu vực ngoài phạm vi làm việc của bạn");
  for (const c of cfg) if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date)) return fail(`Sheet "${c.sheetName}": chưa nhập ngày duyệt`);

  const f = await readFile(form);
  if (typeof f === "string") return fail(f);
  let count = 0;
  let prices = 0;
  let first = "";
  const slimBuf = await slimXlsx(f.buf, cfg.map((c) => c.sheetName)); // chỉ lưu các sheet được nhập, bỏ hình ảnh
  try {
    const sites = await loadSites();
    for (const c of cfg) {
      const sh = f.sheets.find((s) => s.sheetName === c.sheetName);
      if (!sh) return fail(`Không thấy sheet "${c.sheetName}" trong file`);
      const at = new Date(`${c.date}T08:00:00+07:00`);
      const reviewer = c.reviewer.trim() || "(hồ sơ cũ)";
      const code = await nextPriceCode();
      const sub = await prisma.priceSubmission.create({
        data: {
          code,
          kind: sh.kind,
          ...sh.head,
          ...siteFromName(sh.head.projectName, sites),
          batch: c.batch.trim() || sh.head.batch,
          crewName: c.crew.trim(),
          contractId,
          category,
          imported: true,
          status: "APPROVED",
          qsNote: "Nhập từ hồ sơ cũ đã duyệt",
          fileName: f.name,
          ...(first ? { fileFromId: first } : { fileKey: await putFile(slimBuf) }), // file gốc ở KHO FILE
          sheetName: sh.sheetName,
          colMap: JSON.stringify(sh.colMap),
          headRows: JSON.stringify(sh.headRows),
          createdById: u.id,
          createdByName: u.name,
          submittedAt: at,
          reviewedByName: reviewer,
          reviewedAt: at,
          mailSentAt: at, // không nhắc gửi mail
          lines: {
            create: sh.lines.map((l, i) => {
              const a = l.level === "ITEM" ? oldApproval(sh.kind, l) : { ok: true, price: null };
              return {
                ...l,
                orderIndex: i,
                tpOk: a.ok,
                tpPrice: a.ok ? a.price : null,
                tpNote: l.level === "ITEM" && !a.ok ? (isNo(l.ptOpinion) || isNo(l.siteOpinion) ? "Không duyệt (theo hồ sơ cũ)" : "Không có kết quả duyệt trong hồ sơ cũ") : l.ptNote,
              };
            }),
          },
        },
      });
      first ||= sub.id;
      await autoMatchLines(sub.id, contractId);
      const lines = await prisma.priceLine.findMany({ where: { submissionId: sub.id, level: "ITEM", tpOk: true, tpPrice: { gt: 0 } } });
      await prisma.approvedPrice.createMany({
        data: lines.map((l) => ({
          contractId,
          lineKey: l.lineKey,
          name: l.content,
          unit: l.unit,
          crew: sub.crewName,
          price: l.tpPrice!,
          qty: l.qty,
          approvedAt: at,
          approvedByName: reviewer,
          submissionId: sub.id,
          submissionCode: sub.code,
          revision: 1,
          batch: sub.batch,
        })),
      });
      await logPrice(sub.id, "Nhập hồ sơ cũ ĐÃ DUYỆT, ghi giá vào sổ giá hợp đồng", u.name, `${f.name} — sheet "${sh.sheetName}", duyệt ngày ${c.date} (${reviewer}), ${lines.length} dòng giá`);
      count++;
      prices += lines.length;
    }
  } catch (e) {
    console.error(e);
    return fail(`Lỗi khi ghi nhận (đã nhập ${count} đợt trước đó): ${e instanceof Error ? e.message : ""}`);
  }
  revalidatePath("/gia-doi", "layout");
  return { ok: true, count, prices };
}

// Xoá hồ sơ cũ nhập nhầm: gỡ luôn giá đã ghi vào sổ
export async function deleteImportedPriceAction(id: string): Promise<R> {
  if (!(await needQs())) return fail("Chỉ QSTT / quản trị được xoá hồ sơ nhập cũ");
  const s = await prisma.priceSubmission.findUnique({ where: { id }, select: { imported: true } });
  if (!s) return fail("Không tìm thấy hồ sơ");
  if (!s.imported) return fail("Chỉ xoá được hồ sơ nhập từ hồ sơ cũ");
  await prisma.approvedPrice.deleteMany({ where: { submissionId: id } });
  await releasePriceFile(id);
  await prisma.priceSubmission.delete({ where: { id } });
  await prisma.procLog.deleteMany({ where: { entity: "GIA", entityId: id } });
  revalidatePath("/gia-doi", "layout");
  return { ok: true };
}
