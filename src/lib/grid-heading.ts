// Đầu mục lớn của bảng tự do (GRID): số thứ tự (tự đánh theo cấp hoặc do người dùng gõ) và phạm vi của từng đầu mục
// khi có đầu mục lồng trong đầu mục khác. Hàm thuần, dùng được cả server lẫn client.

export type HeadingLite = { id: string; row: number; stt: string | null; level: number };

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"];

// Cấp 0: I, II, III... | cấp 1: 1, 2, 3... | cấp 2: a, b, c... | sâu hơn: 1, 2, 3...
export function autoStt(level: number, n: number): string {
  if (level === 0) return ROMAN[n - 1] ?? String(n);
  if (level === 2) return String.fromCharCode(96 + ((n - 1) % 26) + 1);
  return String(n);
}

// Số thứ tự hiển thị của từng đầu mục (theo thứ tự dòng): đếm riêng từng cấp, về 0 khi gặp đầu mục cấp cao hơn
export function headingLabels(heads: HeadingLite[]): string[] {
  const sorted = [...heads].sort((a, b) => a.row - b.row);
  const counters: number[] = [];
  const out = new Map<string, string>();
  for (const h of sorted) {
    const l = Math.max(0, h.level);
    counters[l] = (counters[l] ?? 0) + 1;
    for (let k = l + 1; k < counters.length; k++) counters[k] = 0;
    out.set(h.id, h.stt && h.stt.trim() !== "" ? h.stt : autoStt(l, counters[l]));
  }
  return heads.map((h) => out.get(h.id) as string);
}

// Dòng kết thúc (không tính) của đầu mục: đầu mục kế tiếp CÙNG cấp hoặc cấp cao hơn; đầu mục con nằm trọn bên trong
export function headingBlockEnd(sorted: HeadingLite[], index: number, rowCount: number): number {
  const level = sorted[index].level;
  for (let j = index + 1; j < sorted.length; j++) if (sorted[j].level <= level) return sorted[j].row;
  return rowCount;
}
