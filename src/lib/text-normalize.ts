// Chuẩn hoá text tiếng Việt để so khớp mô tả công việc (bỏ dấu, hoa/thường, khoảng trắng thừa)
export function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
