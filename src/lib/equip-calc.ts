// Tính toán thiết bị thi công (dùng chung client: xem trước, server: ghi vào TH Thiết Bị).
// Bám theo file khái toán thiết bị mẫu (HILL SIDE HH 4.4):
//  - Chống sàn: số lượng tự tính từ diện tích sàn, chiều cao tầng và định mức (định mức mặc định suy ra từ số liệu
//    3 tầng B2 / B1 / T1 của file mẫu); tiền thuê = SL × đơn giá / ngày × số ngày thuê của từng tầng.
//  - Bao che: giàn khung treo dầm I theo từng đợt giáo (chu vi, chiều cao đợt, số lối đi) - công thức như sheet "02. Bao che".
//  - An toàn: lan can biên, lan can thang bộ, cửa hoist, cửa chắn thang máy theo từng khối + thiết bị khác - như sheet "05. AT-TH".
// Mỗi bản tính ra các dòng: thuê thiết bị, vật tư mua, nhân công, vận chuyển (theo kg), hao hụt (giá mua × % × hệ số).

export type EquipKind = "SHORING" | "FACADE" | "SAFETY";

export const EQUIP_KINDS: { kind: EquipKind; title: string; group: string; desc: string }[] = [
  { kind: "SHORING", title: "Thiết bị chống sàn", group: "THIẾT BỊ CHỐNG SÀN", desc: "Giáo Ringlock, kích, giằng, xà gồ hộp, ván… tự tính theo diện tích sàn và chiều cao từng tầng" },
  { kind: "FACADE", title: "Giàn giáo bao che", group: "THIẾT BỊ BAO CHE", desc: "Giàn khung treo dầm I theo từng đợt giáo: khung, chéo, mâm, tuýp, neo, lưới, nhân công" },
  { kind: "SAFETY", title: "Thiết bị an toàn & lan can", group: "THIẾT BỊ AN TOÀN", desc: "Lan can biên, lan can thang bộ, cửa hoist, cửa chắn thang máy, phễu, xuồng, cáp…" },
];

export type PriceItem = { code: string; name: string; unit: string; mode: string; weight: number; price: number; buyPrice: number; lossPct: number };

export type CalcLine = {
  type: "rent" | "buy" | "labor" | "transport" | "loss";
  code?: string;
  equip?: boolean; // thiết bị (chọn được thuê / mua)
  mode?: "RENT" | "BUY";
  days?: number; // số ngày thuê (dòng thuê)
  rate?: number; // đơn giá người dùng thấy: đ/ngày (thuê) hoặc đ/đơn vị (mua, nhân công)
  paramKey?: string; // dòng nhân công: thông số đơn giá tương ứng
  name: string;
  unit: string;
  qty: number;
  unitPrice: number;
  amount: number;
  note: string;
};
export type CalcDetail = { code: string; name: string; unit: string; per: number[]; total: number };
export type CalcResult = { cols: string[]; detail: CalcDetail[]; lines: CalcLine[]; total: number; warnings: string[] };

// ---------- thông số ----------
export type ShoringFloor = { name: string; area: number; height: number; start: string; end: string; days: number };
export type ShoringParams = {
  floors: ShoringFloor[];
  density: number; // điểm chống (cây đứng) / m2 sàn
  offset: number; // m: chiều cao tầng trừ đi (sàn + ván + xà gồ + phần kích) = chiều dài cây chống cần
  jackRange: number; // m: phần kích bù chiều cao
  ledgerStep: number; // m: bước tầng giằng ngang
  hor1200: number; // thanh / điểm chống / tầng giằng
  hor600: number;
  obl1200: number;
  obl600: number;
  tubeRate: number; // m tuýp giằng / m2 sàn / m chiều cao
  clampPerTube: number; // cùm / m tuýp
  tieRate: number; // m ty ren / m2
  bowlRate: number; // bát chuồn / m2
  beamMain: number; // m xà gồ chính 50x100 / m2
  beamSec: number; // m xà gồ phụ 50x50 / m2
  mainSplit: [number, number, number]; // tỷ lệ % theo chiều dài 4m / 3m / 2m
  secSplit: [number, number, number];
  plyRatio: number; // m2 ván / m2 sàn
  plyReuse: number; // số tầng dùng chung 1 bộ ván
  reserve: number; // hệ số dự phòng số lượng
  extraDays: number;
  transportPerKg: number;
  trips: number;
  lossFactor: number; // hệ số giá trị còn lại khi tính hao hụt
};
export type FacadeLift = { name: string; perimeter: number; height: number; stairs: number; beams3: number; hung: boolean; start: string; end: string; days: number };
export type FacadeParams = {
  lifts: FacadeLift[];
  bayW: number; // m: bước khung theo phương ngang
  frameH: number; // m: chiều cao 1 tầm khung
  extraDays: number; // ngày cộng thêm (lắp / tháo)
  rentFactor: number; // hệ số dự phòng thiết bị thuê
  buyFactor: number; // hệ số dự phòng vật tư mua
  braceRatio: number; // cặp chéo / khung
  vSpacingLow: number; // m: khoảng cách tuýp đứng khi cao độ ≤ 60m
  vSpacingHigh: number; // khi cao độ > 60m
  hSpacing: number; // m: khoảng cách tuýp ngang theo chiều cao
  cablePerBeam: number; // m cáp neo / dầm I
  framesPerBeam: number; // 1 hệ dầm I đỡ tối đa N tầm giàn (cao hơn phải thêm hệ dầm I)
  netLayerEvery: number; // lưới an toàn phân tầng: 1 lớp mỗi N tầm khung
  netLayerWidth: number; // m bề rộng lưới phân tầng
  catchNetWidth: number; // m bề rộng lưới hứng trên dầm I (theo chiều dài dầm console)
  topNetPerM: number; // m2 lưới an toàn tháo cốp pha / m chu vi
  laborDeck: number; // nhân công lắp dựng mâm hứng trên dầm I / mâm
  laborCatchNet: number; // nhân công lắp dựng lưới hứng trên dầm I / m2
  laborFrame: number; // nhân công lắp dựng, tháo dỡ giàn / m2 (chu vi × chiều cao)
  laborStair: number; // nhân công cầu thang / mâm thang
  laborBeam: number; // nhân công lắp dựng, tháo dỡ dầm I / cây
  laborNet: number; // nhân công căng lưới / m2
  transportPerKg: number;
  frameTransportPerKg: number; // đơn giá vận chuyển giàn khung (cồng kềnh)
  trips: number;
  lossFactor: number;
};
export type SafetyBlock = { name: string; perimeter: number; floors: number; stairs: number; hoists: number; lifts: number; edgeRail: boolean };
export type SafetyParams = {
  blocks: SafetyBlock[];
  days: number; // số ngày thuê thiết bị an toàn
  others: { code: string; qty: number }[]; // thiết bị khác nhập trực tiếp số lượng
  postSpacing: number; // m / trụ lan can
  laborEdge: number; // NC lắp dựng, tháo dỡ lan can biên / m
  laborStairRail: number; // NC lắp dựng, tháo dỡ lan can thang bộ / m
  laborHoistDoor: number; // NC lắp đặt, tháo dỡ cửa an toàn hoist / bộ
  laborLiftDoor: number; // NC lắp đặt, tháo dỡ cửa chắn thang máy / bộ
  // sàn tiếp liệu (như sheet 03 file mẫu): thuê theo thời gian lắp → tháo, chi phí tổ hợp / nâng sàn / tháo dỡ, vận chuyển theo chuyến
  platforms: { count: number; raises: number; start: string; end: string; days: number };
  laborPlatformAssemble: number; // đ / bộ
  laborPlatformRaise: number; // đ / lần nâng / bộ
  laborPlatformDismantle: number; // đ / bộ
  platformTripPrice: number; // đ / chuyến (1 lượt)
  platformsPerTrip: number; // số bộ / 1 chuyến xe
  transportPerKg: number;
  trips: number;
};
// mọi loại bản tính đều có thêm: chọn thuê / mua từng thiết bị + đơn giá tự nhập (xem Choice)
// daysOverrides: số ngày thuê người dùng sửa cho từng dòng (khoá = tên dòng; sửa ở bảng kết quả hoặc ngay sheet TH Thiết Bị)
export type ChoiceParams = { modeOverrides?: Record<string, "RENT" | "BUY">; priceOverrides?: Record<string, number>; daysOverrides?: Record<string, number> };
export type EquipParams = (ShoringParams | FacadeParams | SafetyParams) & ChoiceParams;

const today = () => new Date().toISOString().slice(0, 10);

export function defaultParams(kind: EquipKind): EquipParams {
  if (kind === "SHORING")
    return {
      floors: [{ name: "Tầng 1", area: 1000, height: 3.6, start: today(), end: "", days: 30 }],
      density: 1.27,
      offset: 1.0,
      jackRange: 0.4,
      ledgerStep: 1.4,
      hor1200: 1.19,
      hor600: 0.48,
      obl1200: 0.37,
      obl600: 0.12,
      tubeRate: 0.2,
      clampPerTube: 0.58,
      tieRate: 0.2,
      bowlRate: 0.27,
      beamMain: 1.28,
      beamSec: 3.9,
      mainSplit: [33, 22, 45],
      secSplit: [60, 25, 15],
      plyRatio: 1.09,
      plyReuse: 1,
      reserve: 1.1,
      extraDays: 0,
      transportPerKg: 500,
      trips: 2,
      lossFactor: 0.8,
    } satisfies ShoringParams;
  if (kind === "FACADE")
    return {
      lifts: [{ name: "Đợt 1", perimeter: 200, height: 20, stairs: 2, beams3: 16, hung: true, start: today(), end: "", days: 180 }],
      bayW: 1.6,
      frameH: 1.7,
      extraDays: 45,
      rentFactor: 1.025,
      buyFactor: 1.05,
      braceRatio: 1.8,
      vSpacingLow: 6.4,
      vSpacingHigh: 4.8,
      hSpacing: 5.1,
      cablePerBeam: 10.1,
      framesPerBeam: 12,
      netLayerEvery: 3,
      netLayerWidth: 2,
      catchNetWidth: 1.7,
      topNetPerM: 14,
      laborDeck: 35000,
      laborCatchNet: 10000,
      laborFrame: 35000,
      laborStair: 360000,
      laborBeam: 320000,
      laborNet: 10000,
      transportPerKg: 1000,
      frameTransportPerKg: 3000,
      trips: 2,
      lossFactor: 0.85,
    } satisfies FacadeParams;
  return {
    blocks: [{ name: "Khối đế", perimeter: 180, floors: 3, stairs: 2, hoists: 1, lifts: 7, edgeRail: true }],
    days: 300,
    others: [
      { code: "HOPPER", qty: 2 },
      { code: "SKIP", qty: 2 },
      { code: "DEBRIS", qty: 14 },
      { code: "CABLE4", qty: 8 },
      { code: "CABLE_FLAT", qty: 6 },
      { code: "CABLE8", qty: 6 },
      { code: "SHACKLE5", qty: 6 },
      { code: "SHACKLE3", qty: 12 },
      { code: "RADIO", qty: 4 },
      { code: "SHORING_CLAMP", qty: 30 },
      { code: "STEEL_REST", qty: 8 },
      { code: "A_SUPPORT", qty: 36 },
      { code: "LED", qty: 1 },
    ],
    postSpacing: 3,
    laborEdge: 0,
    laborStairRail: 0,
    laborHoistDoor: 0,
    laborLiftDoor: 0,
    platforms: { count: 0, raises: 5, start: "", end: "", days: 112 },
    laborPlatformAssemble: 1500000,
    laborPlatformRaise: 1000000,
    laborPlatformDismantle: 1500000,
    platformTripPrice: 5000000,
    platformsPerTrip: 2,
    transportPerKg: 0,
    trips: 2,
  } satisfies SafetyParams;
}

// Các ô thông số / định mức hiện trong cửa sổ (sửa được cho từng bản tính)
export type ParamField = { key: string; label: string; unit?: string };
export const PARAM_FIELDS: Record<EquipKind, ParamField[]> = {
  SHORING: [
    { key: "density", label: "Mật độ cây chống", unit: "cây/m2" },
    { key: "offset", label: "Chiều cao trừ (sàn, ván, xà gồ, kích)", unit: "m" },
    { key: "jackRange", label: "Kích bù chiều cao tối đa", unit: "m" },
    { key: "ledgerStep", label: "Bước tầng giằng ngang", unit: "m" },
    { key: "hor1200", label: "Giằng ngang 1,2m / điểm / tầng giằng" },
    { key: "hor600", label: "Giằng ngang 0,6m / điểm / tầng giằng" },
    { key: "obl1200", label: "Giằng chéo 1,2m / điểm / tầng giằng" },
    { key: "obl600", label: "Giằng chéo 0,6m / điểm / tầng giằng" },
    { key: "tubeRate", label: "Tuýp giằng / m2 sàn / m cao", unit: "m" },
    { key: "clampPerTube", label: "Cùm / m tuýp" },
    { key: "tieRate", label: "Ty ren D16 / m2 sàn", unit: "m" },
    { key: "bowlRate", label: "Bát chuồn / m2 sàn" },
    { key: "beamMain", label: "Xà gồ chính 50x100 / m2 sàn", unit: "m" },
    { key: "beamSec", label: "Xà gồ phụ 50x50 / m2 sàn", unit: "m" },
    { key: "plyRatio", label: "Ván / m2 sàn", unit: "m2" },
    { key: "plyReuse", label: "Số tầng dùng chung 1 bộ ván" },
    { key: "reserve", label: "Hệ số dự phòng số lượng" },
    { key: "extraDays", label: "Cộng thêm ngày thuê", unit: "ngày" },
    { key: "trips", label: "Số lượt vận chuyển (đến + về)" },
    { key: "lossFactor", label: "Hệ số giá trị khi tính hao hụt" },
  ],
  FACADE: [
    { key: "bayW", label: "Bước khung phương ngang", unit: "m" },
    { key: "frameH", label: "Chiều cao 1 tầm khung", unit: "m" },
    { key: "extraDays", label: "Cộng thêm ngày thuê (lắp / tháo)", unit: "ngày" },
    { key: "rentFactor", label: "Hệ số dự phòng thiết bị thuê" },
    { key: "buyFactor", label: "Hệ số dự phòng vật tư mua" },
    { key: "braceRatio", label: "Cặp chéo / khung" },
    { key: "vSpacingLow", label: "Khoảng tuýp đứng (cao độ ≤ 60m)", unit: "m" },
    { key: "vSpacingHigh", label: "Khoảng tuýp đứng (cao độ > 60m)", unit: "m" },
    { key: "hSpacing", label: "Khoảng tuýp ngang theo chiều cao", unit: "m" },
    { key: "framesPerBeam", label: "1 hệ dầm I đỡ tối đa", unit: "tầm giàn" },
    { key: "cablePerBeam", label: "Cáp neo / dầm I", unit: "m" },
    { key: "netLayerEvery", label: "Lưới phân tầng: 1 lớp mỗi N tầm" },
    { key: "netLayerWidth", label: "Bề rộng lưới phân tầng", unit: "m" },
    { key: "catchNetWidth", label: "Bề rộng lưới hứng trên dầm I", unit: "m" },
    { key: "topNetPerM", label: "Lưới tháo cốp pha / m chu vi", unit: "m2" },
    { key: "trips", label: "Số lượt vận chuyển (đến + về)" },
    { key: "lossFactor", label: "Hệ số giá trị khi tính hao hụt" },
  ],
  SAFETY: [
    { key: "days", label: "Số ngày thuê thiết bị an toàn", unit: "ngày" },
    { key: "postSpacing", label: "Khoảng cách trụ lan can", unit: "m" },
    { key: "platformsPerTrip", label: "Sàn tiếp liệu: số bộ / 1 chuyến xe" },
    { key: "trips", label: "Số lượt vận chuyển (đến + về)" },
  ],
};

// ---------- tiện ích ----------
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
export function daysBetween(start: string, end: string): number | null {
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 86400000);
}
const fq = (n: number) => (Math.round(n * 100) / 100).toLocaleString("vi-VN");
const fm = (n: number) => Math.round(n).toLocaleString("vi-VN");

// Chọn tổ hợp cây chống (2,5 / 2 / 1,5 / 1m) có tổng chiều dài trong [cần - kích bù, cần]: ít cây nhất, rồi dài nhất
export function pickStandards(need: number, jackRange: number): number[] {
  let best: number[] | null = null;
  let bestSum = 0;
  const lo = need - jackRange;
  for (let a = 0; a <= 6; a++)
    for (let b = 0; a + b <= 6; b++)
      for (let c = 0; a + b + c <= 6; c++)
        for (let d = 0; a + b + c + d <= 6; d++) {
          const n = a + b + c + d;
          if (!n) continue;
          const sum = a * 2.5 + b * 2 + c * 1.5 + d;
          if (sum > need + 1e-9 || sum < lo - 1e-9) continue;
          if (!best || n < best.length || (n === best.length && sum > bestSum)) {
            best = [...Array(a).fill(2.5), ...Array(b).fill(2), ...Array(c).fill(1.5), ...Array(d).fill(1)];
            bestSum = sum;
          }
        }
  if (best) return best;
  // quá thấp: 1 cây ngắn nhất; quá cao (ngoài 6 cây): lấp bằng 2,5m
  if (need < 1) return [1];
  const out: number[] = [];
  let rest = need;
  while (rest > 2.5 + jackRange) {
    out.push(2.5);
    rest -= 2.5;
  }
  return [...out, ...pickStandards(rest, jackRange)];
}

// Bộ gom số lượng theo cấu kiện × cột (tầng / đợt / khối)
class Acc {
  map = new Map<string, number[]>();
  constructor(private n: number) {}
  add(code: string, col: number, qty: number) {
    if (!(qty > 0)) return;
    const arr = this.map.get(code) ?? Array(this.n).fill(0);
    arr[col] += qty;
    this.map.set(code, arr);
  }
}

function itemOf(prices: Map<string, PriceItem>, code: string): PriceItem {
  return prices.get(code) ?? { code, name: code, unit: "", mode: "RENT", weight: 0, price: 0, buyPrice: 0, lossPct: 0 };
}

// Lựa chọn riêng của bản tính: thuê / mua từng thiết bị, đơn giá người dùng tự nhập (khoá "RENT:code" = đ/ngày,
// "BUY:code" = đ/đơn vị) - không có thì lấy theo bảng đơn giá chung.
export type Choice = { modes: Record<string, "RENT" | "BUY">; prices: Record<string, number>; days: Record<string, number> };
export const priceKey = (mode: "RENT" | "BUY", code: string) => `${mode}:${code}`;

// Dòng chi tiết + dòng tiền thuê / mua cho các cấu kiện đã gom; daysOf(col) = số ngày thuê của cột.
// Thuê: mỗi nhóm cột có cùng số ngày thuê = 1 dòng (SL × đơn giá/ngày × số ngày). Mua thiết bị (luân chuyển giữa các
// tầng / đợt): SL = số lượng lớn nhất của 1 tầng / đợt. Vật tư tiêu hao: SL = tổng.
function rentAndBuy(acc: Acc, cols: string[], prices: Map<string, PriceItem>, daysOf: (col: number) => number, order: string[], ch: Choice, colLabel: string) {
  const detail: CalcDetail[] = [];
  const lines: CalcLine[] = [];
  const codes = [...acc.map.keys()].sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
  for (const code of codes) {
    const per = acc.map.get(code)!;
    const it = itemOf(prices, code);
    const total = per.reduce((s, x) => s + x, 0);
    detail.push({ code, name: it.name, unit: it.unit, per, total });
    // mọi cấu kiện đều chọn được thuê / mua; mặc định theo bảng giá (thiết bị → thuê, vật tư tiêu hao → mua)
    const reusable = it.mode === "RENT"; // thiết bị dùng luân chuyển được giữa các tầng / đợt
    const equip = true;
    const mode = ch.modes[code] ?? (reusable ? "RENT" : "BUY");
    if (mode === "BUY") {
      const qty = reusable && cols.length > 1 ? Math.max(...per) : total;
      const price = ch.prices[priceKey("BUY", code)] ?? (reusable ? it.buyPrice : it.price);
      const note = reusable ? (cols.length > 1 ? `Mua, luân chuyển giữa các ${colLabel} (SL lớn nhất 1 ${colLabel})` : "Mua") : "Vật tư mua mới";
      lines.push({ type: "buy", code, equip, mode, name: it.name, unit: it.unit, qty, rate: price, unitPrice: price, amount: qty * price, note });
      continue;
    }
    // vật tư mặc định mua mà chọn thuê: chưa có giá thuê trong bảng giá → người dùng tự nhập
    const rate = ch.prices[priceKey("RENT", code)] ?? (reusable ? it.price : 0);
    const groups = new Map<number, { qty: number; cols: string[] }>();
    per.forEach((q, i) => {
      if (!(q > 0)) return;
      const d = daysOf(i);
      const g = groups.get(d) ?? { qty: 0, cols: [] };
      g.qty += q;
      g.cols.push(cols[i]);
      groups.set(d, g);
    });
    for (const [calcDays, g] of groups) {
      const where = g.cols.length > 3 ? `${g.cols.length} ${colLabel}` : g.cols.join(", ");
      const name = groups.size > 1 ? `${it.name} (${where})` : it.name;
      const days = ch.days[name] ?? calcDays;
      lines.push({
        type: "rent",
        code,
        equip,
        mode,
        name,
        unit: it.unit,
        qty: g.qty,
        days,
        rate,
        unitPrice: rate * days,
        amount: g.qty * rate * days,
        note: `Thuê ${fm(rate)} đ/ngày × ${days} ngày${cols.length > 1 ? ` · ${g.cols.join(", ")}` : ""}`,
      });
    }
  }
  return { detail, lines };
}

// Dòng vận chuyển (theo kg × số lượt); đơn giá đ/kg người dùng nhập ngay trên dòng (paramKey). only: lọc cấu kiện
// (VD giàn khung bao che cồng kềnh tách dòng riêng với đơn giá riêng như file mẫu).
function transportLine(detail: CalcDetail[], prices: Map<string, PriceItem>, perKg: number, trips: number, label: string, paramKey: string, only: (code: string) => boolean = () => true): CalcLine | null {
  let kg = 0;
  for (const d of detail) {
    const it = itemOf(prices, d.code);
    if (it.mode !== "RENT" || !only(d.code)) continue;
    kg += d.total * it.weight;
  }
  if (!(kg > 0)) return null;
  const qty = kg * trips;
  return { type: "transport", code: "", name: `Vận chuyển ${label}`, unit: "kg", qty, rate: perKg, unitPrice: perKg, amount: qty * perKg, note: `${fq(kg)} kg × ${trips} lượt`, paramKey };
}

// hao hụt chỉ tính cho thiết bị đang THUÊ (thiết bị mua thì là của mình)
function lossLine(detail: CalcDetail[], prices: Map<string, PriceItem>, factor: number, label: string, ch: Choice): CalcLine | null {
  const amount = detail.reduce((s, d) => {
    const it = itemOf(prices, d.code);
    return it.mode === "RENT" && (ch.modes[d.code] ?? "RENT") === "RENT" ? s + d.total * it.buyPrice * (it.lossPct / 100) * factor : s;
  }, 0);
  if (!(amount > 0)) return null;
  return { type: "loss", name: `Hao hụt ${label}`, unit: "gói", qty: 1, unitPrice: amount, amount, note: `Σ SL × giá mua × % hao hụt × ${factor}` };
}

const finish = (cols: string[], detail: CalcDetail[], lines: (CalcLine | null)[], warnings: string[]): CalcResult => {
  // dòng thiết bị giữ lại cả khi đơn giá = 0 (để người dùng nhập giá)
  const ls = lines.filter((l): l is CalcLine => !!l && l.qty !== 0 && (l.amount !== 0 || l.code !== undefined || !!l.paramKey));
  return { cols, detail, lines: ls, total: ls.reduce((s, l) => s + l.amount, 0), warnings };
};

// ---------- 1. Chống sàn ----------
const SHORING_ORDER = ["RL2500", "RL2000", "RL1500", "RL1000", "HOR1200", "HOR600", "OBL1200", "OBL600", "JB38", "JU38", "B100_4000", "B100_3000", "B100_2000", "B50_4000", "B50_3000", "B50_2000", "TUBE", "CLAMP", "TIE16", "BOWL16", "PLY"];
function calcShoring(p: ShoringParams, prices: Map<string, PriceItem>, ch: Choice): CalcResult {
  const floors = (p.floors ?? []).filter((f) => num(f.area) > 0 && num(f.height) > 0);
  const cols = floors.map((f, i) => f.name || `Tầng ${i + 1}`);
  const acc = new Acc(floors.length);
  const warnings: string[] = [];
  const R = num(p.reserve, 1);
  floors.forEach((f, i) => {
    const A = num(f.area);
    const H = num(f.height);
    const combo = pickStandards(H - num(p.offset), num(p.jackRange, 0.4));
    const L = combo.reduce((s, x) => s + x, 0);
    const pts = A * num(p.density);
    const code = { 2.5: "RL2500", 2: "RL2000", 1.5: "RL1500", 1: "RL1000" } as Record<number, string>;
    for (const len of combo) acc.add(code[len], i, pts * R);
    const levels = L / Math.max(0.5, num(p.ledgerStep, 1.4));
    acc.add("HOR1200", i, pts * levels * num(p.hor1200) * R);
    acc.add("HOR600", i, pts * levels * num(p.hor600) * R);
    acc.add("OBL1200", i, pts * levels * num(p.obl1200) * R);
    acc.add("OBL600", i, pts * levels * num(p.obl600) * R);
    acc.add("JB38", i, pts * R);
    acc.add("JU38", i, pts * R);
    const tube = A * num(p.tubeRate) * H * R;
    acc.add("TUBE", i, tube);
    acc.add("CLAMP", i, tube * num(p.clampPerTube));
    acc.add("TIE16", i, A * num(p.tieRate) * R);
    acc.add("BOWL16", i, A * num(p.bowlRate) * R);
    const split = (total: number, s: [number, number, number], codes: [string, string, string]) => {
      const sum = s[0] + s[1] + s[2] || 1;
      [4, 3, 2].forEach((len, k) => acc.add(codes[k], i, (total * (s[k] / sum)) / len));
    };
    split(A * num(p.beamMain) * R, p.mainSplit ?? [33, 22, 45], ["B100_4000", "B100_3000", "B100_2000"]);
    split(A * num(p.beamSec) * R, p.secSplit ?? [60, 25, 15], ["B50_4000", "B50_3000", "B50_2000"]);
    acc.add("PLY", i, (A * num(p.plyRatio) * R) / Math.max(1, num(p.plyReuse, 1)));
    if (H - num(p.offset) > 15) warnings.push(`${cols[i]}: chiều cao ${H}m lớn, kiểm tra lại biện pháp chống`);
  });
  const daysOf = (i: number) => (daysBetween(floors[i].start, floors[i].end) ?? num(floors[i].days)) + num(p.extraDays);
  floors.forEach((f, i) => daysOf(i) <= 0 && warnings.push(`${cols[i]}: chưa có số ngày thuê`));
  const { detail, lines } = rentAndBuy(acc, cols, prices, daysOf, SHORING_ORDER, ch, "tầng");
  return finish(cols, detail, [...lines, transportLine(detail, prices, num(p.transportPerKg), num(p.trips, 2), "thiết bị chống sàn", "transportPerKg"), lossLine(detail, prices, num(p.lossFactor, 1), "thiết bị chống sàn", ch)], warnings);
}

// ---------- 2. Bao che ----------
const FACADE_ORDER = ["BR3000", "BR1700", "FRAME", "BRACE", "DECK", "SDECK", "TUBE", "CLAMP", "JB34", "B100_1000", "NEO3", "NEO17", "NET_GREEN", "NET_SAFE", "CABLE12", "CCLAMP", "TURNB"];
function calcFacade(p: FacadeParams, prices: Map<string, PriceItem>, ch: Choice): CalcResult {
  const lifts = (p.lifts ?? []).filter((l) => num(l.perimeter) > 0 && num(l.height) > 0);
  const cols = lifts.map((l, i) => l.name || `Đợt ${i + 1}`);
  const acc = new Acc(lifts.length);
  const warnings: string[] = [];
  const rf = num(p.rentFactor, 1);
  const bf = num(p.buyFactor, 1);
  let elev = 0;
  let maxP = 0;
  let mamTotal = 0;
  let catchNetTotal = 0;
  let frameTotal = 0;
  let stairTotal = 0;
  let beamTotal = 0;
  let greenTotal = 0;
  let layerTotal = 0;
  lifts.forEach((l, i) => {
    const P = num(l.perimeter);
    const H = num(l.height);
    elev += H;
    maxP = Math.max(maxP, P);
    const C = Math.ceil(P / Math.max(0.1, num(p.bayW, 1.6)));
    const D = Math.floor(H / Math.max(0.1, num(p.frameH, 1.7)));
    const stairs = num(l.stairs);
    const frames = C * D;
    const decks = 4 * C + 8 * stairs * D;
    const sdecks = stairs * D;
    // treo dầm I: mỗi hệ dầm đỡ tối đa framesPerBeam tầm giàn → đợt cao hơn cần thêm hệ dầm I
    const beamLevels = l.hung ? Math.max(1, Math.ceil(D / Math.max(1, num(p.framesPerBeam, 12)))) : 0;
    if (beamLevels > 1) warnings.push(`${cols[i]}: ${D} tầm giàn > ${num(p.framesPerBeam, 12)} tầm → ${beamLevels} hệ dầm I`);
    const b17 = C * beamLevels;
    const b3 = num(l.beams3) * beamLevels;
    const vSp = elev <= 60 ? num(p.vSpacingLow, 6.4) : num(p.vSpacingHigh, 4.8);
    const tubeM = Math.ceil(P / vSp + 1) * H + Math.ceil(H / Math.max(0.1, num(p.hSpacing, 5.1)) + 1) * P;
    acc.add("BR3000", i, b3 * rf);
    acc.add("BR1700", i, b17 * rf);
    acc.add("FRAME", i, frames * rf);
    acc.add("BRACE", i, frames * num(p.braceRatio, 1.8) * rf);
    acc.add("DECK", i, decks * rf);
    acc.add("SDECK", i, sdecks * rf);
    acc.add("TUBE", i, tubeM * rf);
    acc.add("CLAMP", i, Math.ceil((tubeM / 6) * 4 + 1) * rf);
    if (!l.hung) {
      acc.add("JB34", i, C * 2 * rf);
      acc.add("B100_1000", i, P * 2 * rf);
    }
    // vật tư mua mới
    acc.add("NEO3", i, b3 * bf);
    acc.add("NEO17", i, b17 * bf);
    acc.add("NET_GREEN", i, P * H * bf);
    const layer = (D / Math.max(1, num(p.netLayerEvery, 3))) * P * num(p.netLayerWidth, 2) * bf;
    acc.add("NET_SAFE", i, layer);
    acc.add("CABLE12", i, num(p.cablePerBeam) * (b3 + b17) * bf);
    acc.add("CCLAMP", i, 6 * (b3 + b17) * bf);
    acc.add("TURNB", i, (b3 + b17) * bf);
    // mâm hứng / lưới hứng chỉ nằm ở tầng dầm I: 4 mâm mỗi khung theo chu vi, lưới hứng = chu vi × bề rộng hứng
    mamTotal += 4 * C * beamLevels;
    catchNetTotal += P * num(p.catchNetWidth, 1.7) * beamLevels;
    frameTotal += P * H; // nhân công giàn tính theo m2 mặt giàn = chu vi × chiều cao đợt
    stairTotal += sdecks * rf;
    beamTotal += (b3 + b17) * rf;
    greenTotal += P * H * bf;
    layerTotal += layer;
  });
  // lưới an toàn tháo cốp pha ở tầng trên cùng (1 lần, theo chu vi lớn nhất)
  if (lifts.length && maxP > 0) acc.add("NET_SAFE", lifts.length - 1, maxP * num(p.topNetPerM) * bf);
  const daysOf = (i: number) => (daysBetween(lifts[i].start, lifts[i].end) ?? num(lifts[i].days)) + num(p.extraDays);
  lifts.forEach((l, i) => daysOf(i) <= num(p.extraDays) && warnings.push(`${cols[i]}: chưa có ngày cấp / trả (hoặc số ngày thuê)`));
  const { detail, lines } = rentAndBuy(acc, cols, prices, daysOf, FACADE_ORDER, ch, "đợt");
  const labor = (name: string, unit: string, qty: number, key: keyof FacadeParams): CalcLine => {
    const price = num(p[key] as number);
    return { type: "labor", name, unit, qty, rate: price, unitPrice: price, amount: qty * price, note: "Nhân công", paramKey: key };
  };
  return finish(
    cols,
    detail,
    [
      ...lines,
      labor("Nhân công lắp dựng mâm hứng trên dầm I", "mâm", mamTotal, "laborDeck"),
      labor("Nhân công lắp dựng lưới hứng trên dầm I", "m2", catchNetTotal, "laborCatchNet"),
      labor("Nhân công lắp dựng, tháo dỡ giàn giáo", "m2", frameTotal, "laborFrame"),
      labor("Nhân công lắp dựng, tháo dỡ cầu thang", "mâm thang", stairTotal, "laborStair"),
      labor("Nhân công lắp dựng, tháo dỡ dầm I", "cây", beamTotal, "laborBeam"),
      labor("Nhân công căng lưới bao che", "m2", greenTotal, "laborNet"),
      labor("Nhân công căng lưới an toàn phân tầng", "m2", layerTotal, "laborNet"),
      transportLine(detail, prices, num(p.frameTransportPerKg), num(p.trips, 2), "giàn khung bao che", "frameTransportPerKg", (c) => c === "FRAME"),
      transportLine(detail, prices, num(p.transportPerKg), num(p.trips, 2), "thiết bị bao che khác", "transportPerKg", (c) => c !== "FRAME"),
      lossLine(detail, prices, num(p.lossFactor, 1), "thiết bị bao che", ch),
    ],
    warnings
  );
}

// ---------- 3. An toàn ----------
const SAFETY_ORDER = ["RAIL_POST", "TUBE3", "CLAMP", "RAIL_NET", "HOIST_DOOR", "JB34", "LIFT_DOOR", "LIFT_NET", "LOAD_PLATFORM"];
function calcSafety(p: SafetyParams, prices: Map<string, PriceItem>, ch: Choice): CalcResult {
  const blocks = p.blocks ?? [];
  const cols = [...blocks.map((b, i) => b.name || `Khối ${i + 1}`), "Khác", "Sàn tiếp liệu"];
  const platCol = cols.length - 1;
  const plat = p.platforms ?? { count: 0, raises: 0, start: "", end: "", days: 0 };
  const platCount = num(plat.count);
  const platDays = daysBetween(plat.start, plat.end) ?? num(plat.days);
  const acc = new Acc(cols.length);
  const sp = Math.max(0.5, num(p.postSpacing, 3));
  // khối lượng nhân công lắp dựng / tháo dỡ (như các dòng "Chi phí lắp dựng và tháo dỡ" của sheet 05 file mẫu)
  let edgeM = 0;
  let stairM = 0;
  let hoistDoors = 0;
  let liftDoors = 0;
  blocks.forEach((b, i) => {
    const P = num(b.perimeter);
    const F = num(b.floors);
    if (b.edgeRail && P > 0) {
      const posts = 1.1 * (P / sp + 1) * F;
      const tubes = 1.2 * (P / sp + 1) * 2 * F;
      acc.add("RAIL_POST", i, posts);
      acc.add("TUBE3", i, tubes);
      acc.add("CLAMP", i, 2 * Math.ceil(tubes));
      acc.add("RAIL_NET", i, 1.1 * P * F);
      edgeM += P * F;
    }
    const doors = F * num(b.hoists) * 2;
    acc.add("HOIST_DOOR", i, doors);
    acc.add("JB34", i, doors * 2);
    const sPosts = F * num(b.stairs) * 3;
    const sTubes = F * num(b.stairs) * 4;
    acc.add("RAIL_POST", i, sPosts);
    acc.add("TUBE3", i, sTubes);
    acc.add("CLAMP", i, sTubes * 2);
    acc.add("LIFT_DOOR", i, F * num(b.lifts));
    acc.add("LIFT_NET", i, F * num(b.lifts));
    stairM += (sTubes / 2) * 3; // m lan can thang bộ (như file mẫu: số tuýp / 2 × 3m)
    hoistDoors += doors;
    liftDoors += F * num(b.lifts);
  });
  for (const o of p.others ?? []) acc.add(o.code, platCol - 1, num(o.qty));
  acc.add("LOAD_PLATFORM", platCol, platCount);
  const days = num(p.days);
  const { detail, lines } = rentAndBuy(acc, cols, prices, (i) => (i === platCol ? platDays : days), SAFETY_ORDER, ch, "khối");
  const labor = (name: string, unit: string, qty: number, key: keyof SafetyParams): CalcLine => {
    const price = num(p[key] as number);
    return { type: "labor", name, unit, qty, rate: price, unitPrice: price, amount: qty * price, note: "Nhân công", paramKey: key };
  };
  return finish(
    cols,
    detail,
    [
      ...lines,
      labor("Nhân công lắp dựng, tháo dỡ lan can biên", "m", edgeM, "laborEdge"),
      labor("Nhân công lắp dựng, tháo dỡ lan can cầu thang bộ", "m", stairM, "laborStairRail"),
      labor("Nhân công lắp đặt, tháo dỡ cửa an toàn hoist", "bộ", hoistDoors, "laborHoistDoor"),
      labor("Nhân công lắp đặt, tháo dỡ cửa chắn thang máy", "bộ", liftDoors, "laborLiftDoor"),
      ...(platCount > 0
        ? [
            labor("Tổ hợp sàn tiếp liệu", "bộ", platCount, "laborPlatformAssemble"),
            labor("Đặt bulong chờ, nâng sàn tiếp liệu", "lần", platCount * num(plat.raises), "laborPlatformRaise"),
            labor("Tháo dỡ sàn tiếp liệu", "bộ", platCount, "laborPlatformDismantle"),
            {
              type: "transport" as const,
              code: "",
              name: "Vận chuyển sàn tiếp liệu (đi + về)",
              unit: "chuyến",
              qty: Math.ceil(platCount / Math.max(1, num(p.platformsPerTrip, 2))) * 2,
              rate: num(p.platformTripPrice),
              unitPrice: num(p.platformTripPrice),
              amount: Math.ceil(platCount / Math.max(1, num(p.platformsPerTrip, 2))) * 2 * num(p.platformTripPrice),
              note: `${platCount} bộ, ${num(p.platformsPerTrip, 2)} bộ / chuyến`,
              paramKey: "platformTripPrice",
            },
          ]
        : []),
      transportLine(detail, prices, num(p.transportPerKg), num(p.trips, 2), "thiết bị an toàn", "transportPerKg"),
    ],
    [...(days > 0 ? [] : ["Chưa có số ngày thuê"]), ...(platCount > 0 && !(platDays > 0) ? ["Sàn tiếp liệu: chưa có ngày lắp / tháo"] : [])]
  );
}

export function computeEquip(kind: EquipKind, params: EquipParams, items: PriceItem[]): CalcResult {
  const prices = new Map(items.map((i) => [i.code, i]));
  const ch: Choice = { modes: params.modeOverrides ?? {}, prices: params.priceOverrides ?? {}, days: params.daysOverrides ?? {} };
  if (kind === "SHORING") return calcShoring(params as ShoringParams, prices, ch);
  if (kind === "FACADE") return calcFacade(params as FacadeParams, prices, ch);
  return calcSafety(params as SafetyParams, prices, ch);
}

// Thông số đã lưu (JSON) + mặc định (để bản tính cũ vẫn chạy khi thêm thông số mới)
export function parseParams(kind: EquipKind, json: string): EquipParams {
  try {
    return { ...defaultParams(kind), ...(JSON.parse(json) as object) } as EquipParams;
  } catch {
    return defaultParams(kind);
  }
}
