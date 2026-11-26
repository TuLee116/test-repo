// Công thức tính giá dựa theo "1. Dinh Muc" và mẫu DT-CP (PhanMem_DuToan_XayDung.xlsm):
// thành tiền hao phí = định mức hao phí (quantity) x đơn giá gốc (resource) x (1 + hao hụt)
// đơn giá 1 đơn vị công tác = tổng thành tiền các dòng hao phí, tách theo VT/TB/NC

export type WorkItemUnitCost = { vl: number; nc: number; m: number; total: number };

type WorkItemResourceLike = {
  category: "VT" | "TB" | "NC";
  quantity: number;
  wastageRate: number;
  resource: { unitPrice: number };
};

export function computeWorkItemUnitCost(
  lines: WorkItemResourceLike[],
  fixed?: { fixedVT?: number | null; fixedTB?: number | null; fixedNC?: number | null }
): WorkItemUnitCost {
  if (lines.length === 0 && fixed) {
    const vl = fixed.fixedVT ?? 0;
    const m = fixed.fixedTB ?? 0;
    const nc = fixed.fixedNC ?? 0;
    return { vl, nc, m, total: vl + nc + m };
  }
  let vl = 0;
  let nc = 0;
  let m = 0;
  for (const l of lines) {
    const amount = l.quantity * l.resource.unitPrice * (1 + (l.wastageRate || 0));
    if (l.category === "VT") vl += amount;
    else if (l.category === "TB") m += amount;
    else nc += amount;
  }
  return { vl, nc, m, total: vl + nc + m };
}

export type DtCpBreakdown = {
  vl: number;
  nc: number;
  m: number;
  subcontractor: number;
  otherCosts: number;
  T: number; // Trực tiếp phí
  C: number; // Chi phí chung
  TL: number; // Thu nhập chịu thuế tính trước
  G: number; // Giá trị dự toán trước thuế
  vat: number;
  total: number; // Giá trị dự toán sau thuế
};

export type ResourceUsageRow = {
  resourceId: string;
  code: string;
  name: string;
  unit: string;
  category: "VT" | "TB" | "NC";
  unitPrice: number;
  totalQuantity: number;
  totalAmount: number;
};

type ResourceLineWithInfo = {
  category: "VT" | "TB" | "NC";
  quantity: number;
  wastageRate: number;
  resource: { id: string; code: string; name: string; unit: string; unitPrice: number };
};

type BoqItemForUsage = {
  quantity: number;
  workItem: { resources: ResourceLineWithInfo[] } | null;
};

// Tổng hợp khối lượng + thành tiền theo từng tài nguyên (vật tư/nhân công/thiết bị), dùng cho
// các sheet "Tổng hợp Vật Tư/Nhân Công/Thiết Bị" khi xuất Excel - giống TH VAT TU/NHAN CONG/MAY.
export function aggregateResourceUsage(boqItems: BoqItemForUsage[]): ResourceUsageRow[] {
  const map = new Map<string, ResourceUsageRow>();
  for (const b of boqItems) {
    if (!b.workItem) continue;
    for (const l of b.workItem.resources) {
      const key = `${l.resource.id}:${l.category}`;
      const qty = l.quantity * b.quantity;
      const amount = qty * l.resource.unitPrice * (1 + (l.wastageRate || 0));
      const existing = map.get(key);
      if (existing) {
        existing.totalQuantity += qty;
        existing.totalAmount += amount;
      } else {
        map.set(key, {
          resourceId: l.resource.id,
          code: l.resource.code,
          name: l.resource.name,
          unit: l.resource.unit,
          category: l.category,
          unitPrice: l.resource.unitPrice,
          totalQuantity: qty,
          totalAmount: amount,
        });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.totalAmount - a.totalAmount);
}

// Dg0 = tỷ lệ chênh lệch giữa Giá Báo CĐT và Đơn giá Trực tiếp phí, theo đúng cách tính suy ra từ
// file mẫu Ánh Dương: Dg0 = (Giá Báo CĐT - Đơn giá TT phí) / Đơn giá TT phí.
export function computeDg0(directUnitPrice: number, quotedUnitPrice: number | null | undefined): number | null {
  if (quotedUnitPrice == null || directUnitPrice === 0) return null;
  return (quotedUnitPrice - directUnitPrice) / directUnitPrice;
}

export function computeDtCp(
  vl: number,
  nc: number,
  m: number,
  subcontractor: number,
  otherCosts: number,
  rates: { overheadRate: number; taxableProfitRate: number; vatRate: number }
): DtCpBreakdown {
  const T = vl + nc + m + subcontractor + otherCosts;
  const C = T * rates.overheadRate;
  const TL = (T + C) * rates.taxableProfitRate;
  const G = T + C + TL;
  const vat = G * rates.vatRate;
  const total = G + vat;
  return { vl, nc, m, subcontractor, otherCosts, T, C, TL, G, vat, total };
}

// Đơn giá Trực tiếp phí của 1 công tác BOQ (cột "Trực Tiếp Phí" ở tab BOQ), khớp với sheet CHI TIẾT:
// - Công tác giao thầu phụ: = đơn giá thầu phụ nhập ở sheet TH Thầu Phụ
// - Công tác chiết tính: VT + NC + M, cộng Nhân công khác, Thiết bị theo % nhân công và MMTB + Vật tư phụ (theo tỷ lệ chung)
// Đơn giá thầu phụ theo từng dòng BOQ: công tác "Thầu phụ" trọn gói = đơn giá của phần giao; công tác chiết tính có giao 1 phần
// = tổng giá trị các phần giao chia khối lượng BOQ (đơn giá bình quân phần thầu phụ).
export function subUnitPriceByBoq(
  boqItems: { id: string; method: string; quantity: number }[],
  subs: { boqItemId: string | null; unitPrice: number; amount: number }[]
): Map<string, number> {
  const by = new Map<string, typeof subs>();
  for (const s of subs) if (s.boqItemId) by.set(s.boqItemId, [...(by.get(s.boqItemId) ?? []), s]);
  const out = new Map<string, number>();
  for (const b of boqItems) {
    const mine = by.get(b.id);
    if (!mine?.length) continue;
    if (b.method === "SUB") out.set(b.id, mine[0].unitPrice);
    else if (b.quantity > 0) out.set(b.id, mine.reduce((s, x) => s + x.amount, 0) / b.quantity);
  }
  return out;
}

export function boqDirectUnitPrice(
  b: { method: string; workItem: { resources: WorkItemResourceLike[]; fixedVT?: number | null; fixedTB?: number | null; fixedNC?: number | null } | null },
  rates: { ncKhacRate: number; tbRate: number; mmtbRate: number },
  subUnitPrice: number
): number {
  if (b.method === "SUB") return subUnitPrice;
  const unit = b.workItem ? computeWorkItemUnitCost(b.workItem.resources, b.workItem) : computeWorkItemUnitCost([]);
  const base = unit.total + unit.nc * (rates.ncKhacRate + rates.tbRate);
  // subUnitPrice của công tác chiết tính = giá trị các phần giao thầu phụ chia cho khối lượng BOQ (0 nếu không giao phần nào)
  return base + base * rates.mmtbRate + subUnitPrice;
}
