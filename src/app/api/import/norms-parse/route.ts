import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { canDtcp } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { normalizeText } from "@/lib/text-normalize";

function cellValue(ws: ExcelJS.Worksheet, row: number, col: number): string {
  const v = ws.getRow(row).getCell(col).value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "richText" in v) return (v.richText as { text: string }[]).map((t) => t.text).join("");
  if (typeof v === "object" && "result" in v) return String((v as { result: unknown }).result ?? "");
  if (typeof v === "object" && "text" in v) return String((v as { text: unknown }).text ?? "");
  return String(v);
}

function category(s: string): "VT" | "NC" | "TB" | "" {
  const t = normalizeText(s);
  if (!t) return "";
  if (/^(vt|vat tu|vl|vat lieu)/.test(t)) return "VT";
  if (/^(nc|nhan cong|nhan luc)/.test(t)) return "NC";
  if (/^(tb|m|mtc|may|thiet bi)/.test(t)) return "TB";
  return "";
}

// Mỗi dòng Excel = 1 dòng hao phí. Các cột mã / tên / ĐVT của công tác có thể chỉ ghi ở dòng đầu của nhóm (dòng sau để trống → lấy theo dòng trên).
export async function POST(req: Request) {
  if (!(await canDtcp("NORM_REVIEW"))) return NextResponse.json({ error: "Chỉ quản trị viên mới nhập định mức từ Excel" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  const sheetName = String(form.get("sheetName") || "");
  const startRow = Number(form.get("startRow") || 1);
  const col = (k: string) => Number(form.get(k) || 0);
  const c = { code: col("colCode"), name: col("colName"), unit: col("colUnit"), cat: col("colCat"), resCode: col("colResCode"), resName: col("colResName"), resUnit: col("colResUnit"), qty: col("colQty") };
  if (!(file instanceof Blob) || !sheetName || !c.code || !c.name || !c.cat || (!c.resCode && !c.resName) || !c.qty) {
    return NextResponse.json({ error: "Cần chọn: mã ĐM, tên công tác, loại hao phí, mã hoặc tên hao phí, và định mức" }, { status: 400 });
  }

  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as any);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) return NextResponse.json({ error: "Không tìm thấy sheet" }, { status: 400 });

  const rowCount = ws.actualRowCount || ws.rowCount;
  type Line = { category: "VT" | "NC" | "TB"; code: string; name: string; unit: string; quantity: string };
  const groups: { code: string; name: string; unit: string; lines: Line[]; exists: boolean }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastCat: "VT" | "NC" | "TB" | "" = "";
  const warnings: string[] = [];

  for (let r = startRow; r <= rowCount; r++) {
    const code = cellValue(ws, r, c.code).trim();
    const name = cellValue(ws, r, c.name).trim();
    if (code) {
      cur = { code, name, unit: c.unit ? cellValue(ws, r, c.unit).trim() : "", lines: [], exists: false };
      groups.push(cur);
      lastCat = "";
    } else if (name && cur && !cur.name) cur.name = name;
    if (!cur) continue;
    const catText = cellValue(ws, r, c.cat).trim();
    const cat: "VT" | "NC" | "TB" | "" = category(catText) || lastCat;
    const resName = c.resName ? cellValue(ws, r, c.resName).trim() : "";
    const resCode = c.resCode ? cellValue(ws, r, c.resCode).trim() : "";
    const qty = cellValue(ws, r, c.qty).trim();
    if (!resName && !resCode) continue;
    if (!cat) {
      warnings.push(`Dòng ${r}: không nhận ra loại hao phí "${catText}" (dùng VT / NC / TB hoặc Vật tư / Nhân công / Máy)`);
      continue;
    }
    lastCat = cat;
    cur.lines.push({ category: cat, code: resCode, name: resName, unit: c.resUnit ? cellValue(ws, r, c.resUnit).trim() : "", quantity: qty || "0" });
  }

  const codes = groups.map((g) => g.code);
  const existing = await prisma.workItem.findMany({ where: { code: { in: codes } }, select: { code: true } });
  const set = new Set(existing.map((e) => e.code));
  for (const g of groups) g.exists = set.has(g.code);
  return NextResponse.json({ groups, warnings: warnings.slice(0, 20) });
}
