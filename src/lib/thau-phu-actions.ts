"use server";

import { getFile, putFile } from "@/lib/file-store";
import { revalidatePath } from "next/cache";
import { slimXlsx } from "@/lib/xlsx-slim";
import { prisma } from "@/lib/prisma";
import { asSub, canPrice, canReviewCategory, canSeeSub, CATEGORIES, categoryLabel, getPriceUser, logPrice, type PriceRole, type PriceUser } from "@/lib/gia-doi";
import { buildSubExport } from "@/lib/thau-phu-export";
import { readScopeSheet, parseSubWorkbook, readBidCols, sheetColumns, previewSubSheet, parseSubSheetWith, subSheetNames, type BidColDef, type SheetCol, type SubColMap, type SubMapping, type SubSheetPreview } from "@/lib/thau-phu-excel";
import { XlsxTooBigError } from "@/lib/xlsx-subset";
import { amt, apprPriceOf, baseOfLine, cleanSavedTot, evalVat, extraSum, fixedTerms, headMissing, isTotFxRow, parseExtras, parseSavedTotals, parseVatRows, parseJson, propPriceOf, propQtyOf, SUB_STATUS, termAppr, totFxRow, totFxTk, type Bid, type Bidder, type ExtraRow, type SavedTot, type VatRow, type Term } from "@/lib/thau-phu-calc";
import { remapIds } from "@/lib/xl-formula";
import { ntContext, subAutoMatch, subRefs, toNums } from "@/lib/thau-phu";
import { extractSheetImages } from "@/lib/xlsx-images";
import { normalizeImage, removeImageFile, writeProjectImage } from "@/lib/uploads";
import { AREAS } from "@/lib/perms";
import { loadSites, siteFields, siteFromName } from "@/lib/project-site";
import { lineKeyOf } from "@/lib/hop-dong-calc";
import { buildDraftEml, parseEmails, SIGNATURE_SLOT } from "@/lib/mailer";
import { copyFormulas, freshIdMap, mergeFormulas, newIdMap } from "@/lib/xl-save";

// Server action TRÌNH GIÁ THẦU PHỤ. Luôn trả {ok, error}. Log dùng ProcLog entity "TPH".
type SubExtra = { names?: string[]; preview?: SubSheetPreview }; // bước chọn cột khi nhập file: danh sách sheet / bản xem trước sheet
export type SubResult = ({ ok: true; id?: string; info?: string; file?: { name: string; base64: string } } & SubExtra) | { ok: false; error: string };
class SubError extends Error {}
const fail = (m: string): never => {
  throw new SubError(m);
};
async function run(fn: () => Promise<string | void | ({ id?: string; info?: string; file?: { name: string; base64: string } } & SubExtra)>): Promise<SubResult> {
  try {
    const r = await fn();
    revalidatePath("/gia-doi", "layout");
    if (typeof r === "string") return { ok: true, id: r };
    return { ok: true, ...(r ?? {}) };
  } catch (e) {
    if (e instanceof SubError || e instanceof XlsxTooBigError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Lỗi hệ thống, thử lại hoặc báo quản trị." };
  }
}
async function need(...roles: PriceRole[]): Promise<PriceUser> {
  const pu = await getPriceUser();
  if (!pu) fail("Chưa đăng nhập");
  const u = asSub(pu!);
  if (!canSeeSub(u)) fail("Bạn chưa được cấp quyền Trình giá thầu phụ");
  if (roles.length && !canPrice(u, ...roles)) fail("Bạn không có quyền thực hiện thao tác này");
  return u;
}
// file Excel gốc: ở KHO FILE (fileKey, từ 23/11/2026); hồ sơ cũ chưa chuyển thì còn trong fileData
const storedFileOf = async (p: { fileData: Uint8Array | null; fileKey: string | null }) => p.fileData ?? (await getFile(p.fileKey));

async function load(id: string) {
  const p = await prisma.subProposal.findUnique({ where: { id }, include: { lines: { orderBy: { orderIndex: "asc" } } } });
  if (!p) fail("Không tìm thấy hồ sơ");
  return p!;
}
const log = (id: string, action: string, user: string, note = "") => prisma.procLog.create({ data: { entity: "TPH", entityId: id, action, userName: user, note } });
async function nextCode() {
  const head = `TP${String(new Date().getFullYear()).slice(2)}-`;
  const last = await prisma.subProposal.findFirst({ where: { code: { startsWith: head } }, select: { code: true }, orderBy: { code: "desc" } });
  return head + String(last ? Number(last.code.slice(head.length)) + 1 : 1).padStart(4, "0");
}
const str = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
void logPrice;

// ---- QSTT / QSĐT tải file "BẢNG ĐỀ XUẤT KÝ HỢP ĐỒNG THẦU PHỤ": chọn sheet → BẢNG CHỌN CỘT (nội dung, giá CĐT, giá cơ sở, thầu phụ 1/2/3..., giá duyệt) → nhập ----
async function subFileOf(form: FormData): Promise<{ f: File; buf: ArrayBuffer }> {
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) fail("Chưa chọn file Excel");
  const f = file as File;
  if (!/.xlsx$/i.test(f.name)) fail("Chỉ nhận file .xlsx");
  return { f, buf: await f.arrayBuffer() };
}

// Bước 1: các sheet hiện của file
export async function analyzeSubFileAction(form: FormData) {
  return run(async () => {
    await need("QSTT", "QSDT");
    const { buf } = await subFileOf(form);
    let names: string[] = [];
    try {
      names = await subSheetNames(buf);
    } catch {
      return fail("Không đọc được file Excel (file hỏng hoặc không phải .xlsx)");
    }
    if (!names.length) return fail("File không có sheet nào hiện");
    return { names };
  });
}

// Bước 2: xem trước 1 sheet + gợi ý cột (chỉ nạp đúng sheet đó)
export async function subSheetPreviewAction(form: FormData, sheet: string) {
  return run(async () => {
    await need("QSTT", "QSDT");
    const { buf } = await subFileOf(form);
    try {
      return { preview: await previewSubSheet(buf, sheet) };
    } catch (e) {
      if (e instanceof XlsxTooBigError) throw e;
      console.error(e);
      return fail("Không đọc được sheet này");
    }
  });
}

export type SubImportItem = { sheet: string; mapping: SubMapping };
// Lựa chọn QSĐT trong BẢNG CHỌN hiện ra trước khi chọn file: HĐTP mới / phụ lục, loại phụ lục, hình thức giao thầu (+ giá trị vật tư / thiết bị nếu có)
export type SubImportChoice = { proposalType: string; plKind: string; priceMode?: string; awardForm: string; vtValue: number | null; tbValue: number | null; isMep?: boolean; mepTemp?: boolean; oneQty?: boolean; isNt?: boolean };

// NỘI THẤT: ảnh trong sheet Excel → ảnh của dòng. Ảnh nổi trên ô gắn theo dòng MÉP TRÊN của ảnh (ảnh sản phẩm thường cao, phủ xuống
// các dòng phần việc bên dưới); không trùng dòng nào thì gắn dòng gần nhất phía trên (trong 3 dòng). Ảnh nén ≤ 1MB, lưu ổ đĩa như ảnh BOQ.
async function importSubImages(proposalId: string, buf: ArrayBuffer | Uint8Array, sheetName: string): Promise<number> {
  let imgs: Awaited<ReturnType<typeof extractSheetImages>> = [];
  try {
    imgs = await extractSheetImages(Buffer.from(buf as ArrayBuffer), sheetName);
  } catch (e) {
    console.error("[ảnh nội thất]", e);
    return 0;
  }
  if (!imgs.length) return 0;
  const lines = await prisma.subLine.findMany({ where: { proposalId, sourceRow: { gt: 0 } }, select: { id: true, sourceRow: true }, orderBy: { sourceRow: "asc" } });
  const order = new Map<string, number>();
  let n = 0;
  for (const im of imgs) {
    const row = im.top ?? im.row;
    const line = lines.find((l) => l.sourceRow === row) ?? [...lines].reverse().find((l) => l.sourceRow < row && row - l.sourceRow <= 3);
    if (!line) continue;
    const img = await normalizeImage(im.data);
    if (!img) continue;
    const oi = order.get(line.id) ?? 0;
    order.set(line.id, oi + 1);
    await prisma.subLineImage.create({ data: { proposalId, lineId: line.id, fileName: writeProjectImage(proposalId, img), mime: img.mime, width: img.width, height: img.height, orderIndex: oi } });
    n++;
  }
  return n;
}
// chép ảnh các dòng sang hồ sơ mới (trình lại / trình phần việc khác): dùng chung file ảnh, chỉ thêm bản ghi
async function copySubImages(fromId: string, toId: string, idMap: Map<string, string>) {
  const imgs = await prisma.subLineImage.findMany({ where: { proposalId: fromId } });
  const data = imgs.filter((im) => idMap.has(im.lineId)).map((im) => ({ proposalId: toId, lineId: idMap.get(im.lineId)!, fileName: im.fileName, mime: im.mime, width: im.width, height: im.height, orderIndex: im.orderIndex }));
  if (data.length) await prisma.subLineImage.createMany({ data });
}
// Bước 3: nhập — mỗi sheet 1 hồ sơ, đọc theo ĐÚNG cột người dùng đã chọn
export async function uploadSubFileAction(form: FormData, items: SubImportItem[], choice?: SubImportChoice) {
  return run(async () => {
    const u = await need("QSTT", "QSDT");
    const { f, buf } = await subFileOf(form);
    if (!items?.length) fail("Chọn ít nhất 1 sheet để nhập");
    for (const it of items) if (!it.mapping?.colMap?.content || !it.mapping.hr) fail(`Sheet "${it.sheet}": chưa chọn cột NỘI DUNG CÔNG VIỆC / dòng tiêu đề`);
    const ids: string[] = [];
    const empty: string[] = [];
    const scope = await readScopeSheet(buf); // sheet PHẠM VI CÔNG VIỆC (nếu có) — dùng chung cho các hồ sơ tạo từ file này
    const nt = !!choice?.isNt; // NỘI THẤT: cột kích thước = Dài / Rộng / Cao, nhận dòng sản phẩm / phần việc, lấy ảnh
    const sites = await loadSites(); // tên công trình trong file trùng tên / tên gọi khác của dự án trong danh mục → tự chọn dự án
    for (const it of items) {
      const sh = await parseSubSheetWith(buf, it.sheet, nt ? { ...it.mapping, colMap: { ...it.mapping.colMap, nt: true } } : it.mapping);
      if (!sh || !sh.itemCount) {
        empty.push(it.sheet);
        continue;
      }
      const awarded = (it.mapping.colMap.award ?? []).filter((a) => a.pct > 0).flatMap((a) => sh.bidders.filter((b) => b.key === a.key));
      // mỗi hồ sơ chỉ lưu sheet của mình (bỏ sheet thừa, hình ảnh — nội thất giữ ảnh để "Đọc lại file" lấy lại được ảnh)
      const slimBuf = await slimXlsx(buf, [sh.sheetName], { dropImages: !nt });
      const p = await prisma.subProposal.create({
        data: {
          code: await nextCode(),
          ...sh.head,
          ...siteFromName(sh.head.projectName, sites),
          revision: 0, // lần trình do QSĐT chọn
          bidders: JSON.stringify(sh.bidders),
          // LỰA CHỌN PHÊ DUYỆT: thầu phụ đầu tiên được giao (nhiều thầu phụ → tên ghép "A + B", giá đề xuất là bình quân theo % ở từng dòng)
          selectedBidder: awarded[0]?.key ?? sh.bidders[0]?.key ?? "",
          subName: awarded.length ? awarded.map((a) => a.name).join(" + ") : sh.bidders[0]?.name ?? "",
          prelim: JSON.stringify(sh.prelim),
          vat: JSON.stringify(sh.vat),
          terms: JSON.stringify(sh.terms),
          scope: JSON.stringify(scope),
          fileName: f.name,
          fileKey: await putFile(slimBuf), // file gốc ở KHO FILE (src/lib/file-store.ts)
          // loại đề xuất / loại phụ lục / hình thức giao thầu: theo BẢNG CHỌN của QSĐT; chưa chọn loại phụ lục thì gợi ý theo cột trong file
          proposalType: choice?.proposalType === "HDTP" || choice?.proposalType === "PL" ? choice.proposalType : "",
          plKind: choice?.proposalType === "PL" ? (choice.plKind === "CONG_GOP" || choice.plKind === "DIEU_CHINH" ? choice.plKind : sh.plKind === "DIEU_CHINH" ? "DIEU_CHINH" : "") : "",
          awardForm: choice && ["VT", "TB", "NC"].includes(choice.awardForm) ? choice.awardForm : "",
          priceMode: choice?.priceMode === "CHITIET" || (choice?.isMep && choice?.mepTemp) ? "CHITIET" : "TONG",
          oneQty: !!choice?.oneQty && !(choice?.proposalType === "PL" && choice?.plKind === "DIEU_CHINH"), // dùng chung 1 khối lượng
          mepTemp: !nt && !!choice?.isMep && !!choice?.mepTemp, // MEP TẠM: thuê vật tư (khấu hao)
          isMep: !nt && !!choice?.isMep, // trình thầu phụ MEP: thêm cột Mã hiệu sản phẩm + Nhãn hiệu - xuất xứ
          isNt: nt, // trình thầu phụ NỘI THẤT
          vtValue: num(choice?.vtValue),
          tbValue: num(choice?.tbValue),
          sheetName: sh.sheetName,
          colMap: JSON.stringify(sh.colMap),
          headRows: JSON.stringify({ ...sh.headRows, first: it.mapping.first ?? sh.headRows.header + 2, termCols: undefined }),
          createdById: u.id,
          createdByName: u.name,
          lines: { create: sh.lines.map((l, i) => ({ ...l, bids: JSON.stringify(l.bids), orderIndex: i })) },
        },
      });
      const nImg = nt ? await importSubImages(p.id, buf, sh.sheetName) : 0;
      await log(p.id, "Tải file đề xuất thầu phụ lên (chọn cột)", u.name, `${f.name} — sheet "${sh.sheetName}", ${sh.itemCount} dòng, ${sh.bidders.length} thầu phụ báo giá${nt ? `, nội thất: ${sh.lines.filter((l) => l.level === "SP").length} sản phẩm, ${nImg} ảnh` : ""}`);
      ids.push(p.id);
    }
    if (!ids.length) return fail(`Không đọc được dòng công việc nào theo các cột đã chọn (sheet: ${empty.join(", ")}) — kiểm tra lại dòng bắt đầu dữ liệu và cột Nội dung công việc`);
    const info = [ids.length > 1 ? `Đã tạo ${ids.length} hồ sơ (mỗi sheet 1 hồ sơ)` : "", empty.length ? `Không đọc được: ${empty.join(", ")}` : ""].filter(Boolean).join(" — ");
    return { id: ids[0], info: info || undefined };
  });
}

// ĐỌC LẠI FILE EXCEL đã tải lên (sau khi phần mềm đọc file tốt hơn: điều khoản, thầu phụ, VAT...) — chỉ hồ sơ chưa trình.
// Thay toàn bộ bảng + điều khoản + thầu phụ bằng dữ liệu đọc lại; giữ thầu phụ đang chọn nếu còn trong file.
export async function rereadSubFileAction(id: string) {
  return run(async () => {
    const u = await need("QSTT", "QSDT");
    const p = await prisma.subProposal.findUnique({ where: { id } });
    if (!p) return fail("Không tìm thấy hồ sơ");
    assertEditable(p, u);
    const file = await storedFileOf(p);
    if (!file) fail("Hồ sơ không còn file gốc");
    const buf = file!.buffer.slice(file!.byteOffset, file!.byteOffset + file!.byteLength) as ArrayBuffer;
    // đọc lại theo ĐÚNG cột đã chọn khi nhập (và cột thầu phụ QSĐT đã chỉnh); hồ sơ cũ chưa lưu cột thì tự đoán lại
    let mapping: SubMapping | null = null;
    try {
      const cm = JSON.parse(p.colMap) as SubColMap;
      const hrs = JSON.parse(p.headRows) as Record<string, number>;
      const bd = JSON.parse(p.bidders) as { key: string; name: string }[];
      if (cm?.content && hrs?.header) mapping = { hr: hrs.header, first: hrs.first, colMap: cm, bidders: bd };
    } catch {}
    const sh = mapping ? await parseSubSheetWith(buf, p.sheetName, mapping) : (await parseSubWorkbook(buf)).find((s) => s.sheetName === p.sheetName);
    if (!sh) fail(`Không đọc được sheet "${p.sheetName}" (sheet đang ẩn hoặc không đúng mẫu)`);
    const s = sh!;
    const keep = s.bidders.find((b) => b.key === p.selectedBidder);
    await prisma.$transaction([
      prisma.subLine.deleteMany({ where: { proposalId: id } }),
      prisma.subProposal.update({
        where: { id },
        data: {
          ...Object.fromEntries(Object.entries(s.head).filter(([, v]) => v)),
          bidders: JSON.stringify(s.bidders),
          selectedBidder: keep?.key ?? s.bidders[0]?.key ?? "",
          subName: keep ? p.subName : (s.bidders[0]?.name ?? p.subName),
          prelim: JSON.stringify(s.prelim),
          vat: JSON.stringify(s.vat),
          terms: JSON.stringify(s.terms),
          colMap: JSON.stringify(s.colMap),
          headRows: JSON.stringify({ ...s.headRows, termCols: undefined }),
          lines: { create: s.lines.map((l, i) => ({ ...l, bids: JSON.stringify(l.bids), orderIndex: i })) },
        },
      }),
    ]);
    const n = p.contractId ? await subAutoMatch(id, p.contractId) : 0;
    const nImg = p.isNt ? await importSubImages(id, file!, p.sheetName) : 0; // dòng cũ xoá kéo theo ảnh cũ → lấy lại ảnh từ file
    await log(id, "Đọc lại file Excel", u.name, `${s.itemCount} dòng, ${s.bidders.length} thầu phụ, ${s.terms.length} điều khoản${p.contractId ? `, tự khớp ${n} dòng DT-CP` : ""}${p.isNt ? `, ${nImg} ảnh` : ""}`);
    return { info: `Đã đọc lại file: ${s.itemCount} dòng công việc, ${s.bidders.length} thầu phụ (${s.bidders.map((b) => b.name).join(", ")}), ${s.terms.length} điều khoản.` };
  });
}

// ---- QSTT kiểm tra / bổ sung ----
export type SubHead = { area: string; revision: number; branch: string; proposalType: string; plKind: string; awards?: { key: string; pct: number }[]; priceMode: string; isMep?: boolean; mepTemp?: boolean; isNt?: boolean; oneQty?: boolean; hdtpNo: string; awardForm: string; vtValue: number | null; tbValue: number | null; otherValue?: number | null; signedValue?: number | null; hdtpId: string; siteId?: string; projectName: string; projectCode: string; cdtContract: string; itemName: string; selectedBidder: string; subName: string; qsNote: string; prelim: Record<string, number>; vat: Record<string, number>; terms: Term[]; extras?: ExtraRow[]; vatRows?: VatRow[] } & TotFxInput;
// công thức gõ ở các dòng từ TỔNG CỘNG trở xuống (khoá "<dòng>|<tổng cột>", xem chainTotals ở thau-phu-calc.ts) + số tổng đã tính của các cột có công thức
// totalShown = các tổng cột đang hiện trên màn hình người lưu (số của các cột này được thay bằng số gửi lên; cột khác giữ số đã lưu)
export type TotFxInput = { totalFormulas?: Record<string, string>; totalAmounts?: Record<string, SavedTot>; totalShown?: string[] };
// id "new:..." = dòng thêm mới trên phần mềm (chưa lưu). QSĐT/QSTT sửa được MỌI ô của dòng (các trường tuỳ chọn gửi kèm khi có sửa)
export type SubLineInput = {
  id: string; stt: string; content: string; unit: string; propQty: number | null; propPrice: number | null; lineKey: string; qsNote: string; note: string; formulas?: Record<string, string>;
  workName?: string; code?: string; origin?: string; dims?: string; noMgmt?: boolean;
  material?: string; dimL?: string; dimW?: string; dimH?: string; // NỘI THẤT: mô tả vật liệu, dài / rộng / cao
  level?: string; // phân cấp do QSTT chọn: "SUB" = đầu mục cấp 1 (I, II...), "GROUP" = cấp 2 (A, B...), "ITEM" = dòng công tác; nội thất: "SP" = sản phẩm, "REF" = phần việc khác (tham khảo)
  hdQty?: number | null; hdPrice?: number | null; // PLHĐ điều chỉnh: KL / đơn giá theo hợp đồng gốc (QSĐT sửa được)
  cdtVt?: number | null; cdtNc?: number | null; cdtKh?: number | null; // MEP: giá chi tiết vật tư / nhân công của khối CĐT
  baseVt?: number | null; baseNc?: number | null; baseTb?: number | null; // giá chi tiết của khối cơ sở
  propVt?: number | null; propNc?: number | null; propTb?: number | null; // giá chi tiết: đơn giá vật tư / nhân công / thiết bị của khối đề xuất
  cdtHdQty?: number | null; cdtHdPrice?: number | null; baseHdQty?: number | null; baseHdPrice?: number | null; // PLHĐ điều chỉnh: khối CĐT / cơ sở theo hợp đồng
  cdtQty?: number | null; cdtPrice?: number | null; baseQty?: number | null; basePrice?: number | null; baseManual?: boolean; baseNote?: string;
  bids?: Record<string, Bid>;
};
// ô số QSĐT/QSTT được đặt công thức / ô Trưởng phòng – Phó Tổng được đặt công thức (src/lib/xl-formula.ts)
const SUB_QS_KEYS = ["propQty", "propPrice", "cdtQty", "cdtPrice", "cdtVt", "cdtNc", "cdtKh", "baseQty", "basePrice", "baseVt", "baseNc", "baseTb", "propVt", "propNc", "propTb", "hdQty", "hdPrice", "cdtHdQty", "cdtHdPrice", "baseHdQty", "baseHdPrice"];
const subQsKeys = (bidders: Bidder[]) => [...SUB_QS_KEYS, ...bidders.flatMap((b) => [`bq:${b.key}`, `bp:${b.key}`, `bv:${b.key}`, `bn:${b.key}`, `bt:${b.key}`])];
// dòng thuế bổ sung: chuẩn hoá trước khi lưu
const cleanVatRows = (rows: VatRow[] | undefined, bidders: Bidder[]): VatRow[] => {
  const cols = new Set(["A", "B", "D", ...bidders.map((b) => b.key)]);
  return (rows ?? []).slice(0, 20).map((r, i) => ({
    id: str(r.id) || `v${i}`,
    label: str(r.label).slice(0, 200),
    vals: Object.fromEntries(Object.entries(r.vals ?? {}).filter(([k, v]) => cols.has(k) && String(v ?? "").trim() !== "").map(([k, v]) => [k, String(v).trim().slice(0, 200)])),
  }));
};
// dòng chi phí thêm dưới TỔNG CỘNG: chuẩn hoá trước khi lưu
const cleanExtras = (rows: ExtraRow[] | undefined, bidders: Bidder[]): ExtraRow[] => {
  const cols = new Set(["A", "B", "D", "AH", "BH", "H", ...bidders.map((b) => b.key)]); // AH / BH / H = cột theo hợp đồng gốc (PLHĐ điều chỉnh)
  return (rows ?? []).slice(0, 100).map((r, i) => ({
    id: str(r.id) || `x${i}`,
    stt: str(r.stt),
    label: str(r.label),
    vals: Object.fromEntries(Object.entries(r.vals ?? {}).filter(([k, v]) => cols.has(k) && num(v) != null).map(([k, v]) => [k, num(v)])),
    rates: Object.fromEntries(Object.entries(r.rates ?? {}).filter(([k, v]) => cols.has(k) && String(v ?? "").trim() !== "").map(([k, v]) => [k, String(v).trim().slice(0, 100)])),
  }));
};
const SUB_TP_KEYS = ["tpPrice"];
const SUB_LEVELS = ["ITEM", "GROUP", "SUB", "SP", "REF"]; // SP / REF: dòng sản phẩm / phần việc khác của hồ sơ nội thất
// gộp công thức dòng tổng gửi lên vào công thức đang lưu: chỉ các tổng cột người này được sửa (may); dòng mới "new:..." đổi sang mã thật
function mergeTotFx(old: string | null | undefined, sent: Record<string, string> | undefined, may: (tk: string) => boolean, idMap?: Map<string, string>): string {
  const out = Object.fromEntries(Object.entries(parseJson<Record<string, unknown>>(old || "{}", {})).filter(([k, v]) => typeof v === "string" && !may(totFxTk(k)))) as Record<string, string>;
  for (const [k, v] of Object.entries(sent ?? {})) {
    if (typeof v !== "string" || k.length > 200 || !may(totFxTk(k)) || !isTotFxRow(totFxRow(k))) continue;
    const f = v.trim();
    if (f.startsWith("=") && f.length <= 2000) out[k] = idMap ? remapIds(f, idMap) : f;
  }
  return JSON.stringify(out);
}
// số tổng theo công thức: thay số của các cột đang hiện ở màn hình người lưu; cột không còn công thức nào thì bỏ (về lại số tự cộng)
function mergeTotAmounts(old: string | null | undefined, sent: Record<string, unknown> | undefined, shown: string[] | undefined, fxJson: string): string {
  const out = parseSavedTotals(old);
  const sh = new Set((shown ?? []).map(String));
  for (const tk of sh) delete out[tk];
  for (const [tk, v] of Object.entries(sent ?? {})) {
    const t = sh.has(tk) ? cleanSavedTot(v) : null;
    if (t) out[tk] = t;
  }
  const fxTks = new Set(Object.keys(parseJson<Record<string, string>>(fxJson, {})).map(totFxTk));
  for (const tk of Object.keys(out)) if (!fxTks.has(tk === "R" ? "D" : tk)) delete out[tk];
  return JSON.stringify(out);
}
function totFxData(p: { totalFormulas: string; totalAmounts: string }, h: TotFxInput, may: (tk: string) => boolean, idMap?: Map<string, string>) {
  if (h.totalFormulas === undefined) return {};
  const totalFormulas = mergeTotFx(p.totalFormulas, h.totalFormulas, may, idMap);
  return { totalFormulas, totalAmounts: mergeTotAmounts(p.totalAmounts, h.totalAmounts, h.totalShown, totalFormulas) };
}

// QSĐT sửa khi hồ sơ đang lập; đã chuyển QSTT thì chỉ QSTT sửa (hoặc trả lại QSĐT)
function assertEditable(p: { status: string }, u: PriceUser) {
  if (p.status === "DRAFT" || p.status === "NEED_INFO") return; // NEED_INFO: Trưởng phòng yêu cầu QSĐT bổ sung
  if (p.status === "QS_CHECK") {
    if (!canPrice(u, "QSTT")) fail("Hồ sơ đã chuyển QSTT kiểm tra — QSĐT không sửa được (chờ QSTT trả lại)");
    return;
  }
  fail("Hồ sơ đã trình, không sửa được (rút lại trước)");
}

// `lines` = TOÀN BỘ bảng theo thứ tự trên màn hình: dòng "new:..." = thêm mới (dòng công việc, không có trong file gốc);
// dòng công việc có trong hồ sơ mà không còn trong `lines` = đã xoá. Đầu mục (A, I...) không xoá được.
async function saveQs(u: PriceUser, id: string, h: SubHead, lines: SubLineInput[]) {
  const p = await load(id);
  assertEditable(p, u);
  const own = new Map(p.lines.map((l) => [l.id, l]));
  const sent = new Set(lines.map((l) => l.id));
  const removed = p.lines.filter((l) => !sent.has(l.id) && l.level !== "GROUP" && l.level !== "SUB").map((l) => l.id); // đầu mục A, I... không xoá; dòng sản phẩm / phần việc (nội thất) xoá được
  const bidders = parseJson<Bidder[]>(p.bidders, []);
  const keys = subQsKeys(bidders);
  const bidKeys = new Set(bidders.map((b) => b.key));
  // chỉ ghi các trường client có gửi (undefined = không đổi) → vẫn tương thích nơi khác gọi saveQs với dữ liệu cũ
  const data = (l: SubLineInput) => ({
    content: str(l.content), unit: str(l.unit), propQty: num(l.propQty), propPrice: num(l.propPrice), lineKey: str(l.lineKey), qsNote: str(l.qsNote), note: str(l.note),
    ...(l.level && SUB_LEVELS.includes(l.level) ? { level: l.level } : {}),
    ...(l.workName !== undefined ? { workName: str(l.workName) } : {}),
    ...(l.material !== undefined ? { material: str(l.material) } : {}),
    ...(l.dimL !== undefined ? { dimL: str(l.dimL) } : {}),
    ...(l.dimW !== undefined ? { dimW: str(l.dimW) } : {}),
    ...(l.dimH !== undefined ? { dimH: str(l.dimH) } : {}),
    ...(l.code !== undefined ? { code: String(l.code ?? "").trim() } : {}),
    ...(l.noMgmt !== undefined ? { noMgmt: !!l.noMgmt } : {}),
    ...(l.origin !== undefined ? { origin: String(l.origin ?? "").trim() } : {}),
    ...(l.dims !== undefined ? { dims: str(l.dims) } : {}),
    ...(l.cdtHdQty !== undefined ? { cdtHdQty: num(l.cdtHdQty) } : {}),
    ...(l.cdtHdPrice !== undefined ? { cdtHdPrice: num(l.cdtHdPrice) } : {}),
    ...(l.baseHdQty !== undefined ? { baseHdQty: num(l.baseHdQty) } : {}),
    ...(l.baseHdPrice !== undefined ? { baseHdPrice: num(l.baseHdPrice) } : {}),
    ...(l.cdtVt !== undefined ? { cdtVt: num(l.cdtVt) } : {}),
    ...(l.cdtNc !== undefined ? { cdtNc: num(l.cdtNc) } : {}),
    ...(l.cdtKh !== undefined ? { cdtKh: num(l.cdtKh) } : {}),
    ...(l.baseVt !== undefined ? { baseVt: num(l.baseVt) } : {}),
    ...(l.baseNc !== undefined ? { baseNc: num(l.baseNc) } : {}),
    ...(l.baseTb !== undefined ? { baseTb: num(l.baseTb) } : {}),
    ...(l.propVt !== undefined ? { propVt: num(l.propVt) } : {}),
    ...(l.propNc !== undefined ? { propNc: num(l.propNc) } : {}),
    ...(l.propTb !== undefined ? { propTb: num(l.propTb) } : {}),
    ...(l.hdQty !== undefined ? { hdQty: num(l.hdQty) } : {}),
    ...(l.hdPrice !== undefined ? { hdPrice: num(l.hdPrice) } : {}),
    ...(l.cdtQty !== undefined ? { cdtQty: num(l.cdtQty) } : {}),
    ...(l.cdtPrice !== undefined ? { cdtPrice: num(l.cdtPrice) } : {}),
    ...(l.baseQty !== undefined ? { baseQty: num(l.baseQty) } : {}),
    ...(l.basePrice !== undefined ? { basePrice: num(l.basePrice) } : {}),
    ...(l.baseManual !== undefined ? { baseManual: !!l.baseManual } : {}),
    ...(l.baseNote !== undefined ? { baseNote: str(l.baseNote) } : {}),
    ...(l.bids !== undefined
      ? { bids: JSON.stringify(Object.fromEntries(Object.entries(l.bids ?? {}).filter(([k]) => bidKeys.has(k)).map(([k, v]) => [k, { qty: num(v?.qty), price: num(v?.price), ...(v?.vt != null || v?.nc != null || v?.tb != null ? { vt: num(v?.vt), nc: num(v?.nc), tb: num(v?.tb) } : {}) }]))) }
      : {}),
  });
  const added = lines.filter((l) => l.id.startsWith("new:")).length;
  const idMap = newIdMap(lines.map((l) => l.id)); // dòng thêm: cấp mã thật trước để công thức trỏ đúng
  // DỰ ÁN chọn từ Danh mục dự án: tên / mã trên hồ sơ = tên / mã chuẩn (có hợp đồng đã gắn dự án thì theo hợp đồng)
  const site = await siteFields(h.siteId, p.contractId, { projectName: str(h.projectName), projectCode: str(h.projectCode) });
  await prisma.$transaction([
    ...(removed.length ? [prisma.subLine.deleteMany({ where: { id: { in: removed } } })] : []),
    prisma.subProposal.update({
      where: { id },
      data: {
        area: AREAS.includes(str(h.area)) ? str(h.area) : "",
        revision: Math.max(0, Math.floor(Number(h.revision) || 0)),
        branch: h.branch === "A" || h.branch === "B" ? h.branch : "",
        branchReason: h.branch === "A" || h.branch === "B" ? "QSĐT chọn nhánh" : "",
        proposalType: h.proposalType === "HDTP" || h.proposalType === "PL" ? h.proposalType : "",
        priceMode: h.priceMode === "CHITIET" ? "CHITIET" : "TONG",
        ...(h.isMep !== undefined ? { isMep: !!h.isMep && !h.isNt, mepTemp: !!h.isMep && !h.isNt && !!h.mepTemp } : {}),
        ...(h.isNt !== undefined ? { isNt: !!h.isNt } : {}),
        ...(h.oneQty !== undefined ? { oneQty: !!h.oneQty } : {}),
        plKind: h.proposalType === "PL" && (h.plKind === "CONG_GOP" || h.plKind === "DIEU_CHINH") ? h.plKind : "",
        awardForm: ["VT", "TB", "NC"].includes(h.awardForm) ? h.awardForm : "",
        vtValue: num(h.vtValue),
        tbValue: num(h.tbValue),
        ...(h.otherValue !== undefined ? { otherValue: num(h.otherValue) } : {}),
        ...(h.signedValue !== undefined ? { signedValue: h.proposalType === "PL" && h.plKind === "CONG_GOP" && !str(h.hdtpId) ? num(h.signedValue) : null } : {}), // giá trị HĐ + PL đã ký (PL cộng gộp, HĐ gõ tay)
        hdtpId: h.proposalType === "PL" && str(h.hdtpId) ? str(h.hdtpId) : null,
        hdtpNo: h.proposalType === "PL" && !str(h.hdtpId) ? str(h.hdtpNo) : "", // chọn HĐTP có sẵn thì bỏ số gõ tay
        projectName: str(h.projectName),
        projectCode: str(h.projectCode),
        ...site,
        cdtContract: str(h.cdtContract),
        itemName: str(h.itemName),
        selectedBidder: str(h.selectedBidder),
        subName: str(h.subName),
        qsNote: str(h.qsNote),
        prelim: JSON.stringify(h.prelim ?? {}),
        vat: JSON.stringify(h.vat ?? {}),
        terms: JSON.stringify(h.terms ?? []),
        ...(h.extras !== undefined ? { extraRows: JSON.stringify(cleanExtras(h.extras, bidders)) } : {}),
        ...(h.vatRows !== undefined ? { vatRows: JSON.stringify(cleanVatRows(h.vatRows, bidders)) } : {}),
        ...totFxData(p, h, () => true, idMap), // QSĐT / QSTT sửa công thức dòng tổng của mọi cột
      },
    }),
    ...lines.flatMap((l, i) => {
      const old = own.get(l.id);
      // mọi dòng (kể cả dòng có trong file gốc và đầu mục A, I...) sửa được STT
      if (old) return [prisma.subLine.update({ where: { id: l.id }, data: { ...data(l), formulas: mergeFormulas(old.formulas, l.formulas, keys, idMap), orderIndex: i, stt: str(l.stt) } })];
      if (l.id.startsWith("new:")) return [prisma.subLine.create({ data: { ...data(l), id: idMap.get(l.id)!, formulas: mergeFormulas("{}", l.formulas, keys, idMap), proposalId: id, orderIndex: i, level: l.level && SUB_LEVELS.includes(l.level) ? l.level : "ITEM", sourceRow: 0, stt: str(l.stt) } })];
      return [];
    }),
  ]);
  if (added || removed.length) await log(id, "Sửa danh sách dòng đề xuất", u.name, [added && `thêm ${added} dòng`, removed.length && `xoá ${removed.length} dòng`].filter(Boolean).join(", "));
}

export async function saveSubDraftAction(id: string, h: SubHead, lines: SubLineInput[]) {
  return run(async () => {
    const u = await need("QSTT", "QSDT");
    await saveQs(u, id, h, lines);
  });
}

// ① QSĐT lập xong → chuyển QSTT kiểm tra (hồ sơ khoá với QSĐT)
// Phụ lục (Ký PL): hợp đồng thầu phụ đã chọn phải là hồ sơ HĐTP ĐÃ DUYỆT và ĐÃ CÓ SỐ HĐ — chưa có thì không được trình phụ lục
async function hdtpProblems(p: { proposalType: string; hdtpId: string | null; id: string }): Promise<string[]> {
  if (p.proposalType !== "PL" || !p.hdtpId) return [];
  const r = await prisma.subProposal.findUnique({ where: { id: p.hdtpId }, select: { id: true, status: true, hdNo: true, code: true } });
  if (!r || r.id === p.id) return ["Phụ lục: hợp đồng thầu phụ đã chọn không còn tồn tại"];
  if (r.status !== "APPROVED" || !r.hdNo.trim()) return [`Phụ lục: hợp đồng thầu phụ ${r.code} chưa được duyệt hoặc chưa có SỐ HĐ — QSTT bổ sung số HĐ trước`];
  return [];
}

export async function handSubToQsttAction(id: string, h: SubHead, lines: SubLineInput[]) {
  return run(async () => {
    const u = await need("QSTT", "QSDT");
    await saveQs(u, id, h, lines);
    const p = await load(id);
    if (p.status !== "DRAFT") fail("Hồ sơ không ở bước QSĐT đang lập");
    const hm = [...headMissing(p), ...(await hdtpProblems(p)), ...lineProblems(p)]; // kiểm giống bước QSTT trình, để QSĐT thấy thiếu ngay từ đầu
    if (hm.length) fail(`Bổ sung thông tin trước khi chuyển QSTT:\n- ${hm.join("\n- ")}`);
    await prisma.subProposal.update({ where: { id }, data: { status: "QS_CHECK" } });
    await log(id, "QSĐT lập xong, chuyển QSTT kiểm tra", u.name);
  });
}

// ② QSTT trả lại QSĐT bổ sung (bắt ghi lý do)
export async function returnSubToQsdtAction(id: string, note = "") {
  return run(async () => {
    const u = await need("QSTT");
    const n = str(note);
    if (!n) fail("Ghi lý do trả lại để QSĐT biết cần bổ sung gì");
    const p = await load(id);
    if (p.status !== "QS_CHECK") fail("Hồ sơ không ở bước chờ QSTT kiểm tra");
    await prisma.subProposal.update({ where: { id }, data: { status: "DRAFT" } });
    await log(id, "QSTT trả lại QSĐT bổ sung", u.name, n);
  });
}

export async function setSubContractAction(id: string, contractId: string | null) {
  return run(async () => {
    const u = await need("QSTT", "QSDT");
    const p = await load(id);
    assertEditable(p, u);
    if (p.contractId !== contractId) await prisma.subLine.updateMany({ where: { proposalId: id }, data: { lineKey: "" } });
    await prisma.subProposal.update({ where: { id }, data: { contractId } });
    // hợp đồng đã gắn dự án → hồ sơ theo dự án của hợp đồng; hợp đồng chưa gắn mà hồ sơ đã chọn dự án → gắn hợp đồng vào dự án đó
    if (contractId) await prisma.subProposal.update({ where: { id }, data: await siteFields(p.siteId, contractId, { projectName: p.projectName, projectCode: p.projectCode }) });
    const n = contractId ? await subAutoMatch(id, contractId) : 0;
    await log(id, contractId ? "Gắn hồ sơ vào hợp đồng" : "Bỏ gắn hợp đồng", u.name, contractId ? `tự khớp ${n} dòng với TH Thầu Phụ` : "");
    return { info: contractId ? `Đã tự khớp ${n} dòng với TH Thầu Phụ — kiểm tra cột "Dòng TH Thầu Phụ".` : undefined };
  });
}

// SỬA THÔNG TIN ĐẦU HỒ SƠ (khu vực, dự án, hợp đồng, hạng mục, tên thầu phụ, lần trình / nhánh, loại đề xuất, phụ lục, đơn giá, loại thầu phụ,
// hình thức giao thầu) để sửa chỗ QSĐT / QSTT ghi sai — KHÔNG đụng giá duyệt. Trưởng phòng: khi hồ sơ đang chờ mình duyệt; Quản trị: mọi lúc (kể cả đã duyệt).
// Không đổi: thầu phụ được chọn (khoá cột giá) và KHỐI LƯỢNG chung (ghi đè khối lượng các dòng).
export async function saveSubHeadInfoAction(id: string, h: SubHead, contractId: string | null) {
  return run(async () => {
    const u = await need();
    const p = await load(id);
    const isTp = p.status === "SUBMITTED" && canReviewCategory(u, p.category);
    if (!u.isAdmin && !isTp) fail("Chỉ Trưởng phòng (khi hồ sơ đang chờ duyệt) hoặc Quản trị được sửa thông tin đầu hồ sơ");
    if (contractId && !(await prisma.costContract.findUnique({ where: { id: contractId }, select: { id: true } }))) fail("Hợp đồng đã chọn không còn tồn tại");
    const changedContract = (p.contractId ?? null) !== (contractId ?? null);
    const site = await siteFields(h.siteId, contractId, { projectName: str(h.projectName), projectCode: str(h.projectCode) });
    const pl = h.proposalType === "PL";
    await prisma.subProposal.update({
      where: { id },
      data: {
        area: AREAS.includes(str(h.area)) ? str(h.area) : "",
        revision: Math.max(0, Math.floor(Number(h.revision) || 0)),
        ...(h.branch !== p.branch ? { branch: h.branch === "A" || h.branch === "B" ? h.branch : "", branchReason: h.branch === "A" || h.branch === "B" ? `${u.name} sửa nhánh` : "" } : {}),
        proposalType: h.proposalType === "HDTP" || pl ? h.proposalType : "",
        plKind: pl && (h.plKind === "CONG_GOP" || h.plKind === "DIEU_CHINH") ? h.plKind : "",
        hdtpId: pl && str(h.hdtpId) && str(h.hdtpId) !== id ? str(h.hdtpId) : null,
        hdtpNo: pl && !str(h.hdtpId) ? str(h.hdtpNo) : "",
        ...(h.signedValue !== undefined ? { signedValue: pl && h.plKind === "CONG_GOP" && !str(h.hdtpId) ? num(h.signedValue) : null } : {}),
        priceMode: h.priceMode === "CHITIET" ? "CHITIET" : "TONG",
        ...(h.isMep !== undefined ? { isMep: !!h.isMep && !h.isNt, mepTemp: !!h.isMep && !h.isNt && !!h.mepTemp } : {}),
        ...(h.isNt !== undefined ? { isNt: !!h.isNt } : {}),
        awardForm: ["VT", "TB", "NC"].includes(h.awardForm) ? h.awardForm : "",
        vtValue: num(h.vtValue),
        tbValue: num(h.tbValue),
        ...(h.otherValue !== undefined ? { otherValue: num(h.otherValue) } : {}),
        projectName: str(h.projectName),
        projectCode: str(h.projectCode),
        ...site,
        cdtContract: str(h.cdtContract),
        itemName: str(h.itemName),
        subName: str(h.subName),
        contractId,
      },
    });
    let info: string | undefined;
    if (changedContract) {
      await prisma.subLine.updateMany({ where: { proposalId: id }, data: { lineKey: "" } });
      const n = contractId ? await subAutoMatch(id, contractId) : 0;
      // đã ghi sổ giá → chuyển sổ giá sang hợp đồng mới, GIỮ ngày hiệu lực / người duyệt cũ (giá duyệt không đổi)
      const old = await prisma.approvedPrice.findFirst({ where: { submissionId: id, kind: "TP" }, orderBy: { approvedAt: "asc" }, select: { approvedAt: true, approvedByName: true } });
      if (old || p.status === "APPROVED") {
        await prisma.approvedPrice.deleteMany({ where: { submissionId: id, kind: "TP" } });
        if (contractId) await writeLedger(id, old?.approvedAt ?? p.effectiveAt ?? p.tpAt ?? new Date(), old?.approvedByName ?? (p.ptgByName || p.tpByName || u.name));
      }
      info = contractId ? `Đã đổi hợp đồng, tự khớp ${n} dòng với TH Thầu Phụ.` : "Đã bỏ gắn hợp đồng DT-CP.";
    }
    await log(id, u.isAdmin && !isTp ? "Quản trị sửa thông tin đầu hồ sơ" : "Trưởng phòng sửa thông tin đầu hồ sơ", u.name, changedContract ? "đổi hợp đồng" : "");
    return { info };
  });
}

// Trưởng phòng (chờ duyệt) / Phó Tổng (chờ phê duyệt) CHỌN dòng TH Thầu Phụ của DT-CP khớp cho 1 dòng đề xuất: lineKey = khoá dòng DT-CP · "-" = ngoài DT-CP · "" = bỏ khớp. Lưu ngay.
export async function setSubLineMatchAction(id: string, lineId: string, lineKey: string) {
  return run(async () => {
    const u = await need();
    const p = await load(id);
    if (p.status === "SUBMITTED") {
      if (!canReviewCategory(u, p.category)) fail(`Hồ sơ thuộc ${categoryLabel(p.category)}, bạn không có quyền chọn khớp`);
    } else if (p.status === "PTG_PENDING") {
      if (!canPrice(u, "PTG")) fail("Bạn không có quyền thực hiện thao tác này");
    } else fail("Hồ sơ không ở bước duyệt — không đổi khớp DT-CP tại đây được");
    const line = p.lines.find((l) => l.id === lineId && l.level === "ITEM");
    if (!line) fail("Không tìm thấy dòng");
    if (!p.contractId) fail("Hồ sơ chưa chọn hợp đồng (DT-CP)");
    const key = str(lineKey);
    if (key && key !== "-" && !(await subRefs(p.contractId!)).some((r) => r.key === key)) fail("Dòng DT-CP không tồn tại trong hợp đồng này");
    await prisma.subLine.update({ where: { id: lineId }, data: { lineKey: key } });
    if (key) {
      const srcKey = `TP|${lineKeyOf(line!.content, line!.unit)}`;
      await prisma.priceMatch.upsert({ where: { contractId_srcKey: { contractId: p.contractId!, srcKey } }, create: { contractId: p.contractId!, srcKey, lineKey: key }, update: { lineKey: key } });
    }
    await log(id, key === "-" ? "Chọn dòng ngoài DT-CP" : key ? "Chọn khớp dòng DT-CP" : "Bỏ khớp dòng DT-CP", u.name, `Dòng ${line!.stt || "?"}: ${line!.content.slice(0, 60)}`);
  });
}

export async function rematchSubAction(id: string) {
  return run(async () => {
    await need("QSTT", "QSDT");
    const p = await load(id);
    if (!p.contractId) return fail("Chưa chọn hợp đồng");
    return { info: `Tự khớp thêm ${await subAutoMatch(id, p.contractId)} dòng` };
  });
}

// Dòng công việc thiếu khối lượng / đơn giá đề xuất (báo rõ thiếu gì). PLHĐ điều chỉnh: dòng có KL hợp đồng = 0 hoặc trống mà KL điều chỉnh để trống = không phát sinh khối lượng, không coi là thiếu.
function lineProblems(p: Awaited<ReturnType<typeof load>>): string[] {
  const out: string[] = [];
  for (const l of p.lines) {
    if (l.level !== "ITEM") continue;
    const n = toNums(l);
    const qty = propQtyOf(n, p.selectedBidder);
    const price = apprPriceOf({ ...n, tpPrice: null, tpOk: true }, p.selectedBidder);
    const noQtyOk = p.plKind === "DIEU_CHINH" && qty == null && (l.hdQty == null || l.hdQty === 0);
    const bits = [qty == null && !noQtyOk ? "khối lượng đề xuất" : "", price == null ? "đơn giá đề xuất" : ""].filter(Boolean);
    if (bits.length) out.push(`Dòng ${l.stt || "?"} "${l.content.slice(0, 40)}": thiếu ${bits.join(" và ")}`);
  }
  return out;
}

// Kiểm tra hồ sơ đủ điều kiện lên Trưởng phòng (dùng cho trình lần đầu và cho QSĐT bổ sung theo yêu cầu TP)
async function submitProblems(p: Awaited<ReturnType<typeof load>>): Promise<string[]> {
  {
    const miss: string[] = [...headMissing(p), ...(await hdtpProblems(p))];
    if (!p.subName.trim()) miss.push("Thiếu tên THẦU PHỤ đề xuất ký hợp đồng");
    miss.push(...lineProblems(p));
    // ĐƠN GIÁ CƠ SỞ (B) = đơn giá TĐ1 của dòng TH Thầu Phụ phần mềm tự khớp; chưa khớp thì giá cơ sở trong file.
    // Không bắt khớp tay nữa; dòng vượt giá cơ sở thì QSTT bắt buộc ghi lý do ở cột "Ghi chú QSTT / Lý do vượt DT-CP".
    const refs = p.contractId ? new Map((await subRefs(p.contractId, p.id)).map((r) => [r.key, r])) : new Map<string, Awaited<ReturnType<typeof subRefs>>[number]>();
    for (const l of p.lines) {
      if (l.level !== "ITEM") continue;
      const n = toNums(l);
      const ref = refs.get(l.lineKey);
      const base = baseOfLine(l, ref?.base1);
      const pp = propPriceOf(n, p.selectedBidder);
      const qty = propQtyOf(n, p.selectedBidder);
      // vượt đơn giá cơ sở, hoặc lũy kế khối lượng (các hồ sơ trước + hồ sơ này) vượt khối lượng DT-CP → QSTT bắt buộc ghi lý do (như giá đội)
      const overPrice = pp != null && base != null && pp > base + 0.5;
      const overQty = !!ref && ref.qty != null && qty != null && ref.prevQty + qty > ref.qty + 1e-6;
      if ((overPrice || overQty) && !l.qsNote.trim()) miss.push(`Dòng ${l.stt || "?"} "${l.content.slice(0, 40)}": vượt ${[overPrice && "giá cơ sở", overQty && "khối lượng DT-CP"].filter(Boolean).join(" và ")} — ghi lý do vào cột Ghi chú QSTT`);
    }
    return miss;
  }
}
const missText = (miss: string[]) => `Hồ sơ còn thiếu, cần bổ sung trước khi trình:\n- ${miss.slice(0, 15).join("\n- ")}${miss.length > 15 ? `\n... và ${miss.length - 15} mục khác` : ""}`;

export async function submitSubAction(id: string, category: string, h: SubHead, lines: SubLineInput[]) {
  return run(async () => {
    const u = await need("QSTT");
    if (!CATEGORIES.some((c) => c.value === category)) fail("Chọn Trưởng phòng duyệt (hạng mục) trước khi trình");
    await saveQs(u, id, h, lines);
    const p = await load(id);
    const miss = await submitProblems(p);
    if (miss.length) fail(missText(miss));
    // NHÁNH do QSĐT chọn (phần mềm không tự xếp — anh chốt 11/11/2026)
    const b = { branch: p.branch, reason: p.branchReason || "QSĐT chọn nhánh" };
    await prisma.subProposal.update({ where: { id }, data: { status: "SUBMITTED", category, submittedAt: new Date(), tpByName: "", tpAt: null, ptgByName: "", ptgAt: null, effectiveAt: null } });
    await prisma.$transaction(
      p.lines
        .filter((l) => p.contractId && l.level === "ITEM" && l.lineKey)
        .map((l) => {
          const srcKey = `TP|${lineKeyOf(l.content, l.unit)}`;
          return prisma.priceMatch.upsert({ where: { contractId_srcKey: { contractId: p.contractId!, srcKey } }, create: { contractId: p.contractId!, srcKey, lineKey: l.lineKey }, update: { lineKey: l.lineKey } });
        }),
    );
    await log(id, `Trình ${categoryLabel(category)} duyệt (lần ${p.revision}) — ${b.branch === "A" ? "NHÁNH A" : "NHÁNH B"}`, u.name, `${b.reason}${p.qsNote ? ` · ${p.qsNote}` : ""}`);
  });
}

export async function recallSubAction(id: string) {
  return run(async () => {
    const u = await need("QSTT");
    const p = await load(id);
    if (p.status !== "SUBMITTED") fail("Chỉ rút lại được hồ sơ đang chờ Trưởng phòng duyệt");
    await prisma.subProposal.update({ where: { id }, data: { status: "QS_CHECK" } });
    await log(id, "Rút lại hồ sơ để sửa (về QSTT kiểm tra)", u.name);
  });
}

// SỬA ĐỀ XUẤT: QSĐT (người lập hồ sơ) đã trình mà CHƯA DUYỆT (đang ở QSTT / Trưởng phòng / Phó Tổng) → rút hồ sơ về bước QSĐT đang lập để sửa,
// sửa xong chuyển QSTT kiểm tra lại từ đầu. Trưởng phòng / Phó Tổng sẽ duyệt lại khi QSTT trình lại.
const SUB_QSDT_EDITABLE = ["QS_CHECK", "SUBMITTED", "PTG_PENDING"]; // file "use server": không export hằng số
export async function qsdtEditSubAction(id: string) {
  return run(async () => {
    const u = await need("QSDT");
    const p = await load(id);
    if (p.createdById && p.createdById !== u.id) fail("Chỉ QSĐT lập hồ sơ này mới sửa đề xuất được");
    if (!SUB_QSDT_EDITABLE.includes(p.status)) fail(p.status === "APPROVED" ? "Hồ sơ đã duyệt, không sửa đề xuất được" : "Hồ sơ không ở bước đã trình chờ duyệt");
    await prisma.subProposal.update({ where: { id }, data: { status: "DRAFT", tpByName: "", tpAt: null, ptgByName: "", ptgAt: null, effectiveAt: null } });
    await log(id, "QSĐT rút về sửa đề xuất", u.name, `đang ở bước: ${SUB_STATUS[p.status]?.label ?? p.status}`);
  });
}

export async function deleteSubAction(id: string) {
  return run(async () => {
    await need("QSTT", "QSDT");
    const p = await load(id);
    if (p.status !== "DRAFT") fail("Chỉ xoá được hồ sơ chưa trình");
    await prisma.subProposal.delete({ where: { id } });
    await prisma.procLog.deleteMany({ where: { entity: "TPH", entityId: id } });
  });
}

// ---- QSĐT chọn SỐ LƯỢNG THẦU PHỤ và cột của từng thầu phụ trong file (gắn giá trị theo vị trí cột) ----
const EMPTY_MAP: SubColMap = { dims: [], cdt: {}, base: {}, prop: {}, hd: {}, bids: {} };
export async function subColumnsAction(id: string): Promise<{ ok: true; cols: SheetCol[]; colMap: SubColMap } | { ok: false; error: string }> {
  try {
    await need("QSTT", "QSDT");
    const p = await prisma.subProposal.findUnique({ where: { id }, select: { fileData: true, fileKey: true, sheetName: true, headRows: true, colMap: true } });
    const file = p ? await storedFileOf(p) : null;
    if (!p || !file) return { ok: false, error: "Hồ sơ không còn file gốc" };
    const hr = parseJson<Record<string, number>>(p.headRows, {}).header ?? 1;
    return { ok: true, cols: await sheetColumns(file, p.sheetName, hr), colMap: parseJson<SubColMap>(p.colMap, EMPTY_MAP) };
  } catch (e) {
    if (e instanceof SubError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Không đọc được file gốc" };
  }
}

export async function setSubBiddersAction(id: string, defs: BidColDef[]) {
  return run(async () => {
    const u = await need("QSTT", "QSDT");
    const p = await load(id);
    assertEditable(p, u);
    const file = await storedFileOf(p);
    if (!file) fail("Hồ sơ không còn file gốc");
    const list = defs.filter((d) => Number.isInteger(d.price) && d.price > 0).map((d) => ({ name: str(d.name), price: d.price, qty: d.qty && d.qty > 0 ? d.qty : undefined }));
    if (!list.length || list.length !== defs.length) fail("Chọn cột ĐƠN GIÁ cho mọi thầu phụ");
    const hr = parseJson<Record<string, number>>(p.headRows, {});
    const items = p.lines.filter((l) => l.sourceRow > 0 && l.level === "ITEM");
    const r = await readBidCols(file!, p.sheetName, list, items.map((l) => l.sourceRow), hr);
    const colMap = parseJson<SubColMap>(p.colMap, EMPTY_MAP);
    const selIdx = Math.max(0, parseJson<Bidder[]>(p.bidders, []).findIndex((b) => b.key === p.selectedBidder));
    const sel = r.bidders[Math.min(selIdx, r.bidders.length - 1)];
    // Prelim / VAT: giữ % của các khối CĐT, cơ sở, đề xuất; thay % của thầu phụ theo cột mới
    const keepPct = (s: string) => Object.fromEntries(Object.entries(parseJson<Record<string, number>>(s, {})).filter(([k]) => !/^C\d+$/.test(k)));
    await prisma.$transaction([
      prisma.subProposal.update({
        where: { id },
        data: {
          bidders: JSON.stringify(r.bidders),
          selectedBidder: sel.key,
          subName: p.subName.trim() ? p.subName : sel.name,
          colMap: JSON.stringify({ ...colMap, bids: r.colBids }),
          prelim: JSON.stringify({ ...keepPct(p.prelim), ...r.prelim }),
          vat: JSON.stringify({ ...keepPct(p.vat), ...r.vat }),
        },
      }),
      ...items.map((l) => prisma.subLine.update({ where: { id: l.id }, data: { bids: JSON.stringify(r.bids.get(l.sourceRow) ?? {}) } })),
    ]);
    await log(id, "Chọn thầu phụ báo giá theo cột", u.name, r.bidders.map((b, i) => `${b.key} ${b.name} (cột giá ${list[i].price})`).join("; "));
    return { info: `Đã gắn ${r.bidders.length} thầu phụ theo cột đã chọn.` };
  });
}

// ---- Trưởng phòng / Phó Tổng duyệt từng dòng ----
export type SubTpLine = { id: string; tpPrice: number | null; tpOk: boolean; tpNote: string; formulas?: Record<string, string> };

// Trưởng phòng / Phó Tổng sửa trực tiếp các dòng dưới TỔNG CỘNG của cột ĐỀ XUẤT (D): Prelim %, VAT %, chi phí thêm, thuế bổ sung
// vtValue / tbValue / otherValue: Trưởng phòng / Phó Tổng điều chỉnh được tổng giá trị vật tư / thiết bị / chi phí khác (0 hợp lệ)
export type SubFin = { prelimD: number | null; vatD: number | null; extras: ExtraRow[]; vatRows: VatRow[]; vtValue?: number | null; tbValue?: number | null; otherValue?: number | null } & TotFxInput;
async function saveReview(id: string, note: string, field: "tpNote" | "ptgNote", lines: SubTpLine[], termsAppr: string[], fin?: SubFin) {
  const p = await load(id);
  if (fin) {
    const bidders = parseJson<Bidder[]>(p.bidders, []);
    const withD = (raw: string, v: number | null) => {
      const o = parseJson<Record<string, number>>(raw, {});
      if (v == null) delete o.D;
      else o.D = Number(v) || 0;
      return JSON.stringify(o);
    };
    await prisma.subProposal.update({ where: { id }, data: { prelim: withD(p.prelim, fin.prelimD), vat: withD(p.vat, fin.vatD), extraRows: JSON.stringify(cleanExtras(fin.extras, bidders)), vatRows: JSON.stringify(cleanVatRows(fin.vatRows, bidders)), ...(fin.vtValue !== undefined ? { vtValue: num(fin.vtValue) } : {}), ...(fin.tbValue !== undefined ? { tbValue: num(fin.tbValue) } : {}), ...(fin.otherValue !== undefined ? { otherValue: num(fin.otherValue) } : {}), ...totFxData(p, fin, (tk) => tk === "D" || tk === "H" || tk === "PL:D") } }); // Trưởng phòng / Phó Tổng: công thức dòng tổng của cột đề xuất / duyệt (D), cột hợp đồng (H) và cột phụ lục (PL:D) của nó
  }
  const own = new Set(p.lines.map((l) => l.id));
  // màn hình luôn hiện 4 điều khoản cố định (fixedTerms) → lưu theo đúng 4 dòng đó
  const terms = fixedTerms(parseJson<Term[]>(p.terms, [])).map((t, i) => ({ ...t, appr: str(termsAppr[i] ?? t.appr) }));
  await prisma.$transaction([
    prisma.subProposal.update({ where: { id }, data: { [field]: str(note), terms: JSON.stringify(terms) } }),
    ...lines
      .filter((l) => own.has(l.id))
      .map((l) => prisma.subLine.update({ where: { id: l.id }, data: { tpPrice: num(l.tpPrice), tpOk: !!l.tpOk, tpNote: str(l.tpNote), formulas: mergeFormulas(p.lines.find((x) => x.id === l.id)?.formulas, l.formulas, SUB_TP_KEYS) } })),
  ]);
}

// ghi giá có hiệu lực vào sổ giá thầu phụ của hợp đồng
async function writeLedger(id: string, at: Date, by: string) {
  const p = await load(id);
  if (!p.contractId) return;
  await prisma.approvedPrice.deleteMany({ where: { submissionId: id, kind: "TP" } });
  const rows = p.lines.filter((l) => l.level === "ITEM" && l.tpOk).map((l) => ({ l, price: apprPriceOf(toNums(l), p.selectedBidder) })).filter((x) => x.price != null);
  await prisma.approvedPrice.createMany({
    data: rows.map(({ l, price }) => ({
      kind: "TP",
      contractId: p.contractId!,
      lineKey: l.lineKey === "-" ? "" : l.lineKey,
      name: l.content,
      unit: l.unit,
      crew: p.subName,
      price: price!,
      qty: propQtyOf(toNums(l), p.selectedBidder),
      approvedAt: at,
      approvedByName: by,
      submissionId: id,
      submissionCode: p.code,
      revision: p.revision,
      batch: "",
    })),
  });
}

export async function tpSaveSubAction(id: string, note: string, lines: SubTpLine[], termsAppr: string[], fin?: SubFin) {
  return run(async () => {
    const u = await need();
    const p = await load(id);
    if (p.status !== "SUBMITTED") fail("Hồ sơ không ở bước Trưởng phòng duyệt");
    if (!canReviewCategory(u, p.category)) fail(`Hồ sơ thuộc ${categoryLabel(p.category)}, bạn không có quyền duyệt`);
    await saveReview(id, note, "tpNote", lines, termsAppr, fin);
  });
}

export async function tpDecideSubAction(id: string, approve: boolean, note: string, lines: SubTpLine[], termsAppr: string[], fin?: SubFin) {
  return run(async () => {
    const u = await need();
    const p = await load(id);
    if (p.status !== "SUBMITTED") fail("Hồ sơ không ở bước Trưởng phòng duyệt");
    if (!canReviewCategory(u, p.category)) fail(`Hồ sơ thuộc ${categoryLabel(p.category)}, bạn không có quyền duyệt`);
    if (!approve && !str(note)) fail("Nhập ý kiến / lý do không duyệt");
    await saveReview(id, note, "tpNote", lines, termsAppr, fin);
    const now = new Date();
    if (!approve) {
      await prisma.subProposal.update({ where: { id }, data: { status: "REJECTED", tpByName: u.name, tpAt: now, makerSeenAt: null } });
      await log(id, "Trưởng phòng KHÔNG DUYỆT — trả về bổ sung, sửa", u.name, str(note));
      return;
    }
    if (p.branch === "A") {
      // NHÁNH A: TP duyệt là xong; Phó Tổng xem để nắm — hiệu lực khi PTG xem hoặc sau đủ 24 giờ
      const eff = new Date(now.getTime() + 24 * 3600 * 1000);
      await prisma.subProposal.update({ where: { id }, data: { status: "APPROVED", tpByName: u.name, tpAt: now, effectiveAt: eff, makerSeenAt: null } });
      await writeLedger(id, eff, u.name);
      await log(id, "Trưởng phòng DUYỆT (nhánh A) — chờ Phó Tổng xem để nắm, tự hiệu lực sau 24 giờ", u.name, str(note));
    } else {
      await prisma.subProposal.update({ where: { id }, data: { status: "PTG_PENDING", tpByName: u.name, tpAt: now } });
      await log(id, "Trưởng phòng DUYỆT (nhánh B) — trình Phó Tổng phê duyệt", u.name, str(note));
    }
  });
}

// Trưởng phòng YÊU CẦU QSĐT BỔ SUNG hồ sơ (không duyệt, không trả hẳn): hồ sơ về QSĐT, QSĐT bổ sung xong bấm Cập nhật → lên thẳng Trưởng phòng
export async function tpRequestInfoAction(id: string, note: string, lines: SubTpLine[], termsAppr: string[], fin?: SubFin) {
  return run(async () => {
    const u = await need();
    const p = await load(id);
    if (p.status !== "SUBMITTED") fail("Hồ sơ không ở bước Trưởng phòng duyệt");
    if (!canReviewCategory(u, p.category)) fail(`Hồ sơ thuộc ${categoryLabel(p.category)}, bạn không có quyền yêu cầu bổ sung`);
    const n = str(note);
    if (!n) fail("Nhập nội dung cần QSĐT bổ sung vào ô Ý kiến");
    await saveReview(id, note, "tpNote", lines, termsAppr, fin);
    await prisma.subProposal.update({ where: { id }, data: { status: "NEED_INFO", infoRequest: n, infoReply: "", infoNotice: false } });
    await log(id, "Trưởng phòng YÊU CẦU QSĐT BỔ SUNG hồ sơ", u.name, n);
  });
}

// QSĐT bổ sung MỤC C (Phạm vi công việc): tải file Excel có sheet PHẠM VI CÔNG VIỆC → thay nội dung mục C của hồ sơ
export async function uploadSubScopeAction(id: string, form: FormData) {
  return run(async () => {
    const u = await need("QSTT", "QSDT");
    const p = await load(id);
    assertEditable(p, u);
    const { f, buf } = await subFileOf(form);
    const scope = await readScopeSheet(buf);
    if (!scope.length) fail('Không thấy sheet "PHẠM VI CÔNG VIỆC" (hoặc sheet trống) trong file này');
    await prisma.subProposal.update({ where: { id }, data: { scope: JSON.stringify(scope) } });
    await log(id, "QSĐT bổ sung mục C — Phạm vi công việc", u.name, `${f.name}: ${scope.length} dòng`);
    return { info: `Đã cập nhật mục C — Phạm vi công việc (${scope.length} dòng).` };
  });
}

// QSĐT sửa tay mục C (nội dung ô, thêm / xoá dòng, cột) rồi lưu lại
export async function saveSubScopeAction(id: string, scope: string[][]) {
  return run(async () => {
    const u = await need();
    const p = await load(id);
    // QSĐT / QSTT sửa khi đang lập / bổ sung; Trưởng phòng (chờ duyệt, hoặc điều chỉnh sau duyệt nhánh A) và Phó Tổng (chờ phê duyệt / điều chỉnh nhánh B) sửa trực tiếp
    const isTp = (p.status === "SUBMITTED" || (p.status === "APPROVED" && p.branch !== "B")) && canReviewCategory(u, p.category);
    const isPtg = (p.status === "PTG_PENDING" || (p.status === "APPROVED" && p.branch === "B")) && canPrice(u, "PTG");
    if (!isTp && !isPtg) {
      if (!canPrice(u, "QSTT", "QSDT")) fail("Bạn không có quyền sửa Phạm vi công việc");
      assertEditable(p, u);
    }
    if (!Array.isArray(scope)) fail("Dữ liệu phạm vi công việc không hợp lệ");
    const clean = scope.slice(0, 600).map((r) => (Array.isArray(r) ? r.slice(0, 40).map((c) => String(c ?? "").slice(0, 2000)) : []));
    await prisma.subProposal.update({ where: { id }, data: { scope: JSON.stringify(clean) } });
    await log(id, "Sửa mục C — Phạm vi công việc", u.name, `${clean.length} dòng`);
  });
}

// QSĐT bổ sung xong → Cập nhật: hồ sơ lên THẲNG Trưởng phòng (không qua QSTT); QSTT được báo để nắm
export async function qsdtUpdateInfoAction(id: string, reply: string, h: SubHead, lines: SubLineInput[]) {
  return run(async () => {
    const u = await need("QSTT", "QSDT");
    const p0 = await load(id);
    if (p0.status !== "NEED_INFO") fail("Hồ sơ không ở bước Trưởng phòng yêu cầu bổ sung");
    await saveQs(u, id, h, lines);
    const p = await load(id);
    const miss = await submitProblems(p);
    if (miss.length) fail(missText(miss));
    const r = str(reply);
    await prisma.subProposal.update({ where: { id }, data: { status: "SUBMITTED", submittedAt: new Date(), infoReply: r, infoNotice: true } });
    await log(id, "QSĐT đã bổ sung theo yêu cầu Trưởng phòng — hồ sơ lên lại Trưởng phòng (QSTT nắm thông tin)", u.name, `Yêu cầu: ${p.infoRequest}${r ? ` · Đã bổ sung: ${r}` : ""}`);
  });
}

// ĐIỀU CHỈNH GIÁ SAU DUYỆT (không cần lý do, có ghi lịch sử): nhánh A do Trưởng phòng, nhánh B do Phó Tổng (người đã duyệt).
// Chưa lên HĐ/PLHĐ, chưa trình lại. Sổ giá ghi lại theo giá mới (giữ ngày hiệu lực); về lại việc "Soạn mail" của QSTT.
export async function adjustApprovedSubAction(id: string, note: string, lines: SubTpLine[], termsAppr: string[], fin?: SubFin) {
  return run(async () => {
    const p = await load(id);
    if (p.status !== "APPROVED") fail("Chỉ điều chỉnh được hồ sơ đã duyệt");
    const isB = p.branch === "B";
    const u = isB ? await need("PTG") : await need();
    if (!isB && !canReviewCategory(u, p.category)) fail(`Hồ sơ thuộc ${categoryLabel(p.category)}, bạn không có quyền điều chỉnh`);
    if (p.hdNo.trim()) fail("Hồ sơ đã lên HĐ/PLHĐ, không điều chỉnh giá được nữa");
    if (await prisma.subProposal.findFirst({ where: { parentId: id } })) fail("Hồ sơ đã được trình lại, không điều chỉnh được nữa");
    await saveReview(id, note, isB ? "ptgNote" : "tpNote", lines, termsAppr, fin);
    await writeLedger(id, p.effectiveAt ?? new Date(), u.name);
    await prisma.subProposal.update({ where: { id }, data: { mailSentAt: null } });
    await log(id, `${isB ? "Phó Tổng" : "Trưởng phòng"} ĐIỀU CHỈNH giá sau duyệt`, u.name, str(note));
  });
}

// Phó Tổng: nhánh A "đã xem" (hiệu lực ngay) / "xem lại" (chuyển nhánh B); nhánh B phê duyệt / trả về
export async function ptgViewSubAction(id: string) {
  return run(async () => {
    const u = await need("PTG");
    const p = await load(id);
    if (p.branch !== "A" || p.status !== "APPROVED") fail("Hồ sơ không ở bước Phó Tổng xem để nắm");
    if (p.ptgAt) return;
    const now = new Date();
    const eff = p.effectiveAt && p.effectiveAt < now ? p.effectiveAt : now;
    await prisma.subProposal.update({ where: { id }, data: { ptgByName: u.name, ptgAt: now, effectiveAt: eff } });
    await prisma.approvedPrice.updateMany({ where: { submissionId: id, kind: "TP" }, data: { approvedAt: eff } });
    await log(id, "Phó Tổng đã xem — giá có hiệu lực", u.name);
  });
}

export async function ptgReconsiderSubAction(id: string, note = "") {
  return run(async () => {
    const u = await need("PTG");
    const p = await load(id);
    if (p.branch !== "A" || p.status !== "APPROVED") fail("Chỉ xem lại được hồ sơ nhánh A đã được Trưởng phòng duyệt");
    if (p.hdNo) fail("Hồ sơ đã lên HĐ/PLHĐ, không chuyển được");
    await prisma.approvedPrice.deleteMany({ where: { submissionId: id, kind: "TP" } });
    await prisma.subProposal.update({ where: { id }, data: { branch: "B", branchReason: `Phó Tổng xem lại: ${str(note) || "chuyển sang phê duyệt"}`, status: "PTG_PENDING", effectiveAt: null, ptgNote: str(note) } });
    await log(id, "Phó Tổng XEM LẠI — chuyển sang nhánh B (Phó Tổng phê duyệt)", u.name, str(note));
  });
}

export async function ptgDecideSubAction(id: string, approve: boolean, note: string, lines: SubTpLine[], termsAppr: string[], fin?: SubFin) {
  return run(async () => {
    const u = await need("PTG");
    const p = await load(id);
    if (p.status !== "PTG_PENDING") fail("Hồ sơ không ở bước Phó Tổng phê duyệt");
    if (!approve && !str(note)) fail("Nhập ý kiến / lý do không duyệt");
    await saveReview(id, note, "ptgNote", lines, termsAppr, fin);
    const now = new Date();
    if (!approve) {
      await prisma.subProposal.update({ where: { id }, data: { status: "REJECTED", ptgByName: u.name, ptgAt: now, makerSeenAt: null } });
      await log(id, "Phó Tổng KHÔNG DUYỆT — trả về bổ sung, sửa", u.name, str(note));
      return;
    }
    await prisma.subProposal.update({ where: { id }, data: { status: "APPROVED", ptgByName: u.name, ptgAt: now, effectiveAt: now, makerSeenAt: null } });
    await writeLedger(id, now, u.name);
    await log(id, "Phó Tổng PHÊ DUYỆT — giá có hiệu lực", u.name, str(note));
  });
}

// ---- Trình lại (lần 2, 3...) ----
export async function reviseSubAction(id: string) {
  return run(async () => {
    const u = await need("QSTT", "QSDT");
    const p = await load(id);
    if (p.status !== "REJECTED") fail("Chỉ trình lại hồ sơ bị trả về");
    if (await prisma.subProposal.findFirst({ where: { parentId: id } })) fail("Hồ sơ này đã có lần trình lại");
    const { id: _i, code: _c, lines, createdAt: _a, updatedAt: _b, ...rest } = p;
    void _i;
    void _c;
    void _a;
    void _b;
    const idMap = freshIdMap(lines.map((l) => l.id)); // mã mới cho từng dòng, công thức trỏ theo mã mới
    const savedT = parseSavedTotals(p.totalAmounts);
    delete savedT.R; // số duyệt của lần trước không chép sang
    const n = await prisma.subProposal.create({
      data: {
        ...rest,
        totalFormulas: copyFormulas(p.totalFormulas, idMap), // công thức dòng tổng trỏ theo mã dòng mới
        totalAmounts: JSON.stringify(savedT),
        code: await nextCode(),
        revision: 0, // QSĐT chọn lần trình
        parentId: id,
        status: "DRAFT",
        branch: "",
        branchReason: "",
        tpNote: "",
        ptgNote: "",
        submittedAt: null,
        tpByName: "",
        tpAt: null,
        ptgByName: "",
        ptgAt: null,
        effectiveAt: null,
        hdNo: "",
        hdAt: null,
        mailSentAt: null,
        createdById: u.id,
        createdByName: u.name,
        lines: {
          create: (() => {
            return lines.map((l) => {
              const { id: _li, proposalId: _pi, ...lr } = l;
              void _pi;
              return { ...lr, id: idMap.get(_li)!, formulas: copyFormulas(l.formulas, idMap, SUB_TP_KEYS), tpPrice: null, tpOk: true, tpNote: "" };
            });
          })(),
        },
      },
    });
    await copySubImages(id, n.id, idMap); // ảnh nội thất đi theo dòng
    await log(id, `Trình lại → hồ sơ ${n.code}`, u.name);
    await log(n.id, `Tạo hồ sơ trình lại từ ${p.code} (lần ${p.revision})`, u.name);
    return n.id;
  });
}

// NỘI THẤT — TRÌNH PHẦN VIỆC KHÁC của cùng các sản phẩm (VD đã trình khung bàn, giờ trình mặt đá): tạo hồ sơ MỚI (QSĐT đang lập)
// chép danh sách sản phẩm, phần việc, ảnh, thông tin đầu hồ sơ; bỏ thầu phụ / giá thầu phụ / ý kiến duyệt.
// Phần việc đang trình ở hồ sơ này thành dòng THAM KHẢO (giữ giá đề xuất / duyệt làm giá dự kiến — hồ sơ này duyệt xong thì tự lấy giá duyệt);
// QSĐT chọn các dòng phần việc trình lần này (menu ▾ của dòng → "Phần việc trình lần này") rồi nhập giá thầu phụ.
export async function ntNextPartAction(id: string) {
  return run(async () => {
    const u = await need("QSTT", "QSDT");
    const p = await load(id);
    if (!p.isNt) fail("Chỉ dùng cho hồ sơ thầu phụ nội thất");
    if (!p.lines.some((l) => l.level === "SP")) fail("Hồ sơ chưa có dòng SẢN PHẨM (dòng gồm nhiều phần việc) — đặt cấp dòng ở menu ▾ của ô STT trước");
    const sel = p.selectedBidder;
    const idMap = freshIdMap(p.lines.map((l) => l.id));
    const keepPct = (s: string) => JSON.stringify(Object.fromEntries(Object.entries(parseJson<Record<string, number>>(s, {})).filter(([k]) => !/^C\d+$/.test(k)))); // % Prelim / VAT của CĐT, cơ sở, đề xuất
    const colMap = parseJson<Record<string, unknown>>(p.colMap, {});
    const n = await prisma.subProposal.create({
      data: {
        code: await nextCode(),
        contractId: p.contractId,
        area: p.area,
        siteId: p.siteId,
        projectName: p.projectName,
        projectCode: p.projectCode,
        cdtContract: p.cdtContract,
        itemName: p.itemName,
        isNt: true,
        proposalType: "HDTP",
        awardForm: p.awardForm,
        priceMode: p.priceMode,
        oneQty: p.oneQty,
        prelim: keepPct(p.prelim),
        vat: keepPct(p.vat),
        scope: p.scope,
        fileName: p.fileName,
        fileKey: p.fileKey, // dùng chung file gốc ở KHO FILE
        sheetName: p.sheetName,
        colMap: JSON.stringify({ ...colMap, bids: {}, award: undefined }),
        headRows: p.headRows,
        revision: 0,
        createdById: u.id,
        createdByName: u.name,
        lines: {
          create: p.lines.map((l) => {
            const { id: _li, proposalId: _pi, ...lr } = l;
            void _pi;
            const was = l.level === "ITEM";
            const nums = toNums(l);
            return {
              ...lr,
              id: idMap.get(_li)!,
              level: was ? "REF" : l.level,
              bids: "{}",
              propQty: was ? propQtyOf(nums, sel) : l.propQty,
              propPrice: was ? (p.status === "APPROVED" ? apprPriceOf(nums, sel) : propPriceOf(nums, sel)) : l.propPrice,
              propVt: null,
              propNc: null,
              propTb: null,
              tpPrice: null,
              tpOk: true,
              tpNote: "",
              qsNote: "",
              formulas: "{}",
            };
          }),
        },
      },
    });
    await copySubImages(id, n.id, idMap);
    await log(id, `Trình phần việc khác → hồ sơ ${n.code}`, u.name);
    await log(n.id, `Tạo hồ sơ trình phần việc khác từ ${p.code} (nội thất)`, u.name, "Chọn các dòng phần việc trình lần này ở menu ▾ của ô STT, nhập thầu phụ và giá");
    return n.id;
  });
}

// Xoá 1 ảnh của dòng nội thất (QSĐT / QSTT khi hồ sơ còn sửa được). File ảnh chỉ xoá khi không hồ sơ nào khác còn dùng.
export async function deleteSubImageAction(imageId: string) {
  return run(async () => {
    const u = await need("QSTT", "QSDT");
    const im = await prisma.subLineImage.findUnique({ where: { id: imageId } });
    if (!im) fail("Không tìm thấy ảnh");
    const p = await prisma.subProposal.findUnique({ where: { id: im!.proposalId }, select: { status: true } });
    if (!p) fail("Không tìm thấy hồ sơ");
    assertEditable(p!, u);
    await prisma.subLineImage.delete({ where: { id: imageId } });
    if (!(await prisma.subLineImage.count({ where: { fileName: im!.fileName } }))) removeImageFile(im!.fileName);
  });
}

// ---- ⑤ QSTT lên HĐ / PLHĐ gửi thầu phụ ----
export async function markHdSubAction(id: string, hdNo: string, hdDate: string) {
  return run(async () => {
    const u = await need("QSTT");
    const p = await load(id);
    if (p.status !== "APPROVED") fail("Hồ sơ chưa được duyệt");
    if (!str(hdNo)) fail("Nhập số HĐ / PLHĐ");
    await prisma.subProposal.update({ where: { id }, data: { hdNo: str(hdNo), hdAt: hdDate ? new Date(hdDate) : new Date() } });
    await log(id, "Đã lên HĐ/PLHĐ gửi thầu phụ", u.name, str(hdNo));
  });
}

// File Excel xuất từ phần mềm: file MỚI, nội dung giống màn hình (sheet 1: thông tin + A. Bảng đơn giá + B. Điều khoản; sheet 2: C. Phạm vi công việc).
// Không dùng lại file Excel gốc QSĐT tải lên. Dùng chung cho nút Tải Excel và file đính kèm mail.
export async function subWorkbook(id: string) {
  await need();
  const p = await load(id);
  const refs = p.contractId ? new Map((await subRefs(p.contractId, id)).map((r) => [r.key, r])) : new Map<string, Awaited<ReturnType<typeof subRefs>>[number]>();
  if (!p.isNt) return buildSubExport(p, refs);
  // nội thất: ảnh từng dòng + giá phần việc đã duyệt ở hồ sơ khác (ghi chú dòng sản phẩm / dòng tham khảo)
  const imgs = await prisma.subLineImage.findMany({ where: { proposalId: id }, orderBy: { orderIndex: "asc" }, select: { lineId: true, fileName: true } });
  const images = new Map<string, string[]>();
  for (const im of imgs) images.set(im.lineId, [...(images.get(im.lineId) ?? []), im.fileName]);
  return buildSubExport(p, refs, { images, ctx: await ntContext(p) });
}

const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");

// Soạn thư Outlook (.eml) kèm file Excel kết quả
export async function buildSubEmlAction(id: string, to: string, cc: string, note: string) {
  return run(async () => {
    const u = await need("QSTT");
    const p = await load(id);
    if (p.status !== "APPROVED" && p.status !== "REJECTED") fail("Chỉ soạn mail khi hồ sơ đã có kết quả");
    if (p.status === "APPROVED" && !p.hdNo.trim()) fail("Bổ sung SỐ HĐ / PLHĐ thầu phụ (khung \"Lên HĐ / PLHĐ gửi thầu phụ\" phía trên) trước khi soạn mail gửi thầu phụ");
    const t = parseEmails(to);
    const c = parseEmails(cc);
    if (!t.ok.length) fail("Nhập ít nhất 1 địa chỉ mail người nhận");
    if (t.bad.length || c.bad.length) fail(`Địa chỉ mail không hợp lệ: ${[...t.bad, ...c.bad].join(", ")}`);
    const xlsx = await subWorkbook(id);
    const result = p.status === "APPROVED" ? "ĐÃ DUYỆT" : "KHÔNG DUYỆT";
    const subject = `[${result}] Đề xuất ký HĐ thầu phụ ${p.subName} - ${p.projectName || p.code}${p.itemName ? ` - ${p.itemName}` : ""}`;
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px"><p>Kính gửi Anh/Chị,</p>
      <p>Khối Kinh Tế - Kế Hoạch gửi kết quả hồ sơ <b>đề xuất ký hợp đồng thầu phụ</b>:</p>
      <ul><li>Công trình: <b>${esc(p.projectName)}</b></li>${p.itemName ? `<li>Hạng mục: ${esc(p.itemName)}</li>` : ""}
      <li>Thầu phụ: <b>${esc(p.subName)}</b></li>
      <li>Kết quả: <b style="color:${p.status === "APPROVED" ? "#047857" : "#b91c1c"}">${result}</b></li>
      ${p.tpNote ? `<li>Ý kiến Trưởng phòng: ${esc(p.tpNote)}</li>` : ""}${p.ptgNote ? `<li>Ý kiến Phó Tổng: ${esc(p.ptgNote)}</li>` : ""}</ul>
      ${note.trim() ? `<p><b>Ghi chú:</b><br>${esc(note.trim())}</p>` : ""}
      <p>Chi tiết đơn giá duyệt xem file Excel đính kèm (khối "ĐƠN GIÁ DUYỆT (D)").</p><p>Trân trọng,</p>${SIGNATURE_SLOT}</div>`;
    const base = `De xuat thau phu ${p.code} - ${p.status === "APPROVED" ? "DA DUYET" : "KHONG DUYET"}`;
    const eml = await buildDraftEml({ to: t.ok, cc: c.ok, subject, html, attachments: [{ filename: `${base}.xlsx`, content: xlsx }] });
    await prisma.subProposal.update({ where: { id }, data: { mailTo: [t.ok.join("; "), c.ok.join("; ")].join("|"), mailSentAt: new Date() } });
    await log(id, "Soạn mail Outlook (đính kèm Excel kết quả)", u.name, `tới ${t.ok.join(", ")}`);
    return { file: { name: `${base}.eml`, base64: eml.toString("base64") } };
  });
}

export type { Bidder };
