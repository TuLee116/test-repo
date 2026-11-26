import JSZip from "jszip";

// Sửa các lỗi hay gặp của file .xlsx do thư viện ExcelJS ghi ra mà Excel KHÔNG chịu mở ("We found a problem with some content",
// "Replaced Part: /xl/worksheets/sheetN.xml part with XML error", "Removed Records: Named range", mở ra trang trắng):
//  1) <sheetPr> sai thứ tự con: chuẩn là tabColor → outlinePr → pageSetUpPr (ExcelJS ghi pageSetUpPr trước outlinePr khi có cả nhóm dòng lẫn "vừa khổ giấy")
//  2) ô số có giá trị NaN / Infinity (VD công thức chia cho 0)
//  3) ký tự điều khiển (không hợp lệ trong XML) lẫn trong chữ (dán / nhập từ file khác)
//  4) tên vùng (defined name) kiểu "$S$1" KHÔNG có tên sheet — file gốc của BCH hay có hàng trăm tên cũ; khi bỏ bớt sheet ExcelJS ghi chúng thành
//     địa chỉ ô trần, Excel báo lỗi và xoá "Named range from /xl/workbook.xml"
// Mọi hàm xuất Excel của phần mềm đều cho file đi qua hàm này trước khi trả về.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const RANK = (tag: string) => (/^<tabColor/.test(tag) ? 0 : /^<outlinePr/.test(tag) ? 1 : /^<pageSetUpPr/.test(tag) ? 2 : 3);
const BARE_REF = /^\$?[A-Z]{1,3}\$?\d+(:\$?[A-Z]{1,3}\$?\d+)?$/;

function fixSheetXml(x: string): string {
  let y = x.replace(/<sheetPr([^>]*)>([\s\S]*?)<\/sheetPr>/, (m, attrs: string, inner: string) => {
    const parts = inner.match(/<([A-Za-z0-9:]+)\b[^>]*\/>|<([A-Za-z0-9:]+)\b[^>]*>[\s\S]*?<\/\2>/g) ?? [];
    if (!parts.length || parts.join("") !== inner) return m; // không nhận ra cấu trúc → giữ nguyên
    return `<sheetPr${attrs}>${[...parts].sort((a, b) => RANK(a) - RANK(b)).join("")}</sheetPr>`;
  });
  y = y.replace(/<v>(?:NaN|-?Infinity)<\/v>/g, "");
  y = y.replace(CONTROL, "");
  return y;
}

// bỏ các tên vùng chỉ là địa chỉ ô trần (không có tên sheet) — vô nghĩa và làm Excel báo lỗi; giữ Print_Area / Print_Titles và tên có tên sheet
function fixWorkbookXml(x: string): string {
  // sheet đang chọn (activeTab / firstSheet) trỏ vào sheet đã bị bỏ (file gốc nhiều sheet, chỉ giữ 1) → Excel hiển thị loạn (mất độ rộng cột, ô gộp...). Đưa về sheet đầu.
  const nSheets = (x.match(/<sheet\b/g) ?? []).length;
  x = x.replace(/<workbookView\b[^>]*\/>/, (m) => m.replace(/\s(activeTab|firstSheet)="(\d+)"/g, (a, k: string, n: string) => (Number(n) >= nSheets ? ` ${k}="0"` : a)));
  let y = x.replace(/<definedName\b[^>]*>([^<]*)<\/definedName>/g, (m, v: string) => (BARE_REF.test(v.trim()) ? "" : m));
  y = y.replace(/<definedNames>\s*<\/definedNames>/, "");
  return y;
}

export async function fixXlsx(buf: ArrayBuffer | Uint8Array | Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf as ArrayBuffer);
  let changed = false;
  for (const name of Object.keys(zip.files)) {
    const isSheet = /^xl\/worksheets\/sheet\d+\.xml$/.test(name);
    const isStrings = name === "xl/sharedStrings.xml";
    const isWorkbook = name === "xl/workbook.xml";
    if (!isSheet && !isStrings && !isWorkbook) continue;
    const x = await zip.file(name)!.async("string");
    const y = isSheet ? fixSheetXml(x) : isWorkbook ? fixWorkbookXml(x) : x.replace(CONTROL, "");
    if (y !== x) {
      zip.file(name, y);
      changed = true;
    }
  }
  if (!changed) return Buffer.from(buf as ArrayBuffer);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
