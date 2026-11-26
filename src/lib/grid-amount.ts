import { normalizeText } from "@/lib/text-normalize";

// Cột "Thành tiền" của bảng tự do (GRID) nhận theo tên cột: dùng khi sheet chưa chọn cột tổng (đầu mục có subtotal,
// cuối bảng có dòng TỔNG CỘNG, link được sang DT-CP). Nhiều cột cùng tên thì lấy cột đầu - các cột sau vẫn được cộng
// theo (xem extraAmountCols ở GridEditor.tsx).
export function detectAmountCol(titles: string[]): number | null {
  const i = titles.findIndex((t) => /^thanh tien\b/.test(normalizeText(t)));
  return i >= 0 ? i : null;
}

// Các cột "Thành tiền" KHÁC cột chính (VD sheet BPTC: Thành tiền Trực tiếp phí + Thành tiền Chủ đầu tư) - mỗi cột là 1
// nguồn liên kết riêng (tổng sheet "gridc:<sheetId>:<cột>", tổng đầu mục "gridhc:<metaId>:<cột>"). label lấy theo tiêu đề
// nhóm cột ở dòng tiêu đề phụ ngay trên (ô gộp: tiêu đề nằm ở ô trái nhất của nhóm).
export function extraAmountCols(titles: string[], amountCol: number | null, headerRows: string[][]): { col: number; label: string }[] {
  return titles
    .map((t, col) => ({ t, col }))
    .filter(({ t, col }) => col !== amountCol && /^thanh tien\b/.test(normalizeText(t)))
    .map(({ t, col }) => ({ col, label: `${t.trim()}${groupTitleOf(headerRows, col) ? ` (${groupTitleOf(headerRows, col)})` : ""}` }));
}

// tiêu đề nhóm cột (dòng tiêu đề phụ sát dòng tên cột) của cột col
export function groupTitleOf(headerRows: string[][], col: number): string {
  const row = headerRows[0] ?? [];
  for (let c = col; c >= 0; c--) if ((row[c] ?? "").trim()) return row[c].trim();
  return "";
}
