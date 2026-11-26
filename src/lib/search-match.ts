// Tìm hồ sơ nhiều khoá: bỏ dấu, không phân biệt hoa thường; nhiều từ cách nhau bằng khoảng trắng = phải khớp TẤT CẢ (mỗi từ khớp ít nhất 1 trường).
export const normText = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();

export function matchQuery(fields: (string | null | undefined)[], q: string): boolean {
  const tokens = normText(q).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = fields.map((f) => normText(f ?? ""));
  return tokens.every((t) => hay.some((h) => h.includes(t)));
}
