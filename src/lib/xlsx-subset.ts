import JSZip from "jszip";
import ExcelJS from "exceljs";

// ĐỌC CHỈ NHỮNG SHEET CẦN: file Excel (.xlsx) là 1 gói zip, mỗi sheet 1 file XML. ExcelJS nạp MỌI sheet vào bộ nhớ (gấp 10–30 lần dung lượng file)
// nên file DT-CP cũ nhiều sheet làm máy chủ hết bộ nhớ. Ở đây ta mở gói zip, BỎ các sheet không cần (kèm liên kết của chúng) rồi mới đưa cho ExcelJS
// → chỉ các sheet cần dùng được nạp. Không đụng tới bộ nhớ của các sheet bị bỏ.

export type SheetEntry = { name: string; state: "visible" | "hidden" | "veryHidden"; path: string; rid: string };

const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const attrs = (tag: string) => {
  const o: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:]+)="([^"]*)"/g)) o[m[1]] = unesc(m[2]);
  return o;
};
const absPath = (target: string) => (target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);

async function readText(zip: JSZip, path: string): Promise<string> {
  const f = zip.file(path);
  if (!f) throw new Error(`Thiếu ${path} trong file Excel`);
  return f.async("string");
}

// Danh sách sheet (tên, ẩn / hiện, file XML) — chỉ đọc 2 file nhỏ, KHÔNG nạp nội dung sheet
export async function listSheets(zip: JSZip): Promise<SheetEntry[]> {
  const wbXml = await readText(zip, "xl/workbook.xml");
  const relXml = await readText(zip, "xl/_rels/workbook.xml.rels");
  const rels = new Map<string, string>();
  for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const a = attrs(m[0]);
    if (a.Id && a.Target) rels.set(a.Id, absPath(a.Target));
  }
  const out: SheetEntry[] = [];
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const a = attrs(m[0]);
    const rid = a["r:id"] ?? a["id"];
    const path = rid ? rels.get(rid) : undefined;
    if (!a.name || !path) continue;
    out.push({ name: a.name, state: a.state === "hidden" ? "hidden" : a.state === "veryHidden" ? "veryHidden" : "visible", path, rid });
  }
  return out;
}

export async function openZip(buf: ArrayBuffer | Uint8Array): Promise<JSZip> {
  return JSZip.loadAsync(buf);
}

// Dung lượng giải nén (byte) của file XML từng sheet — để từ chối trước khi nạp nếu quá nặng (JSZip lưu sẵn trong thông tin zip)
export function sheetBytes(zip: JSZip, path: string): number {
  const f = zip.files[path] as unknown as { _data?: { uncompressedSize?: number } } | undefined;
  return f?._data?.uncompressedSize ?? 0;
}

// Tạo workbook ExcelJS CHỈ gồm các sheet có tên trong `keep` (không phân biệt hoa thường nếu không khớp đúng)
export async function loadSubset(buf: ArrayBuffer | Uint8Array, keep: string[]): Promise<ExcelJS.Workbook> {
  const zip = await openZip(buf);
  const sheets = await listSheets(zip);
  const want = new Set(keep);
  const kept = sheets.filter((s) => want.has(s.name));
  const drop = sheets.filter((s) => !want.has(s.name));
  // LUÔN bỏ tên định nghĩa (kể cả khi không bỏ sheet nào): file copy từ mẫu cũ có thể mang hàng chục nghìn tên rác (VD 39.500 tên → ExcelJS hết bộ nhớ)
  {
    let wbXml = await readText(zip, "xl/workbook.xml");
    let relXml = await readText(zip, "xl/_rels/workbook.xml.rels");
    let ctXml = await readText(zip, "[Content_Types].xml");
    for (const s of drop) {
      // bỏ khỏi workbook.xml (thẻ <sheet .../> có r:id này) và khỏi workbook.xml.rels
      wbXml = wbXml.replace(new RegExp(`<sheet\\b[^>]*\\br:id="${s.rid}"[^>]*/>`), "");
      relXml = relXml.replace(new RegExp(`<Relationship\\b[^>]*\\bId="${s.rid}"[^>]*/>`), "");
      ctXml = ctXml.replace(new RegExp(`<Override\\b[^>]*PartName="/${s.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*/>`), "");
      zip.remove(s.path);
      const relPath = s.path.replace(/([^/]+)$/, "_rels/$1.rels");
      if (zip.file(relPath)) zip.remove(relPath);
    }
    // tên định nghĩa (vùng in...) theo chỉ số sheet sẽ lệch khi bớt sheet → bỏ; tab đang chọn cũng bỏ
    wbXml = wbXml.replace(/<definedNames>[\s\S]*?<\/definedNames>/, "").replace(/\s(activeTab|firstSheet)="\d+"/g, "");
    zip.file("xl/workbook.xml", wbXml);
    zip.file("xl/_rels/workbook.xml.rels", relXml);
    zip.file("[Content_Types].xml", ctXml);
  }
  void kept;
  const out = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(out as unknown as ArrayBuffer);
  return wb;
}

// File nặng quá: báo bằng tiếng Việt thay vì để máy chủ hết bộ nhớ
export class XlsxTooBigError extends Error {}
export const MAX_SHEETS_XML_BYTES = 25 * 1024 * 1024; // tổng dung lượng XML giải nén của các sheet cần đọc
export function assertSheetsSize(zip: JSZip, sheets: SheetEntry[]) {
  const total = sheets.reduce((t, x) => t + sheetBytes(zip, x.path), 0);
  if (total > MAX_SHEETS_XML_BYTES)
    throw new XlsxTooBigError(`Các sheet cần đọc quá nặng (${Math.round(total / 1048576)}MB dữ liệu) nên máy chủ không đọc nổi. Dùng mục "🗜 Làm nhẹ file Excel" hoặc xoá ảnh / dòng trống thừa rồi lưu file mới.`);
}

// Nạp CHỈ các sheet có tên trong keep, kiểm tra dung lượng trước
export async function loadSheets(buf: ArrayBuffer | Uint8Array, keep: string[]): Promise<ExcelJS.Workbook> {
  const zip = await openZip(buf);
  const sheets = await listSheets(zip);
  assertSheetsSize(zip, sheets.filter((x) => keep.includes(x.name)));
  return loadSubset(buf, keep);
}
