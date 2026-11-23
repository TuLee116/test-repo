const nf0 = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });

export const money = (v: number | null | undefined) => (v == null ? "" : nf0.format(v));
export const qty = (v: number | null | undefined) => (v == null ? "" : nf2.format(v));

/** 739.468.748.695 -> "739,47 tỷ" */
export function short(v: number | null | undefined) {
  if (v == null) return "";
  const a = Math.abs(v);
  if (a >= 1e9) return `${nf2.format(v / 1e9)} tỷ`;
  if (a >= 1e6) return `${nf2.format(v / 1e6)} tr`;
  return nf0.format(v);
}

export const pct = (part: number, whole: number) => (whole ? `${nf2.format((part / whole) * 100)}%` : "0%");

export const STATUS: Record<string, { label: string; tone: string }> = {
  APPROVED: { label: "Đã duyệt", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  SUBMITTED: { label: "Đã trình", tone: "bg-amber-50 text-amber-700 ring-amber-200" },
  DRAFT: { label: "Nháp", tone: "bg-slate-100 text-slate-600 ring-slate-200" },
  REJECTED: { label: "Trả lại", tone: "bg-rose-50 text-rose-700 ring-rose-200" },
  TPOK: { label: "Trưởng phòng đã duyệt", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
};

export const KIND: Record<string, string> = {
  IN: "Đơn giá đội trình duyệt (trong HĐ)",
  OUT: "Đề xuất đơn giá ngoài HĐ, phụ lục",
};

export const CATEGORY: Record<string, string> = { KC: "Kết cấu", HT: "Hoàn thiện", MEP: "MEP", NT: "Nội thất" };
export const PACKAGE_TYPE: Record<string, string> = { THO: "Kết cấu (Phần thô)", HT: "Hoàn Thiện", MEP: "MEP", NT: "Nội Thất" };
