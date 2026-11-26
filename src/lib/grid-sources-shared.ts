// Phần dùng chung được cho client (không import prisma): nguồn liên kết dùng trong công thức bảng tự do — LINK("khoá")
// disabled: lý do nguồn này không chọn được (VD sheet tự do lấy số từ chi phí → sẽ tính vòng)
export type GridSourceOption = { value: string; label: string; group: string; disabled?: string };

// Các hàm LINK("khoá") có trong 1 công thức (bỏ qua nội dung trong chuỗi khác)
export function linkKeysOf(formula: string): string[] {
  const out: string[] = [];
  const re = /\bLINK\(\s*"([^"]*)"\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula))) out.push(m[1]);
  return out;
}
