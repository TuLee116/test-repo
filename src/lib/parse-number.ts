// Đọc 1 số dán từ Excel / file khác: chấp nhận 1.234.567,5 (kiểu Việt) và 1,234,567.5 (kiểu Anh), bỏ ký hiệu tiền tệ, khoảng trắng.
// Chỉ MỘT dấu phẩy luôn là thập phân (kiểu Việt): "42,851" = 42,851 (khối lượng), "1,234" = 1,234.
// Trả về null nếu ô trống hoặc không phải số.
export function parsePastedNumber(raw: string): number | null {
  let s = raw.replace(/[^\d.,-]/g, "");
  if (!s || s === "-" || s === "." || s === ",") return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (hasComma) {
    // phần mềm dùng kiểu Việt: MỘT dấu phẩy = dấu thập phân (42,851 = 42 phẩy 851, KHÔNG phải 42.851 đơn vị nghìn);
    // chỉ coi là dấu nghìn kiểu Anh khi có từ 2 nhóm ",ddd" trở lên (1,234,567)
    s = /^-?[1-9]\d{0,2}(,\d{3}){2,}$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (hasDot && /^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
