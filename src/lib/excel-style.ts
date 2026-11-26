import type ExcelJS from "exceljs";
import { QTY_NUMFMT } from "@/lib/fmt-qty";

// Định dạng chung cho các file Excel TỔNG HỢP xuất từ phần mềm (anh chốt theo file chuẩn DT-CP_Tòa DV21):
//  - toàn bộ Times New Roman, canh giữa theo chiều dọc (giữ nguyên canh ngang / tự xuống dòng đã đặt)
//  - số tiền kiểu Comma của Excel (số 0 hiện "-"), khối lượng 2 số lẻ (không để thừa dấu phẩy cuối số nguyên)
//  - không đặt chiều cao dòng: để Excel tự giãn theo nội dung
export const FONT_NAME = "Times New Roman";
const ACC0 = '_(* #,##0_);_(* (#,##0);_(* "-"??_);_(@_)';

export function applyStandardStyle(wb: ExcelJS.Workbook) {
  wb.eachSheet((ws) => {
    const nCols = ws.columnCount;
    ws.eachRow((row) => {
      for (let c = 1; c <= nCols; c++) {
        const cell = row.getCell(c);
        cell.font = { ...(cell.font ?? {}), name: FONT_NAME, family: 1, size: cell.font?.size ?? 11 };
        cell.alignment = { ...(cell.alignment ?? {}), vertical: "middle" };
        const f = cell.numFmt;
        if (f === "#,##0") cell.numFmt = ACC0;
        else if (f === "#,##0.###" || f === "#,##0.##") cell.numFmt = QTY_NUMFMT;
      }
    });
  });
}
