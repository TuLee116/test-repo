// Các CHƯƠNG TRÌNH (phân hệ) của DT-CP Online — người dùng được tick chương trình nào mới thấy menu / vào được trang đó.
// Lưu ở User.apps (cách nhau dấu phẩy). Quản trị (ADMIN) dùng được tất cả. File dùng chung client / server.
export const APPS = [
  { code: "DTCP", label: "DT-CP (Dự án, BOQ, Định mức)", href: "/projects" },
  { code: "PROC", label: "Mua vật tư", href: "/mua-vat-tu" },
  { code: "PRICE", label: "Đệ trình giá đội", href: "/gia-doi" },
  { code: "SUB", label: "Trình giá thầu phụ", href: "", soon: true },
] as const;
export type AppCode = (typeof APPS)[number]["code"];

export function parseApps(s: string): Set<AppCode> {
  const valid = new Set<string>(APPS.map((a) => a.code));
  return new Set(s.split(",").map((x) => x.trim()).filter((x) => valid.has(x)) as AppCode[]);
}
