// CHECKLIST QUYỀN theo từng phân hệ (dùng chung client / server). Mỗi người được tick từng việc được làm ở mỗi phân hệ.
// Lưu ở User: dtcpPerms (DT-CP), procRoles (Mua vật tư), priceRoles (Trình giá tổ đội), subRoles (Trình giá thầu phụ), areas (khu vực).
export type PermItem = { value: string; label: string; hint?: string };
export type PermModule = { key: "dtcp" | "proc" | "price" | "sub"; app: "DTCP" | "PROC" | "PRICE"; title: string; items: PermItem[] };

export const PERM_MODULES: PermModule[] = [
  {
    key: "dtcp",
    app: "DTCP",
    title: "DT-CP",
    items: [
      { value: "VIEW", label: "Xem DT-CP, BOQ, xuất Excel" },
      { value: "EDIT", label: "Lập mới / điều chỉnh DT-CP và trình duyệt (QSĐT)" },
      { value: "QSTT", label: "Kiểm tra DT-CP, trình Trưởng phòng (QSTT)" },
      { value: "TP_KC", label: "Trưởng phòng Kết cấu xem & trình Phó Tổng" },
      { value: "TP_HTPQ", label: "Trưởng phòng Hoàn thiện Phú Quốc xem & trình Phó Tổng" },
      { value: "TP_HTKV", label: "Trưởng phòng Hoàn thiện khu vực khác xem & trình Phó Tổng" },
      { value: "PTG", label: "Phó Tổng duyệt DT-CP" },
      { value: "NORM", label: "Thêm / sửa định mức" },
      { value: "NORM_REVIEW", label: "Duyệt định mức người khác thêm (thống nhất mã)" },
      { value: "PRICE", label: "Sửa đơn giá gốc / thêm tài nguyên danh mục" },
    ],
  },
  {
    key: "proc",
    app: "PROC",
    title: "Mua vật tư",
    items: [
      { value: "GS", label: "Lập phiếu đề nghị vật tư, báo nhận hàng (BCH – Giám sát)" },
      { value: "CHT", label: "Duyệt phiếu đề nghị (Chỉ huy trưởng)" },
      { value: "CBVT", label: "Lên đơn hàng, đặt hàng, lên công nợ (Cán bộ vật tư)" },
      { value: "KTVT", label: "Lấy báo giá, lập bảng so sánh, trình duyệt (Kế toán vật tư)" },
      { value: "PTGD", label: "Duyệt bảng so sánh / đơn hàng (PTGĐ thường trực)" },
      { value: "KT", label: "Thanh toán nhà cung cấp (Phòng kế toán)" },
    ],
  },
  {
    key: "price",
    app: "PRICE",
    title: "Trình giá tổ đội",
    items: [
      { value: "QSTT", label: "Tải file, kiểm tra, trình duyệt, soạn mail (QSTT)" },
      { value: "QSDT", label: "Nhập / cập nhật DT-CP hợp đồng & sổ giá" },
      { value: "TP_KC", label: "Duyệt hồ sơ hạng mục Kết cấu" },
      { value: "TP_HTPQ", label: "Duyệt hồ sơ hạng mục Hoàn thiện Phú Quốc" },
      { value: "TP_HTKV", label: "Duyệt hồ sơ hạng mục Hoàn thiện khu vực khác" },
      { value: "VIEW", label: "Chỉ xem hồ sơ và sổ giá" },
    ],
  },
  {
    key: "sub",
    app: "PRICE",
    title: "Trình giá thầu phụ",
    items: [
      { value: "QSDT", label: "Lập hồ sơ, tải file so sánh, bổ sung / trình lại (QSĐT)" },
      { value: "QSTT", label: "Kiểm tra & trình Trưởng phòng, lên HĐ/PLHĐ, soạn mail (QSTT)" },
      { value: "TP_KC", label: "Duyệt hồ sơ hạng mục Kết cấu" },
      { value: "TP_HTPQ", label: "Duyệt hồ sơ hạng mục Hoàn thiện Phú Quốc" },
      { value: "TP_HTKV", label: "Duyệt hồ sơ hạng mục Hoàn thiện khu vực khác" },
      { value: "PTG", label: "Phó Tổng: phê duyệt nhánh B, xem để nắm nhánh A" },
      { value: "EXPORT", label: "Xuất file tổng hợp đệ trình thầu phụ (theo tuần / tháng / năm)" },
      { value: "VIEW", label: "Chỉ xem hồ sơ và sổ giá thầu phụ" },
    ],
  },
];
export const AREAS = ["1", "2", "3", "4", "5"];

export const codesOf = (key: PermModule["key"]) => PERM_MODULES.find((m) => m.key === key)!.items.map((i) => i.value);
export const parseCodes = (s: string, key: PermModule["key"]) => {
  const valid = new Set(codesOf(key));
  return [...new Set(s.split(",").map((x) => x.trim()).filter((x) => valid.has(x)))];
};
export const parseAreas = (s: string) => [...new Set(s.split(",").map((x) => x.trim()).filter((x) => AREAS.includes(x)))];
export const labelOf = (key: PermModule["key"], code: string) => PERM_MODULES.find((m) => m.key === key)?.items.find((i) => i.value === code)?.label ?? code;
