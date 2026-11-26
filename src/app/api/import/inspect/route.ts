import { NextResponse } from "next/server";
import { Readable } from "stream";
import ExcelJS from "exceljs";
import { auth } from "@/auth";

function valueToText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "richText" in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
  if (typeof v === "object" && "result" in v) return String((v as { result: unknown }).result ?? "");
  if (typeof v === "object" && "text" in v) return String((v as { text: unknown }).text ?? "");
  return String(v);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "Thiếu file" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());

  // Đọc kiểu stream (SAX, bỏ qua style/hyperlink) thay vì wb.xlsx.load() nạp toàn bộ workbook vào bộ
  // nhớ kèm định dạng - với file BOQ/dự toán lớn nhiều sheet, load() có thể treo hàng chục giây và làm
  // mất kết nối HMR của Next dev (trông như app tự thoát giữa chừng). Ở đây chỉ cần tên sheet, số dòng/
  // cột và 15 dòng đầu để xem trước.
  const sheets: { name: string; rowCount: number; colCount: number; preview: string[][] }[] = [];
  try {
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
      worksheets: "emit",
      sharedStrings: "cache",
      hyperlinks: "ignore",
      styles: "ignore",
      entries: "ignore",
    });
    for await (const worksheetReader of reader) {
      let rowCount = 0;
      let colCount = 0;
      const preview: string[][] = [];
      for await (const row of worksheetReader) {
        rowCount = row.number;
        const vals = row.values as unknown[];
        colCount = Math.max(colCount, vals.length - 1);
        if (preview.length < 15) {
          const rowVals: string[] = [];
          for (let c = 1; c < vals.length; c++) rowVals.push(valueToText(vals[c]));
          preview.push(rowVals);
        }
      }
      // "name" tồn tại ở runtime (gán từ workbook.xml.rels khi đọc) nhưng thiếu trong .d.ts của exceljs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sheetName = (worksheetReader as any).name as string;
      sheets.push({ name: sheetName, rowCount, colCount: Math.min(colCount, 15), preview: preview.map((r) => r.slice(0, 15)) });
    }
  } catch {
    return NextResponse.json({ error: "Không đọc được file Excel (.xlsx)" }, { status: 400 });
  }

  return NextResponse.json({ sheets });
}
