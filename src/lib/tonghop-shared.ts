// Phần dùng chung được cho cả client component (không import prisma).
export type SheetKind = "VT" | "NC" | "TB";

// TH Thiết Bị (giống thầu phụ): đơn giá nhập TRƯỚC VAT, VAT % cộng thêm → thành tiền sau VAT đi vào DT-CP.
// TH Vật Tư thì ngược lại: nhập giá SAU VAT, phần mềm tự quy về trước VAT (DT-CP dùng giá trước VAT).
export const vatOnTop = (kind: SheetKind) => kind === "TB";

export const SHEET_CFG: Record<SheetKind, { title: string; A: string; B: string; defaultSection: "A" | "B"; category: "VT" | "NC" | "TB" }> = {
  VT: { title: "TH Vật Tư", A: "Vật tư chính mua từ Hợp Nhân", B: "Vật tư chính mua từ đối tác khác", defaultSection: "B", category: "VT" },
  NC: { title: "TH Nhân Công", A: "Nhân Công Giao Khoán", B: "Nhân Công Khác", defaultSection: "A", category: "NC" },
  TB: { title: "TH Thiết Bị", A: "Thiết Bị Thi Công", B: "Thiết Bị Khác", defaultSection: "A", category: "TB" },
};

export type SheetRow = {
  resourceId: string; // với dòng tự thêm (manual) là id của SheetManualItem
  manual: boolean;
  code: string;
  name: string;
  unit: string;
  qty: number;
  days?: number | null; // dòng tự thêm có thời gian thuê (ngày): thành tiền = SL × đơn giá × số ngày
  amount: number;
  amountVat: number; // thành tiền sau VAT (TH Thiết Bị); các sheet khác = amount
  // TH Nhân Công: % quản lý của đội thi công - thành tiền = KL × đơn giá × (1 + %), đã gồm trong amount
  mgmtPct?: number;
  priceFormula?: string; // công thức đơn giá (LINK tới BOQ), "" = không có
  priceErr?: string;
  qtyFormula?: string; // công thức số lượng (chỉ dòng tự thêm)
  qtyErr?: string;
  priceAfterVat: number; // với NC / dòng tự thêm: đơn giá
  vatPercent: number;
  wastagePercent: number | null;
  note: string;
  section: "A" | "B";
  groupId: string | null;
  laborByWork?: boolean; // nhân công đặt tên theo công việc BOQ (riêng của dự án) - sửa tên được
  usedBy?: string; // STT các dòng BOQ đang dùng (nhân công theo công việc)
};
export type SheetGroup = { id: string; section: "A" | "B"; name: string; showInDtcp: boolean };

