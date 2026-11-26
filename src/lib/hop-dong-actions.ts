"use server";

import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/friendly-error";
import { slimXlsx } from "@/lib/xlsx-slim";
import { getFile, putFile } from "@/lib/file-store";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getPriceUser, isTP, type PriceUser } from "@/lib/gia-doi";
import { canManageContracts, parseVersions } from "@/lib/hop-dong";
import { analyzeDtcpWorkbook, dtcpLinks, parseDtcpWorkbook, sheetColumns, sheetInfo, type Analysis, type ColMap, type LinkReport, type ParsedLine, type SheetChoice } from "@/lib/hop-dong-excel";
import { lineKeyOf, parsePrices, PS_GROUP_NAME, type CostKind, type Version } from "@/lib/hop-dong-calc";
import { normalizeDtcp, type NormRow } from "@/lib/dtcp-normalize";
import { ensureContractFromProject, snapshotNc } from "@/lib/hop-dong-project";
import { snapshotSheetsV2, toSnapV2, type SheetSnap } from "@/lib/sheet-snapshot";
import { loadSheets, XlsxTooBigError } from "@/lib/xlsx-subset";
import { autoMergeHeader, deleteRows, mergeRegion, setColWidth, splitAt } from "@/lib/sheet-edit";
import { pickSite, syncSite } from "@/lib/project-site";

// Server action của "Hợp đồng (DT-CP)": nhập file DT-CP Excel cũ (có bước chọn sheet), lấy từ DT-CP trên phần mềm, sửa thông tin.
type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
class HdError extends Error {}
const fail = (m: string): never => {
  throw new HdError(m);
};
async function run<T extends object>(fn: () => Promise<T>): Promise<R<T>> {
  try {
    const r = await fn();
    revalidatePath("/gia-doi", "layout");
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof HdError || e instanceof XlsxTooBigError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Lỗi hệ thống, thử lại hoặc báo quản trị." };
  }
}
async function need(): Promise<PriceUser> {
  const u = await getPriceUser();
  if (!u) fail("Chưa đăng nhập");
  if (!canManageContracts(u!)) fail("Chỉ QSTT / QSĐT / quản trị được nhập và cập nhật DT-CP hợp đồng");
  return u!;
}
async function fileOf(form: FormData): Promise<{ name: string; buf: ArrayBuffer }> {
  const f = form.get("file");
  if (!(f instanceof File) || !f.size) fail("Chưa chọn file Excel DT-CP");
  const file = f as File;
  if (!/\.xlsx$/i.test(file.name)) fail("Chỉ nhận file .xlsx (file .xls cũ: mở bằng Excel rồi Lưu thành .xlsx)");
  if (file.size > MAX_UPLOAD_BYTES) fail(`File quá lớn (tối đa ${MAX_UPLOAD_MB}MB) — xoá ảnh / sheet không cần rồi lưu file mới`);
  return { name: file.name, buf: await file.arrayBuffer() };
}

// Bước 1: đọc file → đoán sheet, cột, thời điểm, thông tin hợp đồng
export async function analyzeDtcpFileAction(form: FormData, include: string[] = []) {
  return run(async () => {
    await need();
    const { buf } = await fileOf(form);
    let analysis: Analysis;
    try {
      analysis = await analyzeDtcpWorkbook(buf, include);
    } catch (e) {
      if (e instanceof XlsxTooBigError) throw e;
      console.error(e);
      return fail("Không đọc được file Excel (file hỏng hoặc không phải .xlsx)");
    }
    return { analysis };
  });
}

// Đọc nội dung 1 sheet chưa đọc (người dùng chọn dùng sheet không đoán được từ tên)
export async function sheetInfoAction(form: FormData, sheet: string) {
  return run(async () => {
    await need();
    const { buf } = await fileOf(form);
    const info = await sheetInfo(buf, sheet);
    if (!info) return fail("Không thấy sheet trong file");
    return { info };
  });
}

// Kiểm tra liên kết của sheet DT-CP: công thức trỏ tới sheet nào (client so với 6 sheet cơ bản đã chọn)
export async function dtcpLinksAction(form: FormData, sheet: string) {
  return run(async () => {
    await need();
    const { buf } = await fileOf(form);
    let report: LinkReport;
    try {
      report = await dtcpLinks(buf, sheet);
    } catch (e) {
      if (e instanceof XlsxTooBigError) throw e;
      return fail("Không đọc được sheet DT-CP");
    }
    return { report };
  });
}

// Đổi dòng tiêu đề của 1 sheet → đọc lại các cột
export async function sheetColumnsAction(form: FormData, sheet: string, headerRow: number) {
  return run(async () => {
    await need();
    const { buf } = await fileOf(form);
    return await sheetColumns(buf, sheet, headerRow);
  });
}

export type ImportMeta = {
  contractId?: string; // nhập lại vào hợp đồng có sẵn (thay dòng, giữ sổ giá đã duyệt)
  area: string; // Khu vực "1".."5"
  name: string;
  siteId?: string; // DANH MỤC DỰ ÁN (bắt buộc với hợp đồng gốc; phụ lục theo dự án của hợp đồng gốc)
  packageName: string;
  contractNo: string;
  appendixNo?: string; // PHỤ LỤC (PL01...) — chỉ dùng khi chọn hợp đồng gốc ở appendixOfId
  appendixOfId?: string; // id hợp đồng GỐC mà DT-CP này là phụ lục của (trống = hợp đồng gốc)
  versions: Version[];
  approvedVersion: number;
  choices: Partial<Record<CostKind, SheetChoice>>;
  dtcpSheet: string;
  boqSheets: string[]; // BOQ có thể nhiều sheet
  ctSheet: string; // CHI TIẾT
  standardize?: boolean; // "Làm chuẩn DT-CP cũ 7 sheet": đưa chi tiết từ sheet ngoài / sheet khác về đúng TH
};

const lineData = (contractId: string, l: ParsedLine, i: number) => ({
  contractId,
  kind: l.kind,
  key: l.key,
  level: l.level,
  stt: l.stt,
  name: l.name,
  unit: l.unit,
  qty: l.qty,
  prices: JSON.stringify(l.prices),
  amount: l.amount,
  note: l.note,
  orderIndex: i,
  sourceRow: l.sourceRow,
  vatPct: l.vatPct ?? null,
});

// Chụp các sheet DT-CP / BOQ / CHI TIẾT (có cấu trúc: ô gộp, kiểu số, cột ẩn) để vẽ theo giao diện phần mềm
async function captureSheets(buf: ArrayBuffer, dtcpSheet: string, boqSheets: string[], ctSheet: string, wb?: Parameters<typeof snapshotSheetsV2>[2]) {
  const snaps = await snapshotSheetsV2(buf, [dtcpSheet, ...boqSheets, ctSheet], wb);
  return (contractId: string) =>
    snaps.map((x, i) => ({
      contractId,
      role: x.name === dtcpSheet ? "DTCP" : x.name === ctSheet ? "CT" : "BOQ",
      name: x.name,
      orderIndex: i,
      rows: JSON.stringify(autoMergeHeader(x.snap)), // tự gộp ô tiêu đề bị lặp chữ
      truncated: false,
    }));
}

// QSTT chỉnh sheet DT-CP / BOQ / CHI TIẾT hiển thị: gộp ô, tách ô, xoá dòng dư, kéo giãn cột (sửa trên bản chụp, không đụng số liệu khác)
export type SheetEditOp =
  | { kind: "merge"; r1: number; c1: number; r2: number; c2: number }
  | { kind: "split"; r: number; c: number }
  | { kind: "delRows"; r1: number; r2: number }
  | { kind: "width"; c: number; w: number };
export async function editSheetAction(sheetId: string, op: SheetEditOp) {
  return run(async () => {
    await need();
    const row = await prisma.costSheet.findUnique({ where: { id: sheetId } });
    if (!row) return fail("Không tìm thấy sheet");
    // bản chụp cũ (v1) tự chuyển sang định dạng mới khi chỉnh
    let snap: SheetSnap;
    try {
      snap = toSnapV2(JSON.parse(row.rows) as unknown);
    } catch {
      snap = { v: 2, cols: [], rows: [] };
    }
    const next =
      op.kind === "merge" ? mergeRegion(snap, op.r1, op.c1, op.r2, op.c2) : op.kind === "split" ? splitAt(snap, op.r, op.c) : op.kind === "delRows" ? deleteRows(snap, op.r1, op.r2) : setColWidth(snap, op.c, op.w);
    await prisma.costSheet.update({ where: { id: sheetId }, data: { rows: JSON.stringify(next) } });
    return {};
  });
}

// Chụp lại các sheet từ FILE GỐC đã lưu (khi đổi cách hiển thị) — không phải chọn lại file
export async function rebuildSheetsAction(contractId: string) {
  return run(async () => {
    await need();
    const c = await prisma.costContract.findUnique({ where: { id: contractId }, include: { file: true } });
    if (!c) return fail("Không tìm thấy hợp đồng");
    if (!c.file) return fail("Hợp đồng này chưa lưu file Excel gốc — bấm Nhập lại file DT-CP");
    let map: { DTCP?: string; BOQ?: string[]; CT?: string } = {};
    try {
      map = JSON.parse(c.sheetMap || "{}");
    } catch {}
    if (!map.DTCP || !map.CT || !map.BOQ?.length) return fail("Hợp đồng chưa chọn đủ sheet DT-CP / BOQ / CHI TIẾT — bấm Nhập lại file DT-CP");
    const f = c.file.data ?? (await getFile(c.file.fileKey)); // file gốc ở KHO FILE (từ 23/11/2026)
    if (!f) return fail("Không đọc được file Excel gốc của hợp đồng — bấm Nhập lại file DT-CP");
    const ab = f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer;
    const snapData = await captureSheets(ab, map.DTCP, map.BOQ, map.CT);
    await prisma.$transaction([prisma.costSheet.deleteMany({ where: { contractId } }), prisma.costSheet.createMany({ data: snapData(contractId) })]);
    return {};
  });
}

// Bước 2: nhập theo lựa chọn sheet / cột đã xác nhận
// Làm chuẩn: nạp thêm các sheet nguồn mà DT-CP / TH đang link tới (tối đa 3 vòng), rồi đưa chi tiết về đúng TH
async function standardizeLines(buf: ArrayBuffer, meta: ImportMeta, lines: ParsedLine[]) {
  const base = [...new Set([meta.dtcpSheet, ...(meta.boqSheets ?? []), meta.ctSheet, ...Object.values(meta.choices).map((c) => c?.sheet ?? "")].filter(Boolean))];
  const extra: string[] = [];
  for (let i = 0; ; i++) {
    const wb = await loadSheets(buf, [...base, ...extra]);
    const r = normalizeDtcp(wb, { dtcpSheet: meta.dtcpSheet, choices: meta.choices, lines, approved: meta.approvedVersion || 0, skipSheets: [meta.dtcpSheet, ...(meta.boqSheets ?? []), meta.ctSheet] });
    const more = r.needSheets.filter((s) => !base.includes(s) && !extra.includes(s));
    if (!more.length || i >= 2) return r;
    extra.push(...more);
  }
}

// Xem trước báo cáo làm chuẩn (không lưu gì)
export async function previewStandardizeAction(form: FormData, meta: ImportMeta) {
  return run(async () => {
    await need();
    const { buf } = await fileOf(form);
    if (!meta.dtcpSheet) fail("Chọn sheet DT-CP");
    const wb = await loadSheets(buf, Object.values(meta.choices).map((c) => c?.sheet ?? "").filter(Boolean));
    const lines = await parseDtcpWorkbook(buf, meta.choices, wb);
    const r = await standardizeLines(buf, meta, lines);
    return { report: r.report as NormRow[], added: r.lines.length - lines.length };
  });
}

export async function importDtcpAction(form: FormData, meta: ImportMeta) {
  return run(async () => {
    const u = await need();
    const { name: fileName, buf } = await fileOf(form);
    if (!meta.name.trim()) fail("Nhập tên công trình / dự án");
    if (!meta.choices.NC?.sheet) fail("Chọn sheet TH Nhân Công (bắt buộc để kiểm soát giá đội)");
    for (const [k, ch] of Object.entries(meta.choices)) if (ch && !ch.colMap.name) fail(`Sheet "${ch.sheet}" (${k}): chưa chọn cột NỘI DUNG`);
    // 6 SHEET BẮT BUỘC (DT-CP, BOQ, CHI TIẾT, TH Vật Tư, TH Nhân Công, TH Thầu Phụ) + TH Thiết Bị TUỲ CHỌN (nhiều DT-CP không có sheet thiết bị)
    const boqSheets = (meta.boqSheets ?? []).filter(Boolean);
    const missingSheets = [
      !meta.dtcpSheet && "DT-CP",
      !boqSheets.length && "BOQ",
      !meta.ctSheet && "CHI TIẾT",
      !meta.choices.VT?.sheet && "TH Vật Tư",
      !meta.choices.NC?.sheet && "TH Nhân Công",
      !meta.choices.TP?.sheet && "TH Thầu Phụ",
    ].filter(Boolean);
    if (missingSheets.length) fail(`DT-CP phải có đủ 6 sheet bắt buộc (DT-CP, BOQ, CHI TIẾT, TH Vật Tư, TH Nhân Công, TH Thầu Phụ; TH Thiết Bị có thể không có). Chưa chọn: ${missingSheets.join(", ")}. Bổ sung sheet còn thiếu vào file DT-CP rồi nhập lại.`);
    // Liên kết của sheet DT-CP chỉ GHI NHẬN để kiểm soát (không chặn nhập): sheet nào công thức đang trỏ tới
    // CHỈ nạp đúng các sheet đã chọn (7 sheet cơ bản) MỘT LẦN, dùng chung cho kiểm tra liên kết, chụp sheet và đọc sheet TH — sheet khác không đọc
    const needSheets = [...new Set([meta.dtcpSheet, ...boqSheets, meta.ctSheet, ...Object.values(meta.choices).map((c) => c?.sheet ?? "")].filter(Boolean))];
    const wb = await loadSheets(buf, needSheets);
    const slimBuf = await slimXlsx(buf, needSheets); // chỉ lưu các sheet cần dùng (bỏ sheet thừa, hình ảnh)
    const slimKey = await putFile(slimBuf); // file gốc ở KHO FILE (src/lib/file-store.ts)
    const linkInfo = JSON.stringify((await dtcpLinks(buf, meta.dtcpSheet, wb)).refs);
    const snapData = await captureSheets(buf, meta.dtcpSheet, boqSheets, meta.ctSheet, wb);
    let lines = await parseDtcpWorkbook(buf, meta.choices, wb);
    let normNote = "";
    if (meta.standardize) {
      const r = await standardizeLines(buf, meta, lines);
      lines = r.lines;
      const moved = r.report.filter((x) => x.status === "copied" || x.status === "converted").length;
      normNote = ` · Làm chuẩn: ${moved} dòng DT-CP đã đưa chi tiết về TH, ${r.report.filter((x) => x.status === "warn").length} cảnh báo`;
    }
    if (!lines.some((l) => l.kind === "NC" && l.level === "ITEM")) fail("Sheet TH Nhân Công không đọc được dòng nào — kiểm tra lại dòng tiêu đề / cột");
    const sheetMap = JSON.stringify({ DTCP: meta.dtcpSheet, BOQ: boqSheets, CT: meta.ctSheet, ...Object.fromEntries(Object.entries(meta.choices).map(([k, c]) => [k, c?.sheet ?? ""])) });
    if (!meta.area) fail("Chọn KHU VỰC của hợp đồng");
    // PHỤ LỤC: chọn hợp đồng GỐC trong danh sách (cùng khu vực) → phụ lục gom về đúng hợp đồng đó (cùng tên dự án). Nhập lại file cho hợp đồng có sẵn: không đổi phụ lục.
    const parent = !meta.contractId && meta.appendixOfId ? await prisma.costContract.findUnique({ where: { id: meta.appendixOfId } }) : null;
    if (!meta.contractId && meta.appendixOfId) {
      if (!parent) fail("Không tìm thấy hợp đồng gốc đã chọn");
      if (parent!.appendixOfId) fail("Chỉ chọn được HỢP ĐỒNG GỐC (không chọn phụ lục khác) làm hợp đồng cho phụ lục");
      if (!(meta.appendixNo ?? "").trim()) fail("Nhập TÊN PHỤ LỤC (PL01, PL02...)");
    }
    // DỰ ÁN chọn từ Danh mục dự án: tên hợp đồng = tên chuẩn của dự án
    const site = parent ? await pickSite(parent.siteId) : await pickSite(meta.siteId || null);
    if (!parent && meta.siteId !== undefined && !site) fail("Chọn DỰ ÁN trong Danh mục dự án");
    const data = {
      area: meta.area,
      ...(site ? { siteId: site.id } : {}),
      name: site ? site.name : parent ? parent.name : meta.name.trim(),
      packageName: meta.packageName.trim(),
      contractNo: meta.contractNo.trim(),
      ...(meta.contractId ? {} : { appendixNo: parent ? (meta.appendixNo ?? "").trim() : "", appendixOfId: parent ? parent.id : null }),
      source: "EXCEL",
      fileName,
      sheetMap,
      versions: JSON.stringify(meta.versions),
      approvedVersion: meta.approvedVersion || 0,
      importedAt: new Date(),
      linkInfo,
    };
    let id = meta.contractId;
    if (id) {
      const c = await prisma.costContract.findUnique({ where: { id } });
      if (!c) fail("Không tìm thấy hợp đồng");
      // dòng PHÁT SINH đã bổ sung từ sổ giá: giữ lại (nối cuối) nếu file mới chưa có
      const extras = await prisma.costLine.findMany({ where: { contractId: id, extra: true }, orderBy: { orderIndex: "asc" } });
      const newKeys = new Set(lines.map((l) => `${l.kind}|${l.key}`));
      const keep = extras.filter((x) => !newKeys.has(`${x.kind}|${x.key}`));
      await prisma.$transaction([
        prisma.costLine.deleteMany({ where: { contractId: id } }),
        prisma.costSheet.deleteMany({ where: { contractId: id } }),
        prisma.costSheet.createMany({ data: snapData(id) }),
        prisma.costFile.deleteMany({ where: { contractId: id } }),
        prisma.costFile.create({ data: { contractId: id, name: fileName, fileKey: slimKey } }),
        prisma.costContract.update({ where: { id }, data }),
        prisma.costLine.createMany({ data: lines.map((l, i) => lineData(id!, l, i)) }),
        prisma.costLine.createMany({ data: keep.map((x, i) => ({ contractId: x.contractId, kind: x.kind, key: x.key, level: x.level, stt: x.stt, name: x.name, unit: x.unit, qty: x.qty, prices: x.prices, amount: x.amount, note: x.note, sourceRow: x.sourceRow, extra: true, orderIndex: lines.length + i })) }),
      ]);
    } else {
      const c = await prisma.costContract.create({ data: { ...data, createdById: u.id, createdByName: u.name } });
      id = c.id;
      await prisma.costLine.createMany({ data: lines.map((l, i) => lineData(id!, l, i)) });
      await prisma.costSheet.createMany({ data: snapData(id) });
      await prisma.costFile.create({ data: { contractId: id, name: fileName, fileKey: slimKey } });
    }
    if (site) await syncSite(site.id);
    const count = (k: CostKind) => lines.filter((l) => l.kind === k && l.level === "ITEM");
    const info = (["NC", "TP", "VT", "TB"] as CostKind[])
      .filter((k) => meta.choices[k])
      .map((k) => `${{ NC: "Nhân Công", TP: "Thầu Phụ", VT: "Vật Tư", TB: "Thiết Bị" }[k]}: ${count(k).length} dòng, ${Math.round(count(k).reduce((s, l) => s + (l.amount ?? 0), 0)).toLocaleString("vi-VN")} đ`)
      .join(" · ");
    return { id: id!, info: info + normNote };
  });
}

export async function createFromProjectAction(projectId: string) {
  return run(async () => {
    const u = await need();
    return { id: await ensureContractFromProject(projectId, { id: u.id, name: u.name }) };
  });
}

// Cập nhật từ DT-CP phần mềm: thêm 1 thời điểm mới (giá mới), giữ giá các thời điểm trước
export async function syncFromProjectAction(contractId: string) {
  return run(async () => {
    await need();
    const c = await prisma.costContract.findUnique({ where: { id: contractId }, include: { lines: true } });
    if (!c || c.source !== "APP" || !c.projectId) return fail("Hợp đồng không lấy từ DT-CP phần mềm");
    const { out } = await snapshotNc(c.projectId);
    const versions = parseVersions(c.versions);
    const n = Math.max(0, ...versions.map((v) => v.n)) + 1;
    const today = new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    const old = new Map(c.lines.map((l) => [l.key, parsePrices(l.prices)]));
    await prisma.$transaction([
      prisma.costLine.deleteMany({ where: { contractId } }),
      prisma.costLine.createMany({
        data: out.map((l, i) => ({ contractId, kind: "NC", key: l.key, level: l.level, stt: l.stt, name: l.name, unit: l.unit, qty: l.level === "ITEM" ? l.qty : null, prices: JSON.stringify(l.level === "ITEM" ? { ...(old.get(l.key) ?? {}), [String(n)]: l.price } : {}), amount: l.level === "ITEM" ? l.amount : null, note: l.note, orderIndex: i, extra: !!l.extra })),
      }),
      prisma.costContract.update({ where: { id: contractId }, data: { versions: JSON.stringify([...versions, { n, label: `Thời điểm ${n} (cập nhật ${today})`, approved: false }]), importedAt: new Date() } }),
    ]);
    return { info: `Đã thêm Thời điểm ${n}. Nếu đây là bản đã duyệt, chọn lại "Thời điểm đã duyệt".` };
  });
}

export async function updateContractAction(id: string, d: { area: string; siteId?: string; name: string; packageName: string; contractNo: string; appendixNo?: string; appendixOfId?: string; approvedVersion: number }) {
  return run(async () => {
    await need();
    const c = await prisma.costContract.findUnique({ where: { id } });
    if (!c) return fail("Không tìm thấy hợp đồng");
    if (!d.name.trim()) fail("Tên công trình không được trống");
    // PHỤ LỤC: chọn hợp đồng GỐC (không chọn chính nó, không chọn phụ lục khác; hợp đồng đang có phụ lục thì không thể trở thành phụ lục)
    let parentId: string | null = null;
    if (d.appendixOfId) {
      const parent = await prisma.costContract.findUnique({ where: { id: d.appendixOfId } });
      if (!parent || parent.id === id) fail("Chọn hợp đồng gốc khác với chính hợp đồng này");
      if (parent!.appendixOfId) fail("Chỉ chọn được HỢP ĐỒNG GỐC (không chọn phụ lục khác)");
      if (await prisma.costContract.count({ where: { appendixOfId: id } })) fail("Hợp đồng này đang có phụ lục gắn vào nên không thể đặt làm phụ lục của hợp đồng khác");
      if (!(d.appendixNo ?? "").trim()) fail("Nhập TÊN PHỤ LỤC (PL01, PL02...)");
      parentId = parent!.id;
    }
    const versions = parseVersions(c.versions).map((v) => ({ ...v, approved: v.n === d.approvedVersion }));
    // DANH MỤC DỰ ÁN: phụ lục theo dự án của hợp đồng gốc; hợp đồng gốc đổi dự án thì các phụ lục đổi theo
    const parentSite = parentId ? (await prisma.costContract.findUnique({ where: { id: parentId }, select: { siteId: true } }))?.siteId : null;
    const site = await pickSite(parentSite || d.siteId || null);
    if (site) {
      await prisma.costContract.updateMany({ where: { OR: [{ id }, { appendixOfId: id }] }, data: { siteId: site.id } });
      d = { ...d, name: site.name };
    }
    await prisma.costContract.update({ where: { id }, data: { area: d.area, name: d.name.trim(), packageName: d.packageName.trim(), contractNo: d.contractNo.trim(), appendixNo: (d.appendixNo ?? "").trim(), appendixOfId: parentId, approvedVersion: d.approvedVersion, versions: JSON.stringify(versions) } });
    if (site) await syncSite(site.id);
    return {};
  });
}

export async function deleteContractAction(id: string) {
  return run(async () => {
    await need();
    const n = await prisma.priceSubmission.count({ where: { contractId: id } });
    if (n) fail(`Hợp đồng đã có ${n} hồ sơ trình giá — không xoá được`);
    await prisma.costContract.delete({ where: { id } });
    return {};
  });
}

// TRƯỞNG PHÒNG điều chỉnh dòng DT-CP (TH Nhân Công = giá đội, TH Thầu Phụ) sau khi QSTT / QSĐT đã nhập file: sửa tên, ĐVT, khối lượng, đơn giá từng thời điểm (TĐ).
// Khoá dòng giữ nguyên (không đổi theo tên) nên các hồ sơ đã khớp, sổ giá đã duyệt không bị lệch. Ghi nhật ký để truy vết người sửa.
export type CostLinePatch = { name?: string; unit?: string; qty?: number | null; price?: { ver: number; value: number | null } };
export async function tpEditCostLineAction(contractId: string, lineKey: string, patch: CostLinePatch) {
  return run(async () => {
    const u = await getPriceUser();
    if (!u) fail("Chưa đăng nhập");
    if (!isTP(u!)) fail("Chỉ Trưởng phòng / quản trị được điều chỉnh dòng DT-CP");
    const row = await prisma.costLine.findFirst({ where: { contractId, key: lineKey, kind: { in: ["NC", "TP"] }, level: "ITEM" } });
    if (!row) return fail("Không tìm thấy dòng DT-CP");
    const data: { name?: string; unit?: string; qty?: number | null; prices?: string } = {};
    const notes: string[] = [];
    if (patch.name !== undefined) {
      const v = patch.name.trim();
      if (!v) fail("Tên công việc không được để trống");
      if (v !== row.name) {
        data.name = v;
        notes.push(`tên "${row.name.slice(0, 40)}" → "${v.slice(0, 40)}"`);
      }
    }
    if (patch.unit !== undefined && patch.unit.trim() !== row.unit) {
      data.unit = patch.unit.trim();
      notes.push(`ĐVT "${row.unit}" → "${data.unit}"`);
    }
    if (patch.qty !== undefined && patch.qty !== row.qty) {
      data.qty = patch.qty;
      notes.push(`KL ${row.qty ?? "—"} → ${patch.qty ?? "—"}`);
    }
    if (patch.price) {
      const pr = parsePrices(row.prices);
      const k = String(patch.price.ver);
      const old = pr[k];
      if (patch.price.value == null) delete pr[k];
      else pr[k] = patch.price.value;
      if (old !== patch.price.value) {
        data.prices = JSON.stringify(pr);
        notes.push(`đơn giá TĐ${patch.price.ver || "1"} ${old ?? "—"} → ${patch.price.value ?? "—"}`);
      }
    }
    if (!notes.length) return {};
    await prisma.costLine.update({ where: { id: row.id }, data });
    await prisma.procLog.create({ data: { entity: "HD", entityId: contractId, action: `Trưởng phòng điều chỉnh DT-CP (${row.kind === "TP" ? "Thầu phụ" : "Nhân công"})`, userName: u!.name, note: `${row.name.slice(0, 60)}: ${notes.join("; ")}` } });
    return {};
  });
}

export type { ColMap };
