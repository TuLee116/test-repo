// Định dạng KHỐI LƯỢNG dùng chung toàn app: luôn 2 số lẻ (VD 123,21; 5 → 5,00). Định mức dùng fmt-norm riêng.
export const QTY_NUMFMT = "#,##0.00"; // định dạng ô khối lượng khi xuất Excel

export function fmtQty(n: number | null | undefined): string {
  const v = n ?? 0;
  return (Math.abs(v) < 0.005 ? 0 : v).toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
