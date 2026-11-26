import { colLetter, createEvaluator, shiftRefs, type CellValue } from "@/lib/grid-formula";

// Công thức kiểu Excel cho các bảng duyệt giá (giá đội, thầu phụ) — dữ liệu ở state phía client, mỗi dòng = 1 dòng bảng.
// Địa chỉ ô như Excel: cột theo thứ tự cột hiển thị (A, B, C...), dòng = số thứ tự dòng trong bảng (1, 2, 3...).
// Công thức được LƯU theo dạng ổn định [[mãDòng|khoáCột]] (không theo số dòng) → thêm / xoá / sắp lại dòng không làm lệch
// tham chiếu; dòng bị xoá thì tham chiếu thành #REF!. Khi hiện / sửa thì đổi lại thành địa chỉ (K5, B2:B10...).
// Bộ tính dùng chung grid-formula.ts (SUM, ROUND, IF, MIN, MAX... + - * / ^ %).

export type XlLayout = { rows: string[]; cols: string[] }; // mã dòng theo thứ tự hiện; khoá cột theo thứ tự chữ cột
const TOKEN = /\[\[([^|\]]+)\|([^\]]+)\]\]/g;

// Địa chỉ tuyệt đối (F4: $K$5, K$5, $K5) lưu bằng dấu "$" đứng trước mã dòng / khoá cột: [[$mãDòng|$khoáCột]]
const bare = (x: string) => (x.startsWith("$") ? x.slice(1) : x);
const absAddr = (lay: XlLayout, row: string, col: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(xlAddr(lay, bare(row), bare(col)));
  return m ? `${col.startsWith("$") ? "$" : ""}${m[1]}${row.startsWith("$") ? "$" : ""}${m[2]}` : "";
};

const colIndex = (letters: string) => letters.toUpperCase().split("").reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

export function xlAddr(lay: XlLayout, rowId: string, col: string): string {
  const r = lay.rows.indexOf(rowId);
  const c = lay.cols.indexOf(col);
  return r < 0 || c < 0 ? "" : `${colLetter(c)}${r + 1}`;
}

// Thiếu dấu ")" thì tự thêm ở cuối khi ghi công thức (như Excel: =SUBTOTAL(9;K5:K9 → =SUBTOTAL(9;K5:K9))
export function balanceParens(display: string): string {
  let depth = 0;
  let inStr = false;
  for (const ch of display) {
    if (ch === '"') inStr = !inStr;
    else if (!inStr) depth += ch === "(" ? 1 : ch === ")" ? -1 : 0;
  }
  return depth > 0 ? display + ")".repeat(depth) : display;
}

// Địa chỉ (K5) → dạng lưu [[mãDòng|cột]]; ngoài bảng → #REF!
export function toStable(display: string, lay: XlLayout): string {
  const f = display.trim();
  if (!f.startsWith("=")) return f;
  let out = "";
  let i = 0;
  while (i < f.length) {
    const ch = f[i];
    if (ch === '"') {
      const j = f.indexOf('"', i + 1);
      const end = j === -1 ? f.length : j + 1;
      out += f.slice(i, end);
      i = end;
      continue;
    }
    const prev = i > 0 ? f[i - 1] : "";
    const m = /[A-Za-z$]/.test(ch) && !/[A-Za-z0-9_.[]/.test(prev) ? /^(\$?)([A-Za-z]{1,2})(\$?)(\d+)/.exec(f.slice(i)) : null;
    const after = m ? f[i + m[0].length] : undefined;
    if (m && after !== "(" && !/[A-Za-z_0-9.]/.test(after ?? "")) {
      const row = lay.rows[Number(m[4]) - 1];
      const col = lay.cols[colIndex(m[2])];
      out += row && col ? `[[${m[3]}${row}|${m[1]}${col}]]` : "#REF!";
      i += m[0].length;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

// Dạng lưu → địa chỉ đang hiện (dòng đã xoá → #REF!)
export function toDisplay(stable: string, lay: XlLayout): string {
  return stable.replace(TOKEN, (_m, row: string, col: string) => absAddr(lay, row, col) || "#REF!");
}

// Đổi mã dòng trong công thức (VD dòng "new:..." vừa lưu thành mã thật)
export function remapIds(stable: string, idMap: Map<string, string>): string {
  return stable.replace(TOKEN, (m, row: string, col: string) => (idMap.has(bare(row)) ? `[[${row.startsWith("$") ? "$" : ""}${idMap.get(bare(row))}|${col}]]` : m));
}

// Điền xuống (Ctrl+D) / sao chép công thức sang dòng khác: dời tham chiếu tương đối như Excel
export const shiftDisplay = (display: string, dRow: number, dCol = 0) => shiftRefs(display, dRow, dCol);

// Số → chuỗi cho bộ tính (dấu phẩy thập phân, không dấu chấm nghìn)
export const numRaw = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "" : String(v).replace(".", ","));

// Gõ kiểu Excel tiếng Việt: dấu phẩy giữa 2 chữ số là DẤU THẬP PHÂN (=K5*1,05), tham số hàm ngăn bằng ";" (=ROUND(K5*1,05;0)).
// Bộ tính dùng dấu chấm thập phân → đổi "1,05" thành "1.05" (không đụng tới tham chiếu ô như "K5,2" hay chuỗi trong "...")
export function forEval(display: string): string {
  let out = "";
  let i = 0;
  while (i < display.length) {
    if (display[i] === '"') {
      const j = display.indexOf('"', i + 1);
      const end = j === -1 ? display.length : j + 1;
      out += display.slice(i, end);
      i = end;
      continue;
    }
    const m = /^(\d+),(\d+)/.exec(display.slice(i));
    const prev = i > 0 ? display[i - 1] : "";
    if (m && !/[A-Za-z0-9$.]/.test(prev)) {
      out += `${m[1]}.${m[2]}`;
      i += m[0].length;
    } else {
      out += display[i];
      i++;
    }
  }
  return out;
}

// Tính toàn bảng: raw(r, c) (0-based) trả về nội dung ô — công thức (dạng địa chỉ) hoặc giá trị
export function evalGrid(lay: XlLayout, raw: (r: number, c: number) => string) {
  return createEvaluator(raw, lay.rows.length, lay.cols.length);
}
export type { CellValue };

// F4 khi gõ công thức: đổi kiểu tham chiếu tại con trỏ K5 → $K$5 → K$5 → $K5 → K5 (như Excel). null nếu con trỏ không đứng ở tham chiếu nào.
export function cycleAbsAt(text: string, caret: number): { text: string; caret: number } | null {
  const re = /(\$?)([A-Za-z]{1,2})(\$?)(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const s = m.index;
    const e = s + m[0].length;
    const prev = s > 0 ? text[s - 1] : "";
    const after = text[e] ?? "";
    if (/[A-Za-z0-9_."]/.test(prev) || after === "(" || /[A-Za-z_0-9.]/.test(after)) continue;
    if (caret < s || caret > e) continue;
    const st = (m[1] ? 2 : 0) + (m[3] ? 1 : 0); // 0 K5 · 3 $K$5 · 1 K$5 · 2 $K5
    const nx = st === 0 ? 3 : st === 3 ? 1 : st === 1 ? 2 : 0;
    const ref = `${nx & 2 ? "$" : ""}${m[2].toUpperCase()}${nx & 1 ? "$" : ""}${m[4]}`;
    return { text: text.slice(0, s) + ref + text.slice(e), caret: s + ref.length };
  }
  return null;
}
