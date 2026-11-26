import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { auth } from "@/auth";

function cellValue(ws: ExcelJS.Worksheet, row: number, col: number): string {
  const v = ws.getRow(row).getCell(col).value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "richText" in v) return (v.richText as { text: string }[]).map((t) => t.text).join("");
  if (typeof v === "object" && "result" in v) return String((v as { result: unknown }).result ?? "");
  if (typeof v === "object" && "text" in v) return String((v as { text: unknown }).text ?? "");
  return String(v);
}

// Chấp nhận cả số kiểu Việt (1.234.567,5) lẫn kiểu Anh (1,234,567.5)
function parseNumber(raw: string): number {
  let s = raw.trim().replace(/\s/g, "");
  if (!s) return 0;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (hasComma) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// Đọc file báo giá của thầu phụ: trả về từng dòng (mô tả, ĐVT, SL, đơn giá). Nếu file chỉ có thành tiền
// thì đơn giá = thành tiền / SL.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  const sheetName = String(form.get("sheetName") || "");
  const startRow = Number(form.get("startRow") || 1);
  const col = (k: string) => Number(form.get(k) || 0);
  const colDesc = col("colDesc");
  const colUnit = col("colUnit");
  const colQty = col("colQty");
  const colPrice = col("colPrice");
  const colTotal = col("colTotal");

  if (!(file instanceof Blob) || !sheetName || !colDesc || (!colPrice && !colTotal)) {
    return NextResponse.json({ error: "Cần chọn file, sheet, cột nội dung và cột đơn giá (hoặc thành tiền)" }, { status: 400 });
  }

  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as any);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) return NextResponse.json({ error: "Không tìm thấy sheet" }, { status: 400 });

  const rowCount = ws.actualRowCount || ws.rowCount;
  const rows: { rowIndex: number; desc: string; unit: string; qty: number; price: number }[] = [];
  for (let r = startRow; r <= rowCount; r++) {
    const desc = cellValue(ws, r, colDesc).trim();
    if (!desc) continue;
    const qty = colQty ? parseNumber(cellValue(ws, r, colQty)) : 0;
    let price = colPrice ? parseNumber(cellValue(ws, r, colPrice)) : 0;
    if (!price && colTotal && qty > 0) price = parseNumber(cellValue(ws, r, colTotal)) / qty;
    if (price <= 0) continue; // dòng tiêu đề nhóm / dòng trống giá
    rows.push({ rowIndex: r, desc, unit: colUnit ? cellValue(ws, r, colUnit).trim() : "", qty, price });
  }
  return NextResponse.json({ rows });
}
