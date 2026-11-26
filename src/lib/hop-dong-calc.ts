// Phần dùng chung (client + server) của "Hợp đồng (DT-CP)" trong Đệ trình giá đội:
// khoá dòng, đơn giá theo THỜI ĐIỂM, khớp tên dòng đề xuất với dòng TH Nhân Công.

export type CostKind = "NC" | "TP" | "VT" | "TB";
export const COST_KINDS: { value: CostKind; label: string }[] = [
  { value: "NC", label: "Nhân Công" },
  { value: "TP", label: "Thầu Phụ" },
  { value: "VT", label: "Vật Tư" },
  { value: "TB", label: "Thiết Bị" },
];
export type Version = { n: number; label: string; approved: boolean };

export const normText = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/^nhan cong\s*[:\-]?\s*/, "") // "Nhân công : Ván khuôn..." ≈ "Ván khuôn..."
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export const lineKeyOf = (name: string, unit: string) => `${normText(name)}|${normText(unit)}`;

// Đơn giá tại thời điểm v: đúng cột TĐv, không có thì cột gần nhất trước đó, sheet chỉ 1 cột đơn giá thì cột "0"
export function priceAt(prices: Record<string, number>, v: number): number | null {
  const ks = Object.keys(prices)
    .map(Number)
    .filter((k) => Number.isFinite(prices[String(k)]))
    .sort((a, b) => a - b);
  if (!ks.length) return null;
  const le = ks.filter((k) => k <= v);
  return prices[String(le.length ? le[le.length - 1] : ks[0])] ?? null;
}
export const latestPrice = (prices: Record<string, number>) => priceAt(prices, Number.MAX_SAFE_INTEGER);
export const parsePrices = (s: string): Record<string, number> => {
  try {
    return JSON.parse(s) as Record<string, number>;
  } catch {
    return {};
  }
};

// Độ giống tên (0..1): tỉ lệ từ chung — dùng gợi ý khớp khi tên không trùng hẳn
export function similarity(a: string, b: string): number {
  const A = new Set(normText(a).split(" ").filter((w) => w.length > 1));
  const B = new Set(normText(b).split(" ").filter((w) => w.length > 1));
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return (2 * common) / (A.size + B.size);
}

// Dòng DT-CP rút gọn gửi xuống màn hình hồ sơ (để hiện đơn giá DT-CP, giá đã duyệt, lũy kế)
export type DtcpRef = {
  key: string;
  name: string;
  unit: string;
  qty: number | null;
  price: number | null; // đơn giá thời điểm "Đã duyệt"
  latest: number | null; // đơn giá thời điểm mới nhất
  approved: { crew: string; price: number; date: string; code: string }[]; // giá đã duyệt hiện hành theo từng đội
  prevQty: number; // lũy kế KL đã trình ở các hồ sơ khác (đang chờ / đã duyệt)
};

// Dòng PHÁT SINH bổ sung vào DT-CP từ sổ giá (công việc đã duyệt giá nhưng DT-CP gốc không có)
export const PS_GROUP_NAME = "PHÁT SINH – BỔ SUNG TỪ SỔ GIÁ";
export const PS_GROUP_KEY = "#ps";

// Điểm gợi ý khớp (0..1) giữa tên công việc trong hồ sơ đề xuất (thường dài, ghi cụ thể vị trí) và tên dòng DT-CP
// (ngắn, ghi chung): coi trọng việc các từ của dòng DT-CP có mặt trong tên đề xuất ("cán nền", "xây tường"...),
// bỏ các từ chung chung (thi công, công tác, tầng, tháp...). Khác ĐVT chỉ trừ điểm, không loại (file cũ hay trống ĐVT).
const STOP = new Set(["thi", "cong", "tac", "va", "cac", "cua", "cho", "theo", "tang", "thap", "khu", "vuc", "hang", "muc", "phan", "toan", "bo", "so", "lan", "dot", "tai", "tu", "den", "bang", "loai", "du", "an", "nhung", "mot", "vi", "tri", "nha", "block", "toa"]);
const toks = (s: string) => normText(s).split(" ").filter((w) => w.length > 1 && !STOP.has(w));
const bigrams = (ws: string[]) => new Set(ws.slice(1).map((w, i) => `${ws[i]} ${w}`));
export function suggestScore(src: string, srcUnit: string, dt: string, dtUnit: string): number {
  const A = toks(src);
  const B = toks(dt);
  if (!A.length || !B.length) return 0;
  const SA = new Set(A);
  const SB = new Set(B);
  let common = 0;
  for (const w of SB) if (SA.has(w)) common++;
  const cov = common / SB.size;
  const dice = (2 * common) / (SA.size + SB.size);
  const bA = bigrams(A);
  const bB = bigrams(B);
  let bc = 0;
  for (const g of bB) if (bA.has(g)) bc++;
  const covB = bB.size ? bc / bB.size : cov;
  let s = 0.45 * cov + 0.25 * covB + 0.3 * dice;
  const u1 = normText(srcUnit);
  const u2 = normText(dtUnit);
  if (u1 && u2) s += u1 === u2 ? 0.1 : -0.1;
  return Math.max(0, Math.min(1, s));
}
