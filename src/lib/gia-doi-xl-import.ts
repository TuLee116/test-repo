import type { LineField } from "@/lib/gia-doi-excel";

// GIỮ CÔNG THỨC EXCEL khi QSTT tải file đề xuất của BCH lên: công thức A1 của file (VD =D18*E18, =SUBTOTAL(9,K18:K22))
// đổi sang dạng lưu của bảng duyệt giá — tham chiếu theo [[mãDòng|khoáCột]] (xem xl-formula.ts) để thêm / xoá dòng không lệch.
// Công thức trỏ ra ngoài bảng (sheet khác, cột / dòng không nhận ra) → bỏ công thức, giữ SỐ đã tính trong file.

// ô số được đặt công thức (cùng nhóm với QS_FORMULA_KEYS của gia-doi-actions, bỏ phần Trưởng phòng)
export const XL_TARGET_FIELDS = ["qty", "cdtPrice", "basePrice", "sitePrice", "cdtAmount", "baseAmount", "siteAmount"] as const satisfies readonly LineField[];
export type XlTarget = (typeof XL_TARGET_FIELDS)[number];
export const XL_TOTAL_FIELDS = ["cdtAmount", "baseAmount", "siteAmount"] as const;

// cột của file → khoá cột trong bảng duyệt (theo cách bảng PriceSheet đặt tên cột)
export function xlColKeys(colMap: Partial<Record<LineField, number>>): Map<number, string> {
  const m = new Map<number, string>();
  const put = (f: LineField, key: string) => {
    const c = colMap[f];
    if (c) m.set(c, key);
  };
  for (const f of ["stt", "content", "unit", "qty", "cdtPrice", "cdtAmount", "basePrice", "baseAmount", "baseNote", "siteOpinion", "sitePrice", "siteAmount", "siteNote"] as const) put(f, f);
  put("ptPrice", "tpPrice");
  put("ptAmount", "apprAmount");
  return m;
}

const colNum = (letters: string) => letters.toUpperCase().split("").reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0);

type Ctx = {
  rowId: Map<number, string>; // số dòng trong file → mã dòng (dòng công việc / nhóm đã đọc)
  rows: number[]; // các số dòng trên, đã sắp tăng dần (để co đầu mút vùng K18:K22 về dòng có thật)
  colKey: Map<number, string>;
  totalRow?: number;
  totalId: string;
};

// "D18*E18" → "=[[id1|qty]]*[[id2|cdtPrice]]" ; trả null nếu có tham chiếu không đổi được
export function convertExcelFormula(raw: string, cx: Ctx): string | null {
  const f = raw.replace(/^=/, "");
  let out = "";
  let i = 0;
  const refAt = (s: string) => /^\$?([A-Z]{1,3})\$?(\d+)/i.exec(s);
  const one = (col: number, row: number): string | null => {
    const key = cx.colKey.get(col);
    const id = row === cx.totalRow ? cx.totalId : cx.rowId.get(row);
    return key && id ? `[[${id}|${key}]]` : null;
  };
  while (i < f.length) {
    const ch = f[i];
    if (ch === '"') {
      const j = f.indexOf('"', i + 1);
      const end = j === -1 ? f.length : j + 1;
      out += f.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "'" || ch === "[" || ch === "!") return null; // sheet khác / file ngoài
    const prev = i > 0 ? f[i - 1] : "";
    if (/[A-Za-z$]/.test(ch) && !/[A-Za-z0-9_.]/.test(prev)) {
      const m = refAt(f.slice(i));
      if (m) {
        let len = m[0].length;
        const after = f[i + len];
        if (after === "(") {
          // tên hàm có số (LOG10...) — không phải tham chiếu
          out += f.slice(i, i + len);
          i += len;
          continue;
        }
        if (after === "!") return null;
        const c1 = colNum(m[1]);
        const r1 = Number(m[2]);
        // vùng K18:K22
        let m2: RegExpExecArray | null = null;
        if (f[i + len] === ":") {
          m2 = refAt(f.slice(i + len + 1));
          if (m2) len += 1 + m2[0].length;
        }
        if (/[A-Za-z_0-9.]/.test(f[i + len] ?? "")) return null; // tên lạ
        if (!m2) {
          const t = one(c1, r1);
          if (!t) return null;
          out += t;
        } else {
          const c2 = colNum(m2[1]);
          const r2 = Number(m2[2]);
          if (c1 !== c2) return null; // vùng nhiều cột: không đổi
          const lo = Math.min(r1, r2);
          const hi = Math.max(r1, r2);
          // co 2 đầu vùng về dòng có thật (dòng trống / ẩn trong vùng không được đọc)
          const inside = cx.rows.filter((x) => x >= lo && x <= hi);
          if (!inside.length) return null;
          const a = one(c1, inside[0]);
          const b = one(c1, inside[inside.length - 1]);
          if (!a || !b) return null;
          out += `${a}:${b}`;
        }
        i += len;
        continue;
      }
    }
    // số thập phân kiểu Excel (1.05) → kiểu gõ trong phần mềm (1,05); dấu phẩy ngăn tham số → ";"
    const num = /^\d+\.\d+/.exec(f.slice(i));
    if (num && !/[A-Za-z0-9_.]/.test(prev)) {
      out += num[0].replace(".", ",");
      i += num[0].length;
      continue;
    }
    out += ch === "," ? ";" : ch;
    i++;
  }
  return `=${out}`;
}

export type XlSheetData = {
  lines: Record<number, Partial<Record<XlTarget, string>>>; // theo số dòng trong file
  total?: { row: number; formulas: Partial<Record<(typeof XL_TOTAL_FIELDS)[number], string>>; amounts: { cdt: number | null; base: number | null; site: number | null } };
};

// Đổi công thức của cả sheet. rowIds: số dòng trong file → mã dòng đã cấp; trả công thức JSON từng dòng + dòng TỔNG CỘNG
export function convertSheetFormulas(xl: XlSheetData, colMap: Partial<Record<LineField, number>>, rowIds: Map<number, string>, totalId: string) {
  const cx: Ctx = { rowId: rowIds, rows: [...rowIds.keys()].sort((a, b) => a - b), colKey: xlColKeys(colMap), totalRow: xl.total?.row, totalId };
  const perLine = new Map<string, string>(); // mã dòng → JSON công thức
  for (const [rowStr, fs] of Object.entries(xl.lines)) {
    const id = rowIds.get(Number(rowStr));
    if (!id) continue;
    const o: Record<string, string> = {};
    for (const [k, raw] of Object.entries(fs)) {
      const c = raw ? convertExcelFormula(raw, cx) : null;
      if (c) o[k] = c;
    }
    if (Object.keys(o).length) perLine.set(id, JSON.stringify(o));
  }
  let total: { formulas: string; amounts: string } | null = null;
  if (xl.total) {
    const o: Record<string, string> = {};
    for (const [k, raw] of Object.entries(xl.total.formulas)) {
      const c = raw ? convertExcelFormula(raw, cx) : null;
      if (c) o[k] = c;
    }
    if (Object.keys(o).length) total = { formulas: JSON.stringify(o), amounts: JSON.stringify(Object.fromEntries(Object.entries(xl.total.amounts).filter(([, v]) => typeof v === "number"))) };
  }
  return { perLine, total };
}
