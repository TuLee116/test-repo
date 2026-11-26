import { NextResponse } from "next/server";
import { Readable } from "stream";
import ExcelJS from "exceljs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCatalogForPicker } from "@/lib/project-data";
import { normalizeText } from "@/lib/text-normalize";
import { createMatcher, type CatalogEntry, type MatchCandidate } from "@/lib/boq-match";
import { extractSheetImages } from "@/lib/xlsx-images";
import { cleanupTmpImages, normalizeImage, writeTmpImage } from "@/lib/uploads";

function valueToText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "richText" in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
  if (typeof v === "object" && "result" in v) return String((v as { result: unknown }).result ?? "");
  if (typeof v === "object" && "text" in v) return String((v as { text: unknown }).text ?? "");
  return String(v);
}

function parseNumber(s: string): number {
  const cleaned = s.replace(/,/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// Ô số không bắt buộc: trống / không phải số → null (khác 0 thật)
// Ô số gõ dạng chữ kiểu Việt Nam cũng đọc được: "1.250.000" / "1.250.000,5" (chấm = phân cách nghìn, phẩy = thập phân)
function optNumber(s: string): number | null {
  let t = s.replace(/[\s₫đ]|VNĐ|VND/gi, "").trim();
  if (!t) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const positiveOrNull = (n: number | null) => (n != null && n > 0 ? n : null);

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  const sheetName = String(form.get("sheetName") || "");
  const startRow = Number(form.get("startRow") || 1);
  const colDesc = Number(form.get("colDesc") || 0);
  const colStt = Number(form.get("colStt") || 0);
  const colUnit = Number(form.get("colUnit") || 0);
  const colQty = Number(form.get("colQty") || 0);
  // không bắt buộc: gói thầu đã có giá CĐT duyệt → lấy luôn đơn giá (+ thành tiền trong file để đối chiếu)
  const colPrice = Number(form.get("colPrice") || 0);
  const colAmount = Number(form.get("colAmount") || 0);
  const colNote = Number(form.get("colNote") || 0);
  const includeImages = form.get("includeImages") === "1";

  if (!(file instanceof Blob) || !sheetName || !colDesc || !colQty) {
    return NextResponse.json({ error: "Thiếu thông tin bắt buộc (file, sheet, cột mô tả, cột khối lượng)" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Dòng thô đọc được từ sheet, trước khi khớp định mức (xem lý do dùng reader stream ở inspect/route.ts)
  const rawRows: { rowIndex: number; stt: string; desc: string; unit: string; qty: number; price: number | null; amount: number | null; note: string }[] = [];
  try {
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
      worksheets: "emit",
      sharedStrings: "cache",
      hyperlinks: "ignore",
      styles: "ignore",
      entries: "ignore",
    });
    let found = false;
    for await (const worksheetReader of reader) {
      // "name" tồn tại ở runtime (gán từ workbook.xml.rels khi đọc) nhưng thiếu trong .d.ts của exceljs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((worksheetReader as any).name !== sheetName) continue;
      found = true;
      for await (const row of worksheetReader) {
        if (row.number < startRow) continue;
        const vals = row.values as unknown[];
        const desc = valueToText(vals[colDesc]).trim();
        if (!desc) continue;
        rawRows.push({
          rowIndex: row.number,
          stt: colStt ? valueToText(vals[colStt]).trim() : "",
          desc,
          unit: colUnit ? valueToText(vals[colUnit]).trim() : "",
          qty: parseNumber(valueToText(vals[colQty])),
          price: colPrice ? positiveOrNull(optNumber(valueToText(vals[colPrice]))) : null, // đơn giá 0 = chưa có giá
          amount: colAmount ? optNumber(valueToText(vals[colAmount])) : null,
          note: colNote ? valueToText(vals[colNote]).trim() : "",
        });
      }
      break; // đã xử lý xong sheet cần, các sheet khác trong workbook (nếu có) không cần đọc
    }
    if (!found) return NextResponse.json({ error: "Không tìm thấy sheet" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Không đọc được file Excel (.xlsx)" }, { status: 400 });
  }

  const catalog: CatalogEntry[] = await getCatalogForPicker();
  const matcher = createMatcher(catalog, await prisma.workItemAlias.findMany());

  const rows: {
    rowIndex: number;
    stt: string;
    desc: string;
    unit: string;
    qty: number;
    matchedWorkItemId: string | null;
    matchedWorkItemName: string | null;
    matchedWorkItemUnit: string | null;
    matchType: string;
    candidates: MatchCandidate[];
    isHeading: boolean;
    price: number | null; // đơn giá CĐT trong file (null = ô trống / không chọn cột)
    amount: number | null; // thành tiền trong file - chỉ để người dùng đối chiếu, không lưu
    note: string; // ghi chú trong file (đưa vào cột Ghi chú của BOQ)
    images: string[]; // mã ảnh tạm lấy từ file Excel (xem src/lib/uploads.ts), chỉ khi includeImages
  }[] = [];

  for (const r of rawRows) {
    // Dòng không có khối lượng = đầu mục lớn (A, B, I, II...) → giữ lại làm tiêu đề nhóm, không khớp định mức
    // Không có khối lượng: đầu mục lớn (A, B, I, II, B.1...), trừ khi có STT dạng số (1, 2, 3...) hoặc có ĐVT → là công tác chưa có khối lượng
    const isHeading = r.qty <= 0 && !r.unit && !/^\d+$/.test(r.stt.trim());
    const match = isHeading
      ? { workItemId: null, workItemName: null, workItemUnit: null, matchType: "none" as const, candidates: [] }
      : matcher.match(r.desc, r.unit);
    rows.push({
      isHeading,
      rowIndex: r.rowIndex,
      stt: r.stt,
      desc: r.desc,
      unit: r.unit,
      qty: r.qty,
      matchedWorkItemId: match.workItemId,
      matchedWorkItemName: match.workItemName,
      matchedWorkItemUnit: match.workItemUnit,
      matchType: match.matchType,
      candidates: match.candidates,
      price: r.price,
      amount: r.amount,
      note: r.note,
      images: [],
    });
  }

  // Ảnh trong file: gắn vào dòng BOQ gần nhất phía trên (dòng có mô tả ≤ dòng chứa ảnh) - ảnh nằm trong ô gộp
  // của 1 công tác (nhiều dòng Excel) vẫn về đúng công tác đó. Ảnh nằm trên dòng bắt đầu dữ liệu bị bỏ qua.
  const imageStats = { found: 0, attached: 0, skipped: 0 };
  if (includeImages && rows.length) {
    try {
      cleanupTmpImages();
      const seen = new Set<string>();
      for (const img of await extractSheetImages(buffer, sheetName)) {
        if (img.row < startRow) continue;
        const key = `${img.row}|${img.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        imageStats.found++;
        let target: (typeof rows)[number] | null = null;
        for (const r of rows) {
          if (r.rowIndex > img.row) break;
          target = r;
        }
        if (!target || img.row - target.rowIndex > 50) {
          imageStats.skipped++;
          continue;
        }
        const norm = await normalizeImage(img.data);
        if (!norm) {
          imageStats.skipped++; // định dạng không đọc được (VD EMF/WMF) hoặc không nén nổi về 1MB
          continue;
        }
        target.images.push(writeTmpImage(norm));
        imageStats.attached++;
      }
    } catch (e) {
      console.error("[import/parse] đọc ảnh lỗi", e);
    }
  }

  return NextResponse.json({ rows, imageStats, normalizeSample: rows.slice(0, 3).map((r) => normalizeText(r.desc)) });
}
