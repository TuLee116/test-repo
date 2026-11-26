// Định dạng ô của bảng tự do (GRID): lưu dạng JSON trong GridCell.style. Hàm thuần, dùng được cả server lẫn client.

export type CellStyle = {
  b?: boolean; // in đậm
  i?: boolean; // in nghiêng
  u?: boolean; // gạch chân
  align?: "left" | "center" | "right";
  color?: string; // màu chữ #rrggbb
  bg?: string; // màu nền #rrggbb
  pct?: boolean; // hiện dạng phần trăm (0.15 → 15%)
  sep?: boolean; // true = hiện dấu phân cách hàng nghìn cho cả số gõ thường; false = bỏ dấu
  dec?: number; // số chữ số sau dấu phẩy (0-10)
  reset?: boolean; // ô này KHÔNG kế thừa định dạng của ô phía trên (đã bấm "Xoá định dạng")
  fs?: number; // cỡ chữ (8-36)
  bd?: "all" | "none"; // viền ô: kẻ đậm đủ 4 cạnh / bỏ viền (không có = viền mặc định của bảng)
};

const HEX = /^#[0-9a-fA-F]{6}$/;

export function sanitizeStyle(raw: unknown): CellStyle {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s: CellStyle = {};
  if (o.b === true) s.b = true;
  if (o.i === true) s.i = true;
  if (o.u === true) s.u = true;
  if (o.align === "left" || o.align === "center" || o.align === "right") s.align = o.align;
  if (typeof o.color === "string" && HEX.test(o.color)) s.color = o.color.toLowerCase();
  if (typeof o.bg === "string" && HEX.test(o.bg)) s.bg = o.bg.toLowerCase();
  if (o.pct === true) s.pct = true;
  if (o.sep === true || o.sep === false) s.sep = o.sep;
  if (typeof o.dec === "number" && Number.isInteger(o.dec) && o.dec >= 0 && o.dec <= 10) s.dec = o.dec;
  if (typeof o.fs === "number" && Number.isInteger(o.fs) && o.fs >= 8 && o.fs <= 36) s.fs = o.fs;
  if (o.bd === "all" || o.bd === "none") s.bd = o.bd;
  if (o.reset === true) s.reset = true;
  return s;
}

export function parseStyle(json: string | undefined): CellStyle {
  if (!json) return {};
  try {
    return sanitizeStyle(JSON.parse(json));
  } catch {
    return {};
  }
}

export function stringifyStyle(s: CellStyle): string {
  const clean = sanitizeStyle(s);
  return Object.keys(clean).length === 0 ? "" : JSON.stringify(clean);
}

// Hiển thị số theo định dạng ô; null = ô không có định dạng số (dùng cách hiển thị mặc định)
// defaultDec: số lẻ mặc định khi ô chưa chọn số lẻ (kết quả công thức mặc định làm tròn số nguyên)
export function formatStyledNumber(v: number, s: CellStyle, defaultDec?: number): string | null {
  if (!s.pct && s.sep === undefined && s.dec === undefined) return null;
  const n = s.pct ? v * 100 : v;
  const out = n.toLocaleString("vi-VN", {
    minimumFractionDigits: s.dec ?? 0,
    maximumFractionDigits: s.dec ?? defaultDec ?? (s.pct ? 2 : 6),
    useGrouping: s.sep ?? true,
  });
  return s.pct ? `${out}%` : out;
}

// Số chữ số sau dấu phẩy đang hiển thị mặc định của 1 số (dùng làm mốc khi bấm tăng/giảm số lẻ)
export function shownDecimals(v: number): number {
  const t = Number(v.toFixed(6)).toString();
  const i = t.indexOf(".");
  return i < 0 ? 0 : t.length - i - 1;
}
