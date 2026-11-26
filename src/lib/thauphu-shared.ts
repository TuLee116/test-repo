// Kiểu dữ liệu sheet TH Thầu Phụ - dùng được cả server lẫn client (không import prisma).
// thành tiền sau VAT của 1 dòng thầu phụ (amount = trước VAT)
export const subAmountVat = (s: { amount: number; vatRate: number }) => s.amount * (1 + (s.vatRate || 0));

export type SubItemRow = {
  type: "item";
  id: string; // id SubcontractorItem
  depth: number;
  stt: string;
  name: string;
  unit: string;
  qty: number;
  unitPriceFormula?: string;
  unitPriceErr?: string;
  qtyFormula?: string;
  qtyErr?: string;
  unitPrice: number;
  quotedPct?: number | null; // đơn giá đang tạm tính = quotedPct% × giá báo CĐT
  amount: number; // thành tiền TRƯỚC VAT = SL × đơn giá (+ phí quản lý VT/TB nếu có)
  mgmtFee?: number; // chi phí quản lý vật tư / thiết bị TMN cấp đã cộng trong amount
  prelimPct: number; // % Prelim (5 = 5%): đã cộng trong amount
  vatRate: number; // thuế suất VAT (0.08 = 8%)
  amountVat: number; // thành tiền SAU VAT - DT-CP lấy giá trị này
  contractorName: string;
  note: string;
  qtyEditable?: boolean; // phần giao thầu phụ 1 phần khối lượng của công tác chiết tính: SL của phần nhập tay
  scope?: string; // phạm vi thầu phụ bao (VD "bao Vật tư + Nhân công")
  linked: boolean; // true = công tác chuyển từ CHI TIẾT (tên/ĐVT/SL theo BOQ)
};
export type SubHeadingRow = {
  type: "heading";
  id: string;
  depth: number;
  stt: string;
  text: string;
  total: number;
  totalVat: number; // tổng sau VAT
  itemIds: string[]; // các dòng thầu phụ nằm dưới đầu mục này
};
export type SubGroup = { id: string; name: string; total: number; totalVat: number; itemIds: string[]; items: SubItemRow[]; showInDtcp: boolean };

// Tổng hợp theo tên thầu phụ (chỉ tính công tác link từ BOQ/CHI TIẾT) - dùng để bật/tắt hiện riêng
// từng nhà thầu phụ bên sheet DT-CP dưới "Thầu phụ theo CHI TIẾT".
// total: sau VAT (đúng số bên DT-CP); mgmt*: chi phí quản lý vật tư / thiết bị TMN cấp cho nhà thầu này (trước VAT)
export type ContractorGroup = { name: string; total: number; showInDtcp: boolean; mgmtVtPct: number; mgmtTbPct: number; mgmtFee: number; vtBase: number; tbBase: number };

export type SubSheet = {
  boqRows: (SubHeadingRow | SubItemRow)[]; // phần theo bố cục BOQ (đầu mục lớn/nhỏ + công tác)
  looseItems: SubItemRow[]; // dòng bổ sung chưa thuộc đầu mục nào
  groups: SubGroup[]; // đầu mục lớn tự thêm
  contractorGroups: ContractorGroup[]; // tổng hợp theo tên thầu phụ (phần theo CHI TIẾT)
  total: number; // trước VAT
  totalVat: number; // sau VAT
};
