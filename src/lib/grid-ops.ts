// Thao tác kiểu Excel trên bảng tự do (hàm thuần): bảng tính tab ↔ văn bản, sao chép-dán công thức, kéo điền chuỗi, hoàn tác.
import { shiftRefs } from "@/lib/grid-formula";

// 1 thay đổi của 1 ô: nội dung và/hoặc định dạng (style = JSON CellStyle, "" = mặc định)
export type CellOp = { row: number; col: number; value?: string; style?: string };

// Văn bản dán từ Excel: các ô cách nhau Tab, dòng cách nhau xuống dòng; ô có xuống dòng / dấu nháy được bọc trong "..."
export function parseTSV(text: string): string[][] {
  const src = text.replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let quoted = false;
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      i++;
    } else if (ch === "\t") {
      row.push(field);
      field = "";
      i++;
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function toTSV(rows: string[][]): string {
  return rows.map((r) => r.map((v) => (/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join("\t")).join("\n");
}

// Thao tác ngược lại để hoàn tác (lấy nội dung / định dạng hiện tại của đúng các ô sắp bị đổi)
export function inverseOps(ops: CellOp[], cells: Record<string, string>, styles: Record<string, string>): CellOp[] {
  return ops.map((op) => {
    const key = `${op.row}:${op.col}`;
    const inv: CellOp = { row: op.row, col: op.col };
    if (op.value !== undefined) inv.value = cells[key] ?? "";
    if (op.style !== undefined) inv.style = styles[key] ?? "";
    return inv;
  });
}

const plainNumber = (s: string): number | null => {
  const t = s.trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};
const fmtNum = (n: number) => String(Math.round(n * 1e10) / 1e10);

// Giá trị của ô thứ idx (0 = ô nguồn đầu tiên) khi kéo điền tiếp ra ngoài vùng nguồn theo 1 chiều
export function fillValue(src: string[], idx: number, dir: "down" | "right"): string {
  const n = src.length;
  const shift = (v: string, steps: number) => (dir === "down" ? shiftRefs(v, steps, 0) : shiftRefs(v, 0, steps));
  // ≥ 2 số có hiệu không đổi → điền tiếp dãy số
  if (n >= 2) {
    const nums = src.map(plainNumber);
    if (nums.every((x) => x !== null)) {
      const step = (nums[1] as number) - (nums[0] as number);
      if (nums.every((x, i) => i === 0 || Math.abs((x as number) - (nums[i - 1] as number) - step) < 1e-9)) return fmtNum((nums[0] as number) + step * idx);
    }
    const p = idx % n;
    return shift(src[p], idx - p);
  }
  const v = src[0];
  if (v.startsWith("=")) return shift(v, idx);
  if (plainNumber(v) !== null) return v; // 1 số: nhân bản
  const m = /^([\s\S]*?)(\d+)$/.exec(v); // chữ có số ở cuối ("Hạng mục 1") → tăng số
  if (m) return m[1] + String(Number(m[2]) + idx).padStart(m[2].length, "0");
  return v;
}
