// Danh mục cấu kiện thiết bị mặc định (nạp 1 lần khi bảng EquipItem còn trống), lấy theo file khái toán thiết bị mẫu
// "BẢNG TỔNG HỢP KHÁI TOÁN THIẾT BỊ HILL SIDE HH 4.4" (sheet DATA: giá thuê / ngày theo NCC + trọng lượng; sheet 06: giá mua
// + % hao hụt; sheet 02 / 05: vật tư mua mới). Sau khi nạp, người dùng tự cập nhật giá ở "Tính toán thiết bị → Đơn giá".

export type EquipSeed = {
  code: string;
  name: string;
  unit: string;
  category: "Chống sàn" | "Bao che" | "An toàn";
  mode: "RENT" | "BUY";
  weight?: number; // kg / đơn vị
  suppliers?: Record<string, number>; // giá thuê / ngày (hoặc giá mua) theo nhà cung cấp
  price?: number; // giá khi không có giá NCC
  buyPrice?: number; // giá mua mới (tính hao hụt)
  lossPct?: number; // % hao hụt
};

export const EQUIP_SEED: EquipSeed[] = [
  // ---- Chống sàn (giáo Ringlock + xà gồ hộp + ván) ----
  { code: "RL1000", name: "Giáo Ringlock loại 1m", unit: "cây", category: "Chống sàn", mode: "RENT", weight: 4.71, suppliers: { "KIM MINH": 120, "VẠN LỘC": 120, SAKI: 111, BUILDKEY: 120 }, buyPrice: 200000, lossPct: 0.2 },
  { code: "RL1500", name: "Giáo Ringlock loại 1,5m", unit: "cây", category: "Chống sàn", mode: "RENT", weight: 6.76, suppliers: { "KIM MINH": 130, "VẠN LỘC": 150, SAKI: 159, BUILDKEY: 150 }, buyPrice: 300000, lossPct: 0.2 },
  { code: "RL2000", name: "Giáo Ringlock loại 2m", unit: "cây", category: "Chống sàn", mode: "RENT", weight: 8.82, suppliers: { "KIM MINH": 180, "VẠN LỘC": 195, SAKI: 211, BUILDKEY: 180 }, buyPrice: 400000, lossPct: 0.2 },
  { code: "RL2500", name: "Giáo Ringlock loại 2,5m", unit: "cây", category: "Chống sàn", mode: "RENT", weight: 10.87, suppliers: { "KIM MINH": 218, "VẠN LỘC": 230, SAKI: 259, BUILDKEY: 220 }, buyPrice: 450000, lossPct: 0.2 },
  { code: "HOR1200", name: "Tay giằng 1,2m", unit: "cây", category: "Chống sàn", mode: "RENT", weight: 3.2, suppliers: { "KIM MINH": 83, "VẠN LỘC": 90, SAKI: 86, BUILDKEY: 88 }, buyPrice: 150000, lossPct: 0.2 },
  { code: "HOR600", name: "Tay giằng 0,6m", unit: "cây", category: "Chống sàn", mode: "RENT", weight: 1.93, suppliers: { "KIM MINH": 65, "VẠN LỘC": 70, SAKI: 57, BUILDKEY: 80 }, buyPrice: 125000, lossPct: 0.2 },
  { code: "OBL1200", name: "Tay giằng chéo 1,2m", unit: "cái", category: "Chống sàn", mode: "RENT", weight: 4.25, suppliers: { "VẠN LỘC": 120, SAKI: 137 }, buyPrice: 150000, lossPct: 0.2 },
  { code: "OBL600", name: "Tay giằng chéo 0,6m", unit: "cái", category: "Chống sàn", mode: "RENT", weight: 3.85, suppliers: { "VẠN LỘC": 100, SAKI: 117 }, buyPrice: 120000, lossPct: 0.2 },
  { code: "JB38", name: "Chân kích D38", unit: "cây", category: "Chống sàn", mode: "RENT", weight: 2.89, suppliers: { "KIM MINH": 95, "VẠN LỘC": 80, SAKI: 76, BUILDKEY: 85, HDC: 99 }, buyPrice: 210000, lossPct: 0.2 },
  { code: "JU38", name: "Đầu kích D38", unit: "cây", category: "Chống sàn", mode: "RENT", weight: 2.74, suppliers: { "KIM MINH": 95, "VẠN LỘC": 80, SAKI: 85, BUILDKEY: 85, HDC: 99 }, buyPrice: 165000, lossPct: 0.2 },
  { code: "B100_2000", name: "Hộp 50x100 L=2000", unit: "cây", category: "Chống sàn", mode: "RENT", weight: 9.11, suppliers: { TMN: 251, "KIM MINH": 320, "VẠN LỘC": 284, SAKI: 221, BUILDKEY: 260, HDC: 280 }, buyPrice: 160000, lossPct: 3 },
  { code: "B100_3000", name: "Hộp 50x100 L=3000", unit: "cây", category: "Chống sàn", mode: "RENT", weight: 13.67, suppliers: { TMN: 376, "KIM MINH": 480, "VẠN LỘC": 426, BUILDKEY: 390, HDC: 420, MATEC: 487 }, buyPrice: 150000, lossPct: 3 },
  { code: "B100_4000", name: "Hộp 50x100 L=4000", unit: "cây", category: "Chống sàn", mode: "RENT", weight: 18.23, suppliers: { TMN: 501, "KIM MINH": 640, "VẠN LỘC": 568, BUILDKEY: 520, HDC: 560 }, buyPrice: 200000, lossPct: 3 },
  { code: "B50_2000", name: "Hộp 50x50 L=2000", unit: "cây", category: "Chống sàn", mode: "RENT", weight: 5.98, suppliers: { TMN: 167, "KIM MINH": 196, "VẠN LỘC": 200, BUILDKEY: 174, HDC: 190 }, buyPrice: 60000, lossPct: 3 },
  { code: "B50_3000", name: "Hộp 50x50 L=3000", unit: "cây", category: "Chống sàn", mode: "RENT", weight: 8.97, suppliers: { TMN: 252, "KIM MINH": 294, "VẠN LỘC": 300, SAKI: 217, BUILDKEY: 261, HDC: 285, MATEC: 259 }, buyPrice: 85000, lossPct: 3 },
  { code: "B50_4000", name: "Hộp 50x50 L=4000", unit: "cây", category: "Chống sàn", mode: "RENT", weight: 11.96, suppliers: { TMN: 335, "KIM MINH": 392, "VẠN LỘC": 400, SAKI: 290, BUILDKEY: 348, HDC: 380 }, buyPrice: 113000, lossPct: 3 },
  { code: "TUBE", name: "Tuýp tròn D49 (giằng)", unit: "m", category: "Chống sàn", mode: "RENT", weight: 2.275, suppliers: { TMN: 70, "KIM MINH": 95, "VẠN LỘC": 83, HDC: 85 }, buyPrice: 100000, lossPct: 2 },
  { code: "CLAMP", name: "Cùm tuýp phi 49", unit: "cái", category: "Chống sàn", mode: "RENT", weight: 0.7, suppliers: { TMN: 12, "KIM MINH": 57, "VẠN LỘC": 50, HDC: 85 }, buyPrice: 24000, lossPct: 2 },
  { code: "TIE16", name: "Ty ren D16", unit: "m", category: "Chống sàn", mode: "RENT", weight: 1.58, price: 0 },
  { code: "BOWL16", name: "Bát chuồn D16", unit: "cái", category: "Chống sàn", mode: "RENT", weight: 0.3, price: 0 },
  { code: "PLY", name: "Ván ép phủ phim 18mm", unit: "m2", category: "Chống sàn", mode: "BUY", price: 144781 },
  // ---- Bao che (giàn khung treo dầm I) ----
  { code: "BR3000", name: "Giá treo thép I150x3000 (dầm I góc)", unit: "cây", category: "Bao che", mode: "RENT", weight: 67.06, suppliers: { NIKKEN: 1044, MATEC: 2000 }, buyPrice: 800000, lossPct: 1 },
  { code: "BR1700", name: "Giá treo thép I150x1700", unit: "cây", category: "Bao che", mode: "RENT", weight: 38, suppliers: { NIKKEN: 1044, MATEC: 1500 }, buyPrice: 600000, lossPct: 1 },
  { code: "FRAME", name: "Giàn khung 1250x1750", unit: "khung", category: "Bao che", mode: "RENT", weight: 13.13, suppliers: { TMN: 307, "KIM MINH": 335, "VẠN LỘC": 300, SAKI: 299, HDC: 315, MATEC: 312 }, buyPrice: 365000, lossPct: 0.5 },
  { code: "BRACE", name: "Chéo D21 L=1960", unit: "cặp", category: "Bao che", mode: "RENT", weight: 2.8, suppliers: { TMN: 88, "KIM MINH": 95, "VẠN LỘC": 90, SAKI: 86, HDC: 90, MATEC: 130 }, buyPrice: 80000, lossPct: 5 },
  { code: "DECK", name: "Mâm giàn", unit: "cái", category: "Bao che", mode: "RENT", weight: 11.7, suppliers: { TMN: 302, "KIM MINH": 400, "VẠN LỘC": 300, SAKI: 279, HDC: 325 }, buyPrice: 490000, lossPct: 1 },
  { code: "SDECK", name: "Mâm thang", unit: "cái", category: "Bao che", mode: "RENT", weight: 20.76, suppliers: { TMN: 596, "KIM MINH": 720, "VẠN LỘC": 650, SAKI: 572, HDC: 620 }, buyPrice: 730000, lossPct: 1 },
  { code: "JB34", name: "Chân kích D34", unit: "cái", category: "Bao che", mode: "RENT", weight: 2.38, suppliers: { "KIM MINH": 95, "VẠN LỘC": 80, BUILDKEY: 73, HDC: 99 }, buyPrice: 65000, lossPct: 3 },
  { code: "B100_1000", name: "Hộp 50x100 (kê chân giàn)", unit: "m", category: "Bao che", mode: "RENT", weight: 4.56, suppliers: { TMN: 142, "KIM MINH": 160, "VẠN LỘC": 142, BUILDKEY: 130, HDC: 140 }, buyPrice: 170000, lossPct: 2 },
  { code: "NEO3", name: "Bộ neo dầm I - 3,0m", unit: "bộ", category: "Bao che", mode: "BUY", price: 330000 },
  { code: "NEO17", name: "Bộ neo dầm I - 1,7m", unit: "bộ", category: "Bao che", mode: "BUY", price: 165000 },
  { code: "NET_GREEN", name: "Lưới xanh bao che", unit: "m2", category: "Bao che", mode: "BUY", price: 5500 },
  { code: "NET_SAFE", name: "Lưới an toàn 30x30", unit: "m2", category: "Bao che", mode: "BUY", price: 11000 },
  { code: "CABLE12", name: "Cáp neo dầm I D12", unit: "m", category: "Bao che", mode: "BUY", price: 11000 },
  { code: "CCLAMP", name: "Ốc siết cáp D12", unit: "con", category: "Bao che", mode: "BUY", price: 5500 },
  { code: "TURNB", name: "Tăng đơ cáp D14", unit: "cái", category: "Bao che", mode: "BUY", price: 22000 },
  // ---- An toàn (lan can, cửa chắn, thiết bị khác) ----
  { code: "TUBE3", name: "Tuýp tròn D49 L=3m", unit: "cây", category: "An toàn", mode: "RENT", weight: 6.82, suppliers: { TMN: 211, "KIM MINH": 285, "VẠN LỘC": 249, SAKI: 167, HDC: 255 } },
  { code: "HOIST_DOOR", name: "Cửa an toàn hoist", unit: "bộ", category: "An toàn", mode: "RENT", suppliers: { TMN: 500 } },
  { code: "LIFT_DOOR", name: "Cửa chắn thang máy 1,0 x (0,8 - 1,3m)", unit: "bộ", category: "An toàn", mode: "RENT", suppliers: { TMN: 200 } },
  { code: "SKIP", name: "Xuồng tiếp liệu cẩu tháp", unit: "cái", category: "An toàn", mode: "RENT", suppliers: { TMN: 18000 } },
  { code: "A_SUPPORT", name: "Gối kê sắt chữ A", unit: "cái", category: "An toàn", mode: "RENT", suppliers: { TMN: 2795 } },
  { code: "RAIL_POST", name: "Trụ lan can Ø49 cao 1,1m", unit: "trụ", category: "An toàn", mode: "BUY", price: 66000 },
  { code: "RAIL_NET", name: "Lưới lan can", unit: "m2", category: "An toàn", mode: "BUY", price: 60000 },
  { code: "LIFT_NET", name: "Lưới cửa chắn thang máy", unit: "bộ", category: "An toàn", mode: "BUY", price: 12000 },
  { code: "DEBRIS", name: "Khung vỹ lưới chắn vật rơi", unit: "bộ", category: "An toàn", mode: "BUY", price: 500000 },
  { code: "HOPPER", name: "Phễu đổ bê tông 1m3", unit: "cái", category: "An toàn", mode: "BUY", price: 12400000 },
  { code: "CABLE4", name: "Cáp tứ", unit: "sợi", category: "An toàn", mode: "BUY", price: 1700000 },
  { code: "CABLE_FLAT", name: "Cáp bẹ", unit: "sợi", category: "An toàn", mode: "BUY", price: 520000 },
  { code: "CABLE8", name: "Cáp thép 8m", unit: "sợi", category: "An toàn", mode: "BUY", price: 640000 },
  { code: "SHACKLE5", name: "Ma ní 5 tấn", unit: "cái", category: "An toàn", mode: "BUY", price: 50000 },
  { code: "SHACKLE3", name: "Ma ní 3 tấn", unit: "cái", category: "An toàn", mode: "BUY", price: 40000 },
  { code: "RADIO", name: "Bộ đàm", unit: "cái", category: "An toàn", mode: "BUY", price: 1200000 },
  { code: "SHORING_CLAMP", name: "Bát kẹp shoring lan can ra cẩu tháp", unit: "cái", category: "An toàn", mode: "BUY", price: 88000 },
  { code: "STEEL_REST", name: "Gối kê thép bãi gia công", unit: "cái", category: "An toàn", mode: "BUY", price: 6875000 },
  { code: "A_RAIL", name: "Lan can chữ A cho hầm", unit: "cái", category: "An toàn", mode: "BUY", price: 110000 },
  { code: "LED", name: "Bộ đèn LED cẩu tháp", unit: "bộ", category: "An toàn", mode: "BUY", price: 30000000 },
  // sàn tiếp liệu: thuê 2.100.000 đ/tháng (file mẫu, sheet 03) = 70.000 đ/ngày
  { code: "LOAD_PLATFORM", name: "Sàn tiếp liệu", unit: "bộ", category: "An toàn", mode: "RENT", suppliers: { TMN: 70000 } },
];

// Giá dùng = giá cao nhất các NCC (như file mẫu); không có giá NCC thì giữ giá nhập tay
export function maxSupplierPrice(suppliers: Record<string, number>): number | null {
  const v = Object.values(suppliers).filter((x) => Number.isFinite(x) && x > 0);
  return v.length ? Math.max(...v) : null;
}
