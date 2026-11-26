// Hiển thị định mức hao phí: tối đa 2 số sau dấu phẩy (giá trị thật vẫn lưu đủ chữ số).
// Định mức quá nhỏ làm tròn về 0 (VD 0,004) thì hiện thêm số lẻ để không bị thành "0".
export function fmtNorm(n: number): string {
  const r = Math.round(n * 100) / 100;
  if (n !== 0 && r === 0) return n.toLocaleString("vi-VN", { maximumSignificantDigits: 2 });
  return r.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}
