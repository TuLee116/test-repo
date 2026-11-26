// Chức danh người dùng (dùng chung client / server) + checklist quyền GỢI Ý tự tick khi chọn chức danh lúc tạo / sửa tài khoản.
// dtcp / proc / price / sub: mã quyền ở DT-CP, Mua vật tư, Trình giá tổ đội, Trình giá thầu phụ (src/lib/perms.ts)
export type PositionPreset = { value: string; label: string; dtcp: string[]; proc: string[]; price: string[]; sub: string[] };
export const POSITIONS: PositionPreset[] = [
  { value: "QSĐT", label: "QSĐT - QS đấu thầu / lập DT-CP", dtcp: ["VIEW", "EDIT", "NORM"], proc: [], price: ["QSDT"], sub: ["QSDT"] },
  { value: "QSTT", label: "QSTT - QS thanh toán", dtcp: ["VIEW", "QSTT"], proc: [], price: ["QSTT"], sub: ["QSTT"] },
  { value: "Trưởng phòng Kết cấu", label: "Trưởng phòng - Kết cấu", dtcp: ["VIEW", "TP_KC", "NORM_REVIEW"], proc: [], price: ["TP_KC"], sub: ["TP_KC"] },
  { value: "Trưởng phòng Hoàn thiện Phú Quốc", label: "Trưởng phòng - Hoàn thiện Phú Quốc", dtcp: ["VIEW", "TP_HTPQ"], proc: [], price: ["TP_HTPQ"], sub: ["TP_HTPQ"] },
  { value: "Trưởng phòng Hoàn thiện khu vực khác", label: "Trưởng phòng - Hoàn thiện các khu vực còn lại", dtcp: ["VIEW", "TP_HTKV"], proc: [], price: ["TP_HTKV"], sub: ["TP_HTKV"] },
  { value: "Phó TGĐ thường trực", label: "Phó tổng giám đốc thường trực", dtcp: ["VIEW", "PTG"], proc: ["PTGD"], price: ["VIEW"], sub: ["PTG"] },
  { value: "Cán bộ vật tư", label: "Cán bộ vật tư", dtcp: [], proc: ["CBVT"], price: [], sub: [] },
  { value: "Kế toán vật tư", label: "Kế toán vật tư", dtcp: [], proc: ["KTVT"], price: [], sub: [] },
  { value: "Giám sát", label: "Giám sát hiện trường (BCH)", dtcp: [], proc: ["GS"], price: [], sub: [] },
  { value: "Chỉ huy trưởng", label: "Chỉ huy trưởng (BCH)", dtcp: [], proc: ["CHT"], price: [], sub: [] },
  { value: "Kế toán", label: "Phòng kế toán", dtcp: [], proc: ["KT"], price: [], sub: [] },
];
