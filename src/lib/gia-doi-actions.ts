"use server";

import { putFile } from "@/lib/file-store";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/friendly-error";
import { slimXlsx } from "@/lib/xlsx-slim";
import { revalidatePath } from "next/cache";
import { loadSites, siteFields, siteFromName, SITE_MISSING } from "@/lib/project-site";
import { prisma } from "@/lib/prisma";
import { pricePdfName, inSubmissionScope, approvedPriceOf, canPrice, canSeePrice, canReviewCategory, CATEGORIES, categoryLabel, getPriceUser, KIND_LABEL, releasePriceFile, sharedFileRef, logPrice, missingOf, nextPriceCode, parsePriceRoles, type PriceRole, type PriceUser } from "@/lib/gia-doi";
import { parsePriceWorkbook, type ParsedSheet } from "@/lib/gia-doi-excel";
import { convertSheetFormulas } from "@/lib/gia-doi-xl-import";
import crypto from "node:crypto";
import { buildDraftEml, parseEmails, SIGNATURE_SLOT } from "@/lib/mailer";
import { autoMatchLines, dtcpRefs, overOf } from "@/lib/hop-dong";
import { lineKeyOf } from "@/lib/hop-dong-calc";
import { buildPricePdf } from "@/lib/gia-doi-pdf";
import { copyFormulas, freshIdMap, mergeFormulas, newIdMap } from "@/lib/xl-save";

// Server action phân hệ Đệ trình giá đội. Luôn TRẢ VỀ {ok, error} thay vì throw.
export type GiaResult = { ok: true; id?: string; info?: string; file?: { name: string; base64: string } } | { ok: false; error: string };

class GiaError extends Error {}
function fail(msg: string): never {
  throw new GiaError(msg);
}
async function run(fn: () => Promise<string | void | { id?: string; info?: string; file?: { name: string; base64: string } }>): Promise<GiaResult> {
  try {
    const r = await fn();
    revalidatePath("/gia-doi", "layout");
    if (typeof r === "string") return { ok: true, id: r };
    return { ok: true, ...(r ?? {}) };
  } catch (e) {
    if (e instanceof GiaError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Lỗi hệ thống, thử lại hoặc báo quản trị." };
  }
}
async function need(...roles: PriceRole[]): Promise<PriceUser> {
  const u = await getPriceUser();
  if (!u) fail("Chưa đăng nhập");
  if (!canSeePrice(u!)) fail("Bạn chưa được cấp quyền Trình giá tổ đội");
  if (roles.length && !canPrice(u!, ...roles)) fail("Bạn không có quyền thực hiện thao tác này");
  return u!;
}
async function load(id: string) {
  const sub = await prisma.priceSubmission.findUnique({ where: { id }, include: { lines: { orderBy: { orderIndex: "asc" } } } });
  if (!sub) fail("Không tìm thấy hồ sơ");
  // chỉ xử lý hồ sơ thuộc khu vực được giao (hồ sơ chưa gắn hợp đồng: chỉ người tạo)
  const u = await getPriceUser();
  if (u?.areas) {
    const c = sub!.contractId ? await prisma.costContract.findUnique({ where: { id: sub!.contractId }, select: { area: true } }) : null;
    if (!inSubmissionScope(u, sub!, c?.area)) fail("Hồ sơ này thuộc khu vực / người phụ trách khác, bạn không xử lý được");
  }
  return sub!;
}

// ---- Phân quyền ----
export async function setUserPriceRolesAction(userId: string, roles: string[]) {
  return run(async () => {
    const u = await need();
    if (!u.isAdmin) fail("Chỉ quản trị được phân quyền");
    await prisma.user.update({ where: { id: userId }, data: { priceRoles: [...parsePriceRoles(roles.join(","))].join(",") } });
  });
}

// ---- QSTT tải file Excel đề xuất của BCH ----
export async function uploadPriceFileAction(form: FormData) {
  return run(async () => {
    const u = await need("QSTT");
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) fail("Chưa chọn file Excel");
    const f = file as File;
    if (!/\.xlsx$/i.test(f.name)) fail("Chỉ nhận file Excel .xlsx (file .xls cũ: mở bằng Excel rồi Lưu thành .xlsx)");
    if (f.size > MAX_UPLOAD_BYTES) fail(`File quá lớn (tối đa ${MAX_UPLOAD_MB}MB) — xoá ảnh / sheet không cần rồi lưu file mới`);
    const buf = await f.arrayBuffer();
    let sheets: ParsedSheet[] = [];
    try {
      sheets = await parsePriceWorkbook(buf);
    } catch {
      fail("Không đọc được file Excel (file hỏng hoặc không phải .xlsx)");
    }
    if (!sheets.length) fail("Không thấy bảng đề xuất đơn giá nào có dữ liệu (cần đúng mẫu: dòng tiêu đề STT | NỘI DUNG | ĐVT ...)");
    const ids: string[] = [];
    // chỉ lưu các sheet của hồ sơ (bỏ sheet thừa, hình ảnh) để nhẹ hệ thống; xuất Excel không cần file gốc đầy đủ
    const slimBuf = await slimXlsx(buf, sheets.map((x) => x.sheetName));
    const sites = await loadSites(); // tên CÔNG TRÌNH trong file trùng tên / tên gọi khác của dự án trong danh mục → tự chọn dự án
    for (const sh of sheets) {
      const first = ids[0];
      const code = await nextPriceCode();
      // giữ công thức Excel của file: cấp mã dòng trước để công thức trỏ đúng dòng
      const lineIds = sh.lines.map(() => `c${crypto.randomBytes(12).toString("hex")}`);
      const rowIds = new Map(sh.lines.map((l, i) => [l.sourceRow, lineIds[i]] as const));
      const xlConv = convertSheetFormulas(sh.xl, sh.colMap, rowIds, "__total");
      const sub = await prisma.priceSubmission.create({
        data: {
          code,
          kind: sh.kind,
          ...sh.head,
          ...siteFromName(sh.head.projectName, sites),
          fileName: f.name,
          // file nhiều sheet: chỉ lưu 1 bản file gốc ở hồ sơ đầu tiên
          ...(first ? { fileFromId: first } : { fileKey: await putFile(slimBuf) }), // file gốc ở KHO FILE
          sheetName: sh.sheetName,
          colMap: JSON.stringify(sh.colMap),
          headRows: JSON.stringify(sh.headRows),
          createdById: u.id,
          createdByName: u.name,
          ...(xlConv.total ? { totalFormulas: xlConv.total.formulas, totalAmounts: xlConv.total.amounts } : {}),
          // mẫu ngoài HĐ: cột "GIÁ ĐỀ XUẤT CỦA P.ĐT-TT" = giá Trưởng phòng duyệt → nếu file đã ghi sẵn thì lấy làm giá duyệt ban đầu
          lines: {
            create: sh.lines.map((l, i) => ({
              ...l,
              id: lineIds[i],
              formulas: xlConv.perLine.get(lineIds[i]) ?? "{}",
              orderIndex: i,
              ...(sh.kind === "OUT" && l.ptPrice != null && l.ptPrice !== l.sitePrice ? { tpPrice: l.ptPrice } : {}),
              ...(sh.kind === "OUT" && l.ptNote ? { tpNote: l.ptNote } : {}),
            })),
          },
        },
      });
      await logPrice(sub.id, "Tải file đề xuất lên", u.name, `${f.name} — sheet "${sh.sheetName}" (${KIND_LABEL[sh.kind]}), ${sh.itemCount} dòng`);
      ids.push(sub.id);
    }
    return { id: ids[0], info: ids.length > 1 ? `File có ${ids.length} bảng đề xuất → đã tạo ${ids.length} hồ sơ (xem ở danh sách)` : undefined };
  });
}

// ---- QSTT kiểm tra, bổ sung, ghi chú ----
export type HeadInput = { siteId?: string; projectName: string; contractNo: string; projectCode: string; itemName: string; quoteStatus: string; batch: string; batchDate: string; qsNote: string; crewName: string };
export type LineInput = {
  id: string; // "new:..." = dòng QSTT thêm mới trên phần mềm (chưa lưu)
  stt: string;
  content: string;
  unit: string;
  qty: number | null;
  cdtPrice: number | null;
  basePrice: number | null;
  baseNote: string;
  siteOpinion: string;
  sitePrice: number | null;
  siteNote: string;
  ptOpinion: string;
  ptPrice: number | null;
  ptNote: string;
  qsNote: string;
  lineKey: string; // dòng TH Nhân Công được khớp ("" chưa khớp, "-" ngoài DT-CP)
  overReason: string; // lý do vượt đơn giá / khối lượng DT-CP
  formulas?: Record<string, string>; // công thức kiểu Excel các ô số (src/lib/xl-formula.ts)
  // thành tiền đã tính — CHỈ lưu khi ô đó có công thức (QSTT sửa thành tiền / tổng nhóm như Excel)
  cdtAmount?: number | null;
  baseAmount?: number | null;
  siteAmount?: number | null;
  // khối KT-KH (Duyệt / Ý kiến / Đơn giá duyệt / Thành tiền duyệt / Ghi chú): QSTT sửa được khi hồ sơ chưa trình; Trưởng phòng sửa tiếp khi duyệt
  tpPrice?: number | null;
  tpOk?: boolean;
  tpNote?: string;
  tpAmount?: number | null;
};
// Dòng TỔNG CỘNG: công thức (QSTT: 3 cột đầu, Trưởng phòng: cột duyệt) + tổng đã tính lúc lưu (danh sách / PDF / Excel dùng đúng số này)
export type TotalInput = { formulas: Record<string, string>; amounts: { cdt: number | null; base: number | null; site: number | null; appr: number | null } };
// ô số QSTT được đặt công thức / ô Trưởng phòng được đặt công thức
const QS_FORMULA_KEYS = ["qty", "cdtPrice", "basePrice", "sitePrice", "ptPrice", "cdtAmount", "baseAmount", "siteAmount", "tpPrice", "apprAmount"];
const TP_FORMULA_KEYS = ["tpPrice", "apprAmount"];
const QS_TOTAL_KEYS = ["cdtAmount", "baseAmount", "siteAmount", "apprAmount"];
const TP_TOTAL_KEYS = ["apprAmount"];
const hasF = (f: Record<string, string> | undefined, k: string) => typeof f?.[k] === "string" && f[k].trim().startsWith("=");
// số đã tính của ô thành tiền: chỉ giữ khi ô có công thức
const amtData = (f: Record<string, string> | undefined, l: { cdtAmount?: number | null; baseAmount?: number | null; siteAmount?: number | null }) => ({
  ...(hasF(f, "cdtAmount") ? { cdtAmount: num(l.cdtAmount) } : {}),
  ...(hasF(f, "baseAmount") ? { baseAmount: num(l.baseAmount) } : {}),
  ...(hasF(f, "siteAmount") ? { siteAmount: num(l.siteAmount) } : {}),
});
const totalAmountsJson = (t: TotalInput) => JSON.stringify({ cdt: num(t.amounts.cdt) ?? 0, base: num(t.amounts.base) ?? 0, site: num(t.amounts.site) ?? 0, appr: num(t.amounts.appr) ?? 0 });
const str = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

// Lưu bảng của QSTT. `lines` = TOÀN BỘ bảng theo đúng thứ tự trên màn hình: dòng "new:..." = QSTT thêm mới (tạo dòng công việc,
// không có trong file gốc), dòng có trong hồ sơ mà không còn trong `lines` = QSTT đã xoá (công tác, đầu mục lớn, dòng chữ).
async function saveQs(id: string, head: HeadInput, lines: LineInput[], total?: TotalInput) {
  const sub = await load(id);
  if (sub.status !== "DRAFT") fail("Hồ sơ đã trình, không sửa được (rút lại trước)");
  const own = new Set(sub.lines.map((l) => l.id));
  const sent = new Set(lines.map((l) => l.id));
  const removed = sub.lines.filter((l) => !sent.has(l.id)).map((l) => l.id); // dòng công tác, đầu mục lớn (A, B / I, II) và dòng chữ đều xoá được
  const lineData = (l: LineInput) => ({
    content: str(l.content),
    unit: str(l.unit),
    qty: num(l.qty),
    cdtPrice: num(l.cdtPrice),
    basePrice: num(l.basePrice),
    baseNote: str(l.baseNote),
    siteOpinion: str(l.siteOpinion),
    sitePrice: num(l.sitePrice),
    siteNote: str(l.siteNote),
    ptOpinion: str(l.ptOpinion),
    ptPrice: num(l.ptPrice),
    ptNote: str(l.ptNote),
    qsNote: str(l.qsNote),
    lineKey: str(l.lineKey),
    overReason: str(l.overReason),
    ...amtData(l.formulas, l),
    ...(l.tpOk !== undefined ? { tpOk: !!l.tpOk, tpPrice: num(l.tpPrice), tpNote: str(l.tpNote), tpAmount: hasF(l.formulas, "apprAmount") ? num(l.tpAmount) : null } : {}),
  });
  const added = lines.filter((l) => l.id.startsWith("new:")).length;
  const idMap = newIdMap(lines.map((l) => l.id)); // dòng thêm: cấp mã thật trước để công thức trỏ đúng
  // DỰ ÁN chọn từ Danh mục dự án (có hợp đồng đã gắn dự án thì theo hợp đồng)
  const site = await siteFields(head.siteId, sub.contractId, { projectName: str(head.projectName), projectCode: str(head.projectCode) });
  await prisma.$transaction([
    ...(removed.length ? [prisma.priceLine.deleteMany({ where: { id: { in: removed } } })] : []),
    prisma.priceSubmission.update({
      where: { id },
      data: {
        projectName: str(head.projectName),
        contractNo: str(head.contractNo),
        projectCode: str(head.projectCode),
        ...site,
        itemName: str(head.itemName),
        quoteStatus: str(head.quoteStatus),
        batch: str(head.batch),
        batchDate: str(head.batchDate),
        qsNote: str(head.qsNote),
        crewName: str(head.crewName),
        ...(total ? { totalFormulas: mergeFormulas(sub.totalFormulas, total.formulas, QS_TOTAL_KEYS, idMap), totalAmounts: totalAmountsJson(total) } : {}),
      },
    }),
    ...lines.flatMap((l, i) => {
      if (own.has(l.id)) {
        const old = sub.lines.find((x) => x.id === l.id)!;
        // STT sửa được ở dòng QSTT thêm (không có trong file gốc)
        return [prisma.priceLine.update({ where: { id: l.id }, data: { ...lineData(l), formulas: mergeFormulas(old.formulas, l.formulas, QS_FORMULA_KEYS, idMap), orderIndex: i, stt: str(l.stt) } })];
      }
      if (l.id.startsWith("new:")) return [prisma.priceLine.create({ data: { ...lineData(l), id: idMap.get(l.id)!, formulas: mergeFormulas("{}", l.formulas, QS_FORMULA_KEYS, idMap), submissionId: id, orderIndex: i, level: "ITEM", sourceRow: 0, stt: str(l.stt) } })];
      return [];
    }),
  ]);
  return { added, removed: removed.length };
}

// GIÁ CƠ SỞ ĐỀ XUẤT = đơn giá kiểm soát (thời điểm đã duyệt) của dòng TH Nhân Công DT-CP hợp đồng đã khớp.
// Dòng chưa khớp / giữ ngoài DT-CP: giữ giá cơ sở trong file (QSTT sửa được). Phần mềm kiểm tra vượt theo giá cơ sở này.
async function syncBasePrices(id: string) {
  const sub = await prisma.priceSubmission.findUnique({ where: { id }, select: { contractId: true, status: true, lines: { where: { level: "ITEM" }, select: { id: true, lineKey: true, basePrice: true } } } });
  if (!sub?.contractId || sub.status !== "DRAFT") return;
  const refs = new Map((await dtcpRefs(sub.contractId, id)).map((r) => [r.key, r]));
  const ups = sub.lines.flatMap((l) => {
    const p = refs.get(l.lineKey)?.price;
    return p != null && p !== l.basePrice ? [prisma.priceLine.update({ where: { id: l.id }, data: { basePrice: p } })] : [];
  });
  if (ups.length) await prisma.$transaction(ups);
}

export async function savePriceDraftAction(id: string, head: HeadInput, lines: LineInput[], total?: TotalInput) {
  return run(async () => {
    const u = await need("QSTT");
    const r = await saveQs(id, head, lines, total);
    await syncBasePrices(id);
    if (r.added || r.removed) await logPrice(id, "QSTT sửa danh sách dòng đề xuất", u.name, [r.added && `thêm ${r.added} dòng`, r.removed && `xoá ${r.removed} dòng`].filter(Boolean).join(", "));
  });
}

export async function submitPriceAction(id: string, category: string, head: HeadInput, lines: LineInput[], total?: TotalInput) {
  return run(async () => {
    const u = await need("QSTT");
    if (!CATEGORIES.some((c) => c.value === category)) fail("Chọn hạng mục (Trưởng phòng duyệt) trước khi trình");
    const saved = await saveQs(id, head, lines, total);
    await syncBasePrices(id);
    if (saved.added || saved.removed) await logPrice(id, "QSTT sửa danh sách dòng đề xuất", u.name, [saved.added && `thêm ${saved.added} dòng`, saved.removed && `xoá ${saved.removed} dòng`].filter(Boolean).join(", "));
    const sub = await load(id);
    if (!sub.contractId && !sub.dtcpLater) fail('Chọn HỢP ĐỒNG (DT-CP) của hồ sơ (hoặc "Chưa có DT-CP — bổ sung sau") trước khi trình');
    const refs = new Map(sub.contractId ? (await dtcpRefs(sub.contractId, id)).map((r) => [r.key, r]) : []);
    const miss = missingOf(sub, sub.lines);
    if (!sub.siteId) miss.unshift(SITE_MISSING);
    for (const l of sub.lines) {
      if (l.level !== "ITEM") continue;
      const o = overOf(sub.kind, l, refs.get(l.lineKey));
      if ((o.price || o.qty) && !l.overReason && !l.qsNote.trim()) miss.push(`Dòng ${l.stt || "?"} "${l.content.slice(0, 40)}": vượt ${o.price ? "giá cơ sở" : ""}${o.price && o.qty ? " và " : ""}${o.qty ? "khối lượng DT-CP" : ""} — ghi lý do vào cột Ghi chú QSTT`);
    }
    if (miss.length) fail(`Hồ sơ còn thiếu dữ liệu, cần bổ sung trước khi trình:\n- ${miss.slice(0, 15).join("\n- ")}${miss.length > 15 ? `\n... và ${miss.length - 15} mục khác` : ""}`);
    await prisma.priceSubmission.update({ where: { id }, data: { status: "SUBMITTED", category, submittedAt: new Date(), reviewedByName: "", reviewedAt: null } });
    // nhớ cách khớp dòng đề xuất ↔ dòng DT-CP cho các đợt sau
    const memo = sub.contractId ? sub.lines.filter((l) => l.level === "ITEM" && l.lineKey) : [];
    await prisma.$transaction(
      memo.map((l) => {
        const srcKey = lineKeyOf(l.content, l.unit);
        return prisma.priceMatch.upsert({ where: { contractId_srcKey: { contractId: sub.contractId!, srcKey } }, create: { contractId: sub.contractId!, srcKey, lineKey: l.lineKey }, update: { lineKey: l.lineKey } });
      }),
    );
    await logPrice(id, `Trình ${categoryLabel(category)} duyệt (lần ${sub.revision})`, u.name, sub.qsNote);
  });
}

export async function recallPriceAction(id: string) {
  return run(async () => {
    const u = await need("QSTT");
    const sub = await load(id);
    if (sub.status !== "SUBMITTED") fail("Chỉ rút lại được hồ sơ đang chờ Trưởng phòng duyệt");
    await prisma.priceSubmission.update({ where: { id }, data: { status: "DRAFT" } });
    await logPrice(id, "Rút lại hồ sơ để sửa", u.name);
  });
}

// TRÌNH LẠI (lần 2, 3...): hồ sơ TP đã trả về (không duyệt / công trường không tìm được đội...) → tạo hồ sơ lần trình mới
// từ hồ sơ này (sửa tiếp: đổi đội, đơn giá...), hồ sơ cũ giữ nguyên làm lịch sử
export async function revisePriceAction(id: string) {
  return run(async () => {
    const u = await need("QSTT");
    const sub = await prisma.priceSubmission.findUnique({ where: { id }, include: { lines: { orderBy: { orderIndex: "asc" } } } });
    if (!sub) return fail("Không tìm thấy hồ sơ");
    if (sub.status !== "APPROVED" && sub.status !== "REJECTED") fail("Chỉ trình lại hồ sơ Trưởng phòng đã trả về");
    if (await prisma.priceSubmission.findFirst({ where: { parentId: id } })) fail("Hồ sơ này đã có lần trình lại");
    const code = await nextPriceCode();
    const { id: _id, code: _c, lines, createdAt: _a, updatedAt: _b, ...rest } = { ...sub, ...sharedFileRef(sub) };
    void _id;
    void _c;
    void _a;
    void _b;
    const idMap = freshIdMap(lines.map((l) => l.id)); // mã mới cho từng dòng, công thức trỏ theo mã mới
    const n = await prisma.priceSubmission.create({
      data: {
        ...rest,
        totalFormulas: copyFormulas(sub.totalFormulas, idMap, TP_FORMULA_KEYS), // công thức TỔNG CỘNG của QSTT giữ lại, của Trưởng phòng bỏ
        totalAmounts: "{}",
        code,
        revision: sub.revision + 1,
        parentId: id,
        status: "DRAFT",
        category: sub.category,
        tpNote: "",
        submittedAt: null,
        reviewedByName: "",
        reviewedAt: null,
        mailTo: sub.mailTo,
        mailSentAt: null,
        createdById: u.id,
        createdByName: u.name,
        lines: {
          create: lines.map((l) => {
            const { id: _li, submissionId: _si, ...lr } = l;
            void _si;
            return { ...lr, id: idMap.get(_li)!, formulas: copyFormulas(l.formulas, idMap, TP_FORMULA_KEYS), tpPrice: null, tpAmount: null, tpOk: true, tpNote: "" };
          }),
        },
      },
    });
    await logPrice(id, `Trình lại → hồ sơ ${code} (lần ${sub.revision + 1})`, u.name);
    await logPrice(n.id, `Tạo lần trình ${sub.revision + 1} từ hồ sơ ${sub.code}`, u.name);
    return n.id;
  });
}

// Ghi giá các dòng TP đồng ý vào SỔ GIÁ của hợp đồng (theo đội)
async function writeLedger(id: string, at: Date, byName: string) {
  const sub = await load(id);
  if (!sub.contractId) return;
  const rows = sub.lines
    .filter((l) => l.level === "ITEM" && l.tpOk)
    .map((l) => ({ l, price: approvedPriceOf(sub.kind, l) }))
    .filter((x) => x.price != null);
  await prisma.approvedPrice.createMany({
    data: rows.map(({ l, price }) => ({
      contractId: sub.contractId!,
      lineKey: l.lineKey,
      name: l.content,
      unit: l.unit,
      crew: sub.crewName,
      price: price!,
      qty: l.qty,
      approvedAt: at,
      approvedByName: byName,
      submissionId: id,
      submissionCode: sub.code,
      revision: sub.revision,
      batch: sub.batch,
    })),
  });
}

// Gắn hồ sơ vào hợp đồng (DT-CP) → tự khớp các dòng với TH Nhân Công.
// later = true: "Chưa có DT-CP — bổ sung sau" (hồ sơ vẫn trình / duyệt được, QSTT còn việc bổ sung DT-CP).
// Hồ sơ ĐÃ TRÌNH / ĐÃ DUYỆT đang "bổ sung sau": QSTT gắn hợp đồng → tự khớp; nếu đã duyệt thì ghi giá vào sổ giá theo ngày TP duyệt.
export async function setSubmissionContractAction(id: string, contractId: string | null, later = false) {
  return run(async () => {
    const u = await need("QSTT");
    const sub = await load(id);
    const fillLater = sub.status !== "DRAFT" && sub.dtcpLater && !sub.contractId;
    if (sub.status !== "DRAFT" && !fillLater) fail("Hồ sơ đã trình, không đổi hợp đồng được");
    if (fillLater && !contractId) fail("Chọn hợp đồng (DT-CP) cần bổ sung");
    if (contractId && !(await prisma.costContract.findUnique({ where: { id: contractId } }))) fail("Không tìm thấy hợp đồng");
    if (sub.contractId !== contractId) await prisma.priceLine.updateMany({ where: { submissionId: id }, data: { lineKey: "" } });
    await prisma.priceSubmission.update({ where: { id }, data: { contractId, dtcpLater: contractId ? false : later } });
    // hợp đồng đã gắn dự án → hồ sơ theo dự án của hợp đồng; hợp đồng chưa gắn mà hồ sơ đã chọn dự án → gắn hợp đồng vào dự án đó
    if (contractId) await prisma.priceSubmission.update({ where: { id }, data: await siteFields(sub.siteId, contractId, { projectName: sub.projectName, projectCode: sub.projectCode }) });
    const n = contractId ? await autoMatchLines(id, contractId) : 0;
    if (fillLater) {
      if (sub.status === "APPROVED") await writeLedger(id, sub.reviewedAt ?? new Date(), sub.reviewedByName);
      await logPrice(id, "Bổ sung DT-CP (hợp đồng) cho hồ sơ", u.name, `tự khớp ${n} dòng với TH Nhân Công${sub.status === "APPROVED" ? ", ghi giá đã duyệt vào sổ giá" : ""}`);
      return { info: `Đã bổ sung DT-CP, tự khớp ${n} dòng với TH Nhân Công.` };
    }
    await syncBasePrices(id);
    await logPrice(id, contractId ? "Gắn hồ sơ vào hợp đồng" : later ? "Chọn: Chưa có DT-CP — bổ sung sau" : "Bỏ gắn hợp đồng", u.name, contractId ? `tự khớp ${n} dòng với TH Nhân Công` : "");
    return { info: contractId ? `Đã tự khớp ${n} dòng với TH Nhân Công — kiểm tra cột "Dòng DT-CP".` : undefined };
  });
}

// SỬA THÔNG TIN ĐẦU HỒ SƠ (công trình, số HĐ CĐT, mã dự án, hạng mục, tình trạng báo giá, hợp đồng DT-CP, tên tổ đội, đợt) để sửa chỗ QSTT ghi sai —
// KHÔNG đụng giá (không đồng bộ lại giá cơ sở). Trưởng phòng: khi hồ sơ đang chờ mình duyệt; Quản trị: mọi lúc (kể cả đã duyệt).
// Đã ghi sổ giá → sổ giá theo hợp đồng / tổ đội / đợt mới, giữ ngày hiệu lực và người duyệt cũ.
export async function savePriceHeadInfoAction(id: string, head: HeadInput, contractId: string | null, later = false) {
  return run(async () => {
    const u = await need();
    const sub = await load(id);
    const isTp = sub.status === "SUBMITTED" && canReviewCategory(u, sub.category);
    if (!u.isAdmin && !isTp) fail("Chỉ Trưởng phòng (khi hồ sơ đang chờ duyệt) hoặc Quản trị được sửa thông tin đầu hồ sơ");
    if (contractId && !(await prisma.costContract.findUnique({ where: { id: contractId }, select: { id: true } }))) fail("Không tìm thấy hợp đồng");
    const changedContract = (sub.contractId ?? null) !== (contractId ?? null);
    const site = await siteFields(head.siteId, contractId, { projectName: str(head.projectName), projectCode: str(head.projectCode) });
    await prisma.priceSubmission.update({
      where: { id },
      data: {
        projectName: str(head.projectName),
        contractNo: str(head.contractNo),
        projectCode: str(head.projectCode),
        ...site,
        itemName: str(head.itemName),
        quoteStatus: str(head.quoteStatus),
        batch: str(head.batch),
        batchDate: str(head.batchDate),
        crewName: str(head.crewName),
        contractId,
        dtcpLater: contractId ? false : later,
      },
    });
    let info: string | undefined;
    if (changedContract) {
      await prisma.priceLine.updateMany({ where: { submissionId: id }, data: { lineKey: "" } });
      const n = contractId ? await autoMatchLines(id, contractId) : 0;
      info = contractId ? `Đã đổi hợp đồng (DT-CP), tự khớp ${n} dòng với TH Nhân Công.` : "Đã bỏ gắn hợp đồng (DT-CP).";
    }
    // sổ giá đã ghi từ hồ sơ này: ghi lại theo thông tin mới (đổi hợp đồng / khớp dòng), giữ ngày hiệu lực + người duyệt
    const old = await prisma.approvedPrice.findFirst({ where: { submissionId: id }, orderBy: { approvedAt: "asc" }, select: { approvedAt: true, approvedByName: true } });
    if (old || (changedContract && sub.status === "APPROVED")) {
      await prisma.approvedPrice.deleteMany({ where: { submissionId: id } });
      await writeLedger(id, old?.approvedAt ?? sub.reviewedAt ?? new Date(), old?.approvedByName ?? sub.reviewedByName);
    }
    await logPrice(id, u.isAdmin && !isTp ? "Quản trị sửa thông tin đầu hồ sơ" : "Trưởng phòng sửa thông tin đầu hồ sơ", u.name, changedContract ? "đổi hợp đồng (DT-CP)" : "");
    return { info };
  });
}

// Khớp tự động lại các dòng còn chưa khớp
export async function rematchPriceAction(id: string) {
  return run(async () => {
    await need("QSTT");
    const sub = await load(id);
    if (!sub.contractId) return fail("Chưa chọn hợp đồng");
    const n = await autoMatchLines(id, sub.contractId);
    await syncBasePrices(id);
    return { info: `Tự khớp thêm ${n} dòng` };
  });
}

// Trưởng phòng (hồ sơ chờ duyệt) hoặc QSTT (hồ sơ nháp) CHỌN dòng DT-CP khớp cho 1 dòng đề xuất: lineKey = khoá dòng DT-CP · "-" = ngoài DT-CP · "" = bỏ khớp.
// Lưu ngay (không chờ bấm Lưu / Duyệt) và đồng bộ giá cơ sở theo giá DT-CP dòng vừa chọn; nhớ cách khớp cho các đợt sau.
export async function setLineMatchAction(id: string, lineId: string, lineKey: string) {
  return run(async () => {
    const u = await need();
    const sub = await load(id);
    if (sub.status === "DRAFT") {
      if (!canPrice(u, "QSTT")) fail("Bạn không có quyền thực hiện thao tác này");
    } else if (sub.status === "SUBMITTED") {
      if (!canReviewCategory(u, sub.category)) fail(`Hồ sơ thuộc ${categoryLabel(sub.category)}, bạn không có quyền chọn khớp`);
    } else fail("Hồ sơ đã duyệt / đã trả về, không đổi khớp DT-CP được");
    const line = sub.lines.find((l) => l.id === lineId && l.level === "ITEM");
    if (!line) fail("Không tìm thấy dòng");
    if (!sub.contractId) fail("Hồ sơ chưa chọn hợp đồng (DT-CP)");
    const key = str(lineKey);
    let basePrice = line!.basePrice;
    if (key && key !== "-") {
      const ref = (await dtcpRefs(sub.contractId!, id)).find((r) => r.key === key);
      if (!ref) fail("Dòng DT-CP không tồn tại trong hợp đồng này");
      if (ref!.price != null) basePrice = ref!.price;
    }
    await prisma.priceLine.update({ where: { id: lineId }, data: { lineKey: key, basePrice } });
    const srcKey = lineKeyOf(line!.content, line!.unit);
    if (key) await prisma.priceMatch.upsert({ where: { contractId_srcKey: { contractId: sub.contractId!, srcKey } }, create: { contractId: sub.contractId!, srcKey, lineKey: key }, update: { lineKey: key } });
    await logPrice(id, key === "-" ? "Chọn dòng ngoài DT-CP" : key ? "Chọn khớp dòng DT-CP" : "Bỏ khớp dòng DT-CP", u.name, `Dòng ${line!.stt || "?"}: ${line!.content.slice(0, 60)}`);
    return { info: String(basePrice ?? "") };
  });
}

export async function deletePriceAction(id: string) {
  return run(async () => {
    await need("QSTT");
    const sub = await load(id);
    if (sub.status !== "DRAFT") fail("Chỉ xoá được hồ sơ chưa trình");
    await releasePriceFile(id);
    await prisma.priceSubmission.delete({ where: { id } });
    await prisma.procLog.deleteMany({ where: { entity: "GIA", entityId: id } });
  });
}

// ---- Trưởng phòng duyệt từng dòng (sửa đơn giá) rồi duyệt / không duyệt cả hồ sơ ----
export type TpLineInput = { id: string; tpPrice: number | null; tpOk: boolean; tpNote: string; formulas?: Record<string, string>; tpAmount?: number | null };

async function saveTp(u: PriceUser, id: string, tpNote: string, lines: TpLineInput[], total?: TotalInput, adjust = false) {
  const sub = await load(id);
  if (adjust ? sub.status !== "APPROVED" : sub.status !== "SUBMITTED") fail(adjust ? "Chỉ điều chỉnh được hồ sơ đã duyệt" : "Hồ sơ không ở trạng thái chờ duyệt");
  if (!canReviewCategory(u, sub.category)) fail(`Hồ sơ thuộc ${categoryLabel(sub.category)}, bạn không có quyền duyệt`);
  const own = new Set(sub.lines.map((l) => l.id));
  await prisma.$transaction([
    prisma.priceSubmission.update({
      where: { id },
      data: { tpNote: str(tpNote), ...(total ? { totalFormulas: mergeFormulas(sub.totalFormulas, total.formulas, TP_TOTAL_KEYS), totalAmounts: totalAmountsJson(total) } : {}) },
    }),
    ...lines
      .filter((l) => own.has(l.id))
      .map((l) =>
        prisma.priceLine.update({
          where: { id: l.id },
          data: {
            tpPrice: num(l.tpPrice),
            tpOk: !!l.tpOk,
            tpNote: str(l.tpNote),
            formulas: mergeFormulas(sub.lines.find((x) => x.id === l.id)?.formulas, l.formulas, TP_FORMULA_KEYS),
            tpAmount: hasF(l.formulas, "apprAmount") ? num(l.tpAmount) : null, // thành tiền duyệt: chỉ giữ khi Trưởng phòng đặt công thức
          },
        }),
      ),
  ]);
}

export async function saveTpDraftAction(id: string, tpNote: string, lines: TpLineInput[], total?: TotalInput) {
  return run(async () => {
    const u = await need();
    await saveTp(u, id, tpNote, lines, total);
  });
}

export async function decidePriceAction(id: string, approve: boolean, tpNote: string, lines: TpLineInput[], total?: TotalInput) {
  return run(async () => {
    const u = await need();
    if (!approve && !str(tpNote)) fail("Nhập ý kiến / lý do không duyệt (ô Ý kiến Trưởng phòng)");
    await saveTp(u, id, tpNote, lines, total);
    const now = new Date();
    await prisma.priceSubmission.update({ where: { id }, data: { status: approve ? "APPROVED" : "REJECTED", reviewedByName: u.name, reviewedAt: now } });
    // DUYỆT: ghi giá các dòng đồng ý vào SỔ GIÁ của hợp đồng (theo đội, áp dụng từ hôm nay)
    if (approve) await writeLedger(id, now, u.name);
    await logPrice(id, approve ? "Trưởng phòng DUYỆT, trả hồ sơ về QSTT" : "Trưởng phòng KHÔNG DUYỆT, trả hồ sơ về QSTT", u.name, str(tpNote));
  });
}

// ĐIỀU CHỈNH GIÁ SAU DUYỆT: Trưởng phòng sửa lại đơn giá duyệt của hồ sơ ĐÃ DUYỆT (chưa trình lại).
// Giá trong sổ giá của hợp đồng được ghi lại theo giá mới (giữ ngày hiệu lực cũ); hồ sơ về lại việc "Soạn mail" của QSTT để gửi kết quả điều chỉnh.
export async function adjustApprovedPriceAction(id: string, reason: string, tpNote: string, lines: TpLineInput[], total?: TotalInput) {
  return run(async () => {
    const u = await need();
    const sub0 = await load(id);
    if (await prisma.priceSubmission.findFirst({ where: { parentId: id } })) fail("Hồ sơ đã được trình lại, không điều chỉnh được nữa");
    await saveTp(u, id, tpNote, lines, total, true);
    const at = sub0.reviewedAt ?? new Date();
    await prisma.approvedPrice.deleteMany({ where: { submissionId: id } });
    await writeLedger(id, at, u.name);
    await prisma.priceSubmission.update({ where: { id }, data: { mailSentAt: null } });
    await logPrice(id, "Trưởng phòng ĐIỀU CHỈNH giá sau duyệt", u.name, str(reason));
  });
}

// ---- QSTT soạn thư Outlook: thư nháp (.eml) có sẵn người nhận, nội dung và đính kèm PDF hồ sơ duyệt ----
const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");

export async function buildPriceEmlAction(id: string, to: string, cc: string, note: string) {
  return run(async () => {
    const u = await need("QSTT");
    const sub = await load(id);
    if (sub.status !== "APPROVED" && sub.status !== "REJECTED") fail("Chỉ soạn mail khi Trưởng phòng đã trả hồ sơ về");
    const t = parseEmails(to);
    const c = parseEmails(cc);
    if (!t.ok.length) fail("Nhập ít nhất 1 địa chỉ mail người nhận");
    if (t.bad.length || c.bad.length) fail(`Địa chỉ mail không hợp lệ: ${[...t.bad, ...c.bad].join(", ")}`);
    const pdf = await buildPricePdf(sub);
    const result = sub.status === "APPROVED" ? "ĐÃ DUYỆT" : "KHÔNG DUYỆT";
    // tiêu đề mail = tên file PDF duyệt đính kèm (bỏ đuôi .pdf)
    const subject = pricePdfName(sub).replace(/\.pdf$/i, "");
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px">
      <p>Kính gửi Anh/Chị,</p>
      <p>Khối Kinh Tế - Kế Hoạch gửi kết quả xem xét hồ sơ <b>đề xuất đơn giá tổ đội</b>:</p>
      <ul>
        <li>Công trình: <b>${esc(sub.projectName)}</b></li>
        ${sub.contractNo.trim() ? `<li>Hợp đồng với CĐT: <b>${esc(sub.contractNo.trim())}</b></li>` : ""}
        ${sub.itemName ? `<li>Hạng mục: ${esc(sub.itemName)}</li>` : ""}
        ${sub.batch ? `<li>Đợt: ${esc(sub.batch)}${sub.batchDate ? ` (ngày ${esc(sub.batchDate)})` : ""}</li>` : ""}
        <li>Loại: ${KIND_LABEL[sub.kind] ?? ""}</li>
        <li>Kết quả: <b style="color:${sub.status === "APPROVED" ? "#047857" : "#b91c1c"}">${result}</b></li>
        ${sub.tpNote ? `<li>Ý kiến Trưởng phòng: ${esc(sub.tpNote)}</li>` : ""}
      </ul>
      ${note.trim() ? `<p><b>Ghi chú:</b><br>${esc(note.trim())}</p>` : ""}
      <p>Chi tiết đơn giá duyệt từng dòng xem file PDF đính kèm.</p>
      <p>Trân trọng,</p>${SIGNATURE_SLOT}</div>`;
    const base = `Don gia doi ${sub.code} - ${result === "ĐÃ DUYỆT" ? "DA DUYET" : "KHONG DUYET"}`;
    const eml = await buildDraftEml({ to: t.ok, cc: c.ok, subject, html, attachments: [{ filename: pricePdfName(sub), content: pdf, contentType: "application/pdf" }] });
    await prisma.priceSubmission.update({ where: { id }, data: { mailTo: [t.ok.join("; "), c.ok.join("; ")].join("|"), mailSentAt: new Date() } });
    await logPrice(id, "Soạn mail Outlook (đính kèm PDF duyệt)", u.name, `tới ${t.ok.join(", ")}${c.ok.length ? `; cc ${c.ok.join(", ")}` : ""}${note.trim() ? ` — ${note.trim()}` : ""}`);
    return { file: { name: `${base}.eml`, base64: eml.toString("base64") } };
  });
}
