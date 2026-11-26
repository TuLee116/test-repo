import { normalizeText } from "@/lib/text-normalize";

// Định mức chuẩn PHẦN THÔ (cốt thép, bê tông, ván khuôn, xây) - mã hiệu đặt theo định mức dự toán xây
// dựng công trình của nhà nước (Phụ lục II, Thông tư 38/2026/TT-BXD), phần mềm đọc đặc điểm từ mô tả
// BOQ rồi chọn thẳng mã (không đoán theo độ giống chữ):
//   A. Cốt thép : AF.61 + cấu kiện + nhóm đường kính + nhóm chiều cao; vật tư theo đường kính
//   B. Bê tông  : AF.1xxxx (đổ thủ công) / AF.3xxxx (đổ bằng máy bơm), chữ số cuối = mác (1 M100 ... 9 M500)
//                 (+ "-BN" bơm ngang);
//                 thủ công theo cấp phối TT38/2026 PL VII bảng 11.12300 (PCB40, đá 1x2, sụt 6-8cm)
//   C. Ván khuôn: phủ phim AF.891xx (sàn/tường/dầm/cột), AF.811xx/AF.812xx (móng, lót, lanh tô, cầu
//                 thang - nhà nước chỉ có ván gỗ); ván khuôn nhôm nhà nước không có → cùng mã + "-NH"
//   D. Xây      : gạch theo đúng nhóm AE của nhà nước (AE.52xxx gạch 4x8x19, AE.63xxx gạch ống 8x8x19)
// Nhân công: đặt tên theo công việc BOQ (src/lib/labor-sync.ts) - dòng NC ở đây chỉ là giá khởi điểm.
// Danh mục được tạo/cập nhật bằng scripts/seed-rough-norms.ts.

export type RoughLine = { category: "VT" | "NC" | "TB"; resource: string; quantity: number; wastage: number };
export type RoughNorm = { code: string; name: string; unit: string; subsection: string; lines: RoughLine[] };

// Tài nguyên mới cần có (ngoài các mã đã có trong bảng giá gốc)
export const ROUGH_RESOURCES = [
  { code: "BT.BomCan", name: "Phí bơm bê tông - bơm cần (thấp tầng; hầm đến khối đế cao tầng)", unit: "m3", unitPrice: 0, sourceType: "VT" as const },
  { code: "BT.BomNgang", name: "Phí bơm bê tông - bơm ngang (khối tháp cao tầng)", unit: "m3", unitPrice: 0, sourceType: "VT" as const },
  { code: "CatVang", name: "Cát vàng (bê tông)", unit: "m3", unitPrice: 490740.74, sourceType: "VT" as const },
  { code: "Da1x2", name: "Đá dăm 1x2", unit: "m3", unitPrice: 0, sourceType: "VT" as const },
  { code: "Nuoc", name: "Nước", unit: "lít", unitPrice: 0, sourceType: "VT" as const },
  { code: "Gdac.n.40.80.190", name: "Gạch đặc nung 40x80x190mm", unit: "viên", unitPrice: 0, sourceType: "VT" as const },
  { code: "Gong.n.80.80.190", name: "Gạch ống nung (gạch rỗng nung) 80x80x190mm", unit: "viên", unitPrice: 0, sourceType: "VT" as const },
];

// Mã bộ chuẩn phiên trước (TMN.*) - seed ẩn đi, dự án đang dùng được chuyển sang mã mới
export const LEGACY_ROUGH_PREFIXES = ["TMN.CT.", "TMN.BT.TP", "TMN.BT.TC", "TMN.VK.PP.", "TMN.VK.NH.", "TMN.XT."];

type Comp = "LOT" | "MONG" | "TUONG" | "COT" | "DAM" | "SAN" | "LT" | "CT" | "BE" | "RAM";
const COMP_LABEL: Record<Comp, string> = {
  LOT: "lót móng", MONG: "móng", TUONG: "tường, vách", COT: "cột, trụ", DAM: "xà dầm, giằng", SAN: "sàn mái",
  LT: "lanh tô, mái hắt, tấm đan, ô văng", CT: "cầu thang", BE: "bể nước", RAM: "ram dốc",
};
const H_LABEL = ["", "chiều cao ≤6m", "chiều cao ≤28m"];

// ---------- A. Cốt thép (AF.61xxx) ----------
type Dia = 1 | 2 | 3; // 1: ≤10, 2: ≤18 (10-18), 3: >18
const STEEL_RES: Record<Dia, string> = { 1: "Thepd<10", 2: "Thepd10-18", 3: "Thepd>18" };
const DIA_LABEL: Record<Dia, string> = { 1: "d≤10mm", 2: "10<d≤18mm", 3: "d>18mm" };
// cấu kiện → [mã nhóm, chia 3 nhóm đường kính (true) hay 2 nhóm ≤10/>10 (false), có chia chiều cao]
const REBAR: Partial<Record<Comp, [string, boolean, boolean]>> = {
  MONG: ["AF.611", true, false],
  TUONG: ["AF.613", true, true],
  BE: ["AF.613", true, true],
  COT: ["AF.614", true, true],
  DAM: ["AF.615", true, true],
  LT: ["AF.616", false, true],
  SAN: ["AF.617", false, false], // sàn mái: cột đầu tiên đã là ≤28m
  RAM: ["AF.617", false, false],
  CT: ["AF.618", false, true],
};
function rebarCode(c: Comp, d: Dia, h: 1 | 2): string | null {
  const r = REBAR[c];
  if (!r) return null;
  const [base, three, byH] = r;
  const g = three ? d : d === 1 ? 1 : 2;
  // móng: không chia chiều cao (AF.61110); sàn mái: cột đầu đã là ≤28m nên luôn là 1 (AF.61711)
  const code = `${base}${g}${byH ? h : base === "AF.617" ? 1 : 0}`;
  // nhóm 2 đường kính (≤10/>10) mà thép >18: cùng mã nhà nước, khác vật tư → thêm đuôi
  return !three && d === 3 ? `${code}-1` : code;
}

// ---------- B. Bê tông (AF.1xxxx thủ công / AF.3xxxx bơm) ----------
const RM_GRADES = [100, 150, 200, 250, 300, 350, 400, 450, 500];
// Mác ghi vào chữ số cuối của mã (quy ước quen dùng từ định mức 1776): mã nhà nước AF.32310 → AF.32316 = M350
const GRADE_DIGIT: Record<number, number> = { 100: 1, 150: 2, 200: 3, 250: 4, 300: 5, 350: 6, 400: 7, 450: 8, 500: 9 };
export const concreteCode = (base: string, grade: number, ngang = false) => `${base.slice(0, -1)}${GRADE_DIGIT[grade]}${ngang ? "-BN" : ""}`;
// Mã kiểu cũ (phiên trước): "AF.32310-M350-BN" → mã mới
export function legacyConcreteCode(code: string): string | null {
  const m = /^(AF\.\d{5})-M(\d+)(-BN)?$/.exec(code);
  return m && GRADE_DIGIT[+m[2]] ? concreteCode(m[1], +m[2], !!m[3]) : null;
}
// TT 38/2026/TT-BXD PL VII bảng 11.12300, mã 11.12321-11.12324: xi măng kg, cát vàng m3, đá m3, nước lít / 1m3
const HAND_MIX: Record<number, [number, number, number, number]> = {
  150: [224, 0.52, 0.849, 190],
  200: [266, 0.511, 0.833, 190],
  250: [310, 0.501, 0.817, 190],
  300: [352, 0.491, 0.801, 190],
};
// cấu kiện → mã (h: chiều cao 1 ≤6m / 2 ≤28m với tường, cột, dầm)
function concreteBase(c: Comp, hand: boolean, h: 1 | 2): string {
  if (hand) {
    const m: Record<Comp, string> = {
      LOT: "AF.11110", MONG: "AF.11210", TUONG: `AF.121${h}0`, BE: `AF.121${h}0`, COT: `AF.122${h}0`, DAM: `AF.123${h}0`,
      SAN: "AF.12410", RAM: "AF.12410", LT: "AF.12510", CT: "AF.12610",
    };
    return m[c];
  }
  const m: Record<Comp, string> = {
    LOT: "AF.31110", MONG: "AF.31110", TUONG: `AF.321${h}0`, BE: `AF.321${h}0`, COT: `AF.322${h}0`,
    DAM: "AF.32310", SAN: "AF.32310", RAM: "AF.32310", LT: "AF.32310", CT: "AF.32310",
  };
  return m[c];
}
const CONCRETE_LABEL: Record<string, string> = {
  "AF.11110": "lót móng", "AF.11210": "móng", "AF.12110": "tường", "AF.12120": "tường", "AF.12210": "cột", "AF.12220": "cột",
  "AF.12310": "xà dầm, giằng", "AF.12320": "xà dầm, giằng", "AF.12410": "sàn mái", "AF.12510": "lanh tô, mái hắt, tấm đan, ô văng", "AF.12610": "cầu thang",
  "AF.31110": "móng", "AF.32110": "tường", "AF.32120": "tường", "AF.32210": "cột", "AF.32220": "cột", "AF.32310": "xà dầm, giằng, sàn mái",
};

// ---------- C. Ván khuôn ----------
// cấu kiện → mã nhà nước, nhân công / thiết bị (cây chống) theo định mức đang có (phủ phim | nhôm)
const FORM: Record<Comp, { code: string; label: string; nc: string; ncAl: string; tb: string }> = {
  LOT: { code: "AF.81211", label: "bê tông lót móng, nền", nc: "NC.VK.Lot", ncAl: "NC.VK.Lot", tb: "TB.L.Mong" },
  MONG: { code: "AF.81111", label: "móng băng, móng bè, đài móng, giằng móng", nc: "NC.VK.Mong", ncAl: "NC.VK.Mong", tb: "TB.Mong" },
  TUONG: { code: "AF.89121", label: "tường, vách", nc: "NC.VK.CvDe", ncAl: "NC.VK.CvThan", tb: "TB.Mong" },
  COT: { code: "AF.89141", label: "cột vuông, chữ nhật", nc: "NC.VK.CvDe", ncAl: "NC.VK.CvThan", tb: "TB.Mong" },
  DAM: { code: "AF.89131", label: "xà dầm, giằng", nc: "NC.VK.DsDe", ncAl: "NC.VK.DsThan", tb: "TB.San.De" },
  SAN: { code: "AF.89111", label: "sàn mái", nc: "NC.VK.DsDe", ncAl: "NC.VK.DsThan", tb: "TB.San.De" },
  LT: { code: "AF.81151", label: "lanh tô, lanh tô liền mái hắt, bổ trụ, chân cơ", nc: "NC.VK.Lanhto", ncAl: "NC.VK.Lanhto", tb: "TB.Lanhto" },
  CT: { code: "AF.81161", label: "cầu thang", nc: "NC.VK.Cauth", ncAl: "NC.VK.Cauth.nh", tb: "TB.Cauthang" },
  BE: { code: "AF.89121-1", label: "bể nước, bể xử lý", nc: "NC.VK.Benuoc", ncAl: "NC.VK.Benuoc", tb: "TB.BeNuoc" },
  RAM: { code: "AF.89111-1", label: "ram dốc", nc: "NC.VK.Ram", ncAl: "NC.VK.Ram", tb: "TB.Ramd" },
};

// ---------- D. Xây ----------
// Vữa xi măng cát vàng M75 (TT38/2026 PL VII bảng 12.10234): 239 kg xi măng + 1,17 m3 cát / 1m3 vữa
const MORTAR_M75 = { cement: 239, sand: 1.17 };
type BrickKind = "DAC_NUNG" | "RONG_NUNG" | "DAC_KN" | "RONG_KN";
type Brick = { kind: BrickKind; dims: number[]; thick: 10 | 30; code: string };
// 6 định mức gạch công ty đã có + gạch theo PL II TT38/2026 (AE.52 gạch 4x8x19, AE.63 gạch ống 8x8x19;
// chữ số thứ 4: chiều dày 1 ≤10 / 2 ≤30cm, thứ 5: chiều cao 1 ≤6 / 2 ≤28m)
const COMPANY_BRICKS: Brick[] = [
  { kind: "DAC_NUNG", dims: [55, 90, 200], thick: 30, code: "AE.22213" },
  { kind: "DAC_NUNG", dims: [55, 90, 200], thick: 10, code: "AE.22113" },
  { kind: "DAC_KN", dims: [55, 90, 190], thick: 30, code: "AE.822843" },
  { kind: "DAC_KN", dims: [55, 90, 190], thick: 10, code: "AE.822844" },
  { kind: "RONG_KN", dims: [95, 135, 190], thick: 30, code: "AE.822833" },
  { kind: "RONG_KN", dims: [95, 135, 190], thick: 10, code: "AE.822834" },
];
// [mã nhóm, loại, kích thước, tài nguyên gạch, NC khởi điểm, {chiều dày: [viên, lít vữa]}] - số liệu PL II
const STATE_BRICKS: [string, BrickKind, number[], string, Record<10 | 30, string>, Record<10 | 30, [number, number]>][] = [
  ["AE.52", "DAC_NUNG", [40, 80, 190], "Gdac.n.40.80.190", { 10: "NC.XT.Gd.N100", 30: "NC.XT.Gd.N300" }, { 10: [1315, 200], 30: [1110, 325] }],
  ["AE.63", "RONG_NUNG", [80, 80, 190], "Gong.n.80.80.190", { 10: "NC.XT.Grg.0.100", 30: "NC.XT.Grg.0.300" }, { 10: [682, 170], 30: [649, 210] }],
];
const stateBrickCode = (base: string, thick: 10 | 30, h: 1 | 2) => `${base}${thick === 10 ? 1 : 2}${h}0`;

export function roughNorms(): RoughNorm[] {
  const out: RoughNorm[] = [];
  const seen = new Set<string>();
  const add = (n: RoughNorm) => {
    if (seen.has(n.code)) return;
    seen.add(n.code);
    out.push(n);
  };
  // A. cốt thép
  for (const c of Object.keys(REBAR) as Comp[])
    for (const d of [1, 2, 3] as Dia[])
      for (const h of [1, 2] as const) {
        const code = rebarCode(c, d, h);
        if (!code) continue;
        const byH = REBAR[c]![2];
        if (!byH && h === 2) continue;
        const comp = c === "BE" ? "tường" : c === "RAM" ? "sàn mái" : COMP_LABEL[c];
        add({
          code,
          name: `Cốt thép ${comp}, đường kính ${DIA_LABEL[d]}${byH ? `, ${H_LABEL[h]}` : ""}`,
          unit: "kg",
          subsection: "CÔNG TÁC CỐT THÉP",
          lines: [
            { category: "VT", resource: STEEL_RES[d], quantity: 1, wastage: 0.02 },
            { category: "NC", resource: "NC.CT.Than", quantity: 1, wastage: 0 },
          ],
        });
      }
  // B. bê tông
  const comps = Object.keys(COMP_LABEL) as Comp[];
  for (const h of [1, 2] as const)
    for (const c of comps) {
      const pump = concreteBase(c, false, h);
      for (const m of RM_GRADES)
        for (const [suffix, res, label] of [["", "BT.BomCan", "bơm cần"], ["-BN", "BT.BomNgang", "bơm ngang"]] as const)
          add({
            code: concreteCode(pump, m, suffix === "-BN"),
            name: `Bê tông ${CONCRETE_LABEL[pump]} đổ bằng máy bơm (${label}), bê tông thương phẩm M${m}${/AF\.32[12]2/.test(pump) ? ", chiều cao ≤28m" : ""}`,
            unit: "m3",
            subsection: "CÔNG TÁC BÊ TÔNG",
            lines: [
              { category: "VT", resource: `BTM${m}`, quantity: 1, wastage: 0.03 },
              { category: "VT", resource: res, quantity: 1, wastage: 0 },
              { category: "NC", resource: "NC.BT.DsDe", quantity: 1, wastage: 0 },
            ],
          });
      const hand = concreteBase(c, true, h);
      for (const [m, [xm, cat, da, nuoc]] of Object.entries(HAND_MIX))
        add({
          code: concreteCode(hand, +m),
          name: `Bê tông ${CONCRETE_LABEL[hand]} đổ thủ công, M${m} đá 1x2 (cấp phối TT38/2026 mã 11.1232x)${/AF\.12[123]2/.test(hand) ? ", chiều cao ≤28m" : ""}`,
          unit: "m3",
          subsection: "CÔNG TÁC BÊ TÔNG",
          lines: [
            { category: "VT", resource: "Xi.PCB40", quantity: xm, wastage: 0 },
            { category: "VT", resource: "CatVang", quantity: cat, wastage: 0 },
            { category: "VT", resource: "Da1x2", quantity: da, wastage: 0 },
            { category: "VT", resource: "Nuoc", quantity: nuoc, wastage: 0 },
            { category: "NC", resource: "NC.BT.Lanhto", quantity: 1, wastage: 0 },
          ],
        });
    }
  // C. ván khuôn
  for (const c of comps) {
    const f = FORM[c];
    add({
      code: f.code,
      name: `Ván khuôn ván ép phủ phim ${f.label}`,
      unit: "m2",
      subsection: "CÔNG TÁC VÁN KHUÔN",
      lines: [
        { category: "VT", resource: "TB.Vk.Van", quantity: 1 / 3, wastage: 0.05 },
        { category: "TB", resource: f.tb, quantity: 1, wastage: 0 },
        { category: "NC", resource: f.nc, quantity: 1, wastage: 0 },
      ],
    });
    add({
      code: `${f.code}-NH`,
      name: `Ván khuôn nhôm định hình ${f.label}`,
      unit: "m2",
      subsection: "CÔNG TÁC VÁN KHUÔN",
      lines: [
        { category: "TB", resource: "TB.Vk.Nh", quantity: 1, wastage: 0 },
        { category: "NC", resource: f.ncAl, quantity: 1, wastage: 0 },
      ],
    });
  }
  // D. xây
  for (const [base, kind, dims, res, nc, qty] of STATE_BRICKS)
    for (const thick of [10, 30] as const)
      for (const h of [1, 2] as const) {
        const [bricks, lit] = qty[thick];
        const v = lit / 1000;
        add({
          code: stateBrickCode(base, thick, h),
          name: `Xây tường thẳng ${kind === "RONG_NUNG" ? "gạch ống nung" : "gạch đặc nung"} ${dims.join("x")}mm, chiều dày ≤${thick}cm, ${H_LABEL[h]}, vữa XM M75`,
          unit: "m3",
          subsection: "CÔNG TÁC XÂY",
          lines: [
            { category: "VT", resource: res, quantity: bricks, wastage: 0.05 },
            { category: "VT", resource: "Xi.PCB40", quantity: Math.round(v * MORTAR_M75.cement * 1000) / 1000, wastage: 0 },
            { category: "VT", resource: "CatXay", quantity: Math.round(v * MORTAR_M75.sand * 10000) / 10000, wastage: 0 },
            { category: "NC", resource: nc[thick], quantity: 1, wastage: 0 },
          ],
        });
      }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Đọc đặc điểm phần thô từ mô tả BOQ → mã định mức chuẩn. code null + options = là phần thô nhưng
// thiếu thông tin (VD cốt thép không ghi đường kính) → để người dùng chọn. null = không phải phần thô.
// ------------------------------------------------------------------------------------------------

export type RoughResult = { code: string; reason: string } | { code: null; reason: string; options: string[] } | null;

function symbolize(s: string) {
  return s.replace(/≤|<=|=</g, " le ").replace(/≥|>=|=>/g, " ge ").replace(/</g, " lt ").replace(/>/g, " gt ");
}

// Cấu kiện: có chữ "móng" (kể cả dầm móng, giằng móng) là móng; "lót" là lót; còn lại lấy cấu kiện nêu đầu tiên
export function detectComponent(headLower: string): Comp | null {
  if (/(^|[^\p{L}])lót([^\p{L}]|$)/u.test(headLower)) return "LOT";
  if (/móng|hố ga|hố pit|đài cọc|đài móng|neo cọc|đầu cọc/.test(headLower)) return "MONG";
  const groups: [Comp, RegExp][] = [
    ["COT", /cột|trụ(?!\p{L})/u], // \b của JS không hiểu chữ có dấu
    ["TUONG", /vách|tường/],
    ["DAM", /dầm|giằng/],
    ["SAN", /sàn|mái/],
    ["LT", /lanh tô|bổ trụ|chân cơ|ô văng|tấm đan|mái hắt|giàn lam|lam\b/],
    ["CT", /cầu thang|bậc cấp|bậc thang/],
    ["RAM", /ram dốc|ramp/],
    ["BE", /(^|[^\p{L}])bể([^\p{L}]|$)/u],
  ];
  let best: { c: Comp; pos: number } | null = null;
  for (const [c, re] of groups) {
    const m = re.exec(headLower);
    if (m && m.index < (best?.pos ?? Infinity)) best = { c, pos: m.index };
  }
  return best?.c ?? null;
}

const tower = (full: string) => (/khối tháp|\btháp\b|bơm ngang/.test(full) ? 2 : 1);

export function resolveRough(desc: string, headLower: string, type: string | null, diameter: [number, number] | null, grade: number | null): RoughResult {
  const full = desc.toLowerCase().normalize("NFC");
  const comp = detectComponent(headLower);
  const h = tower(full) as 1 | 2;
  if (type === "cot_thep") {
    const c: Comp = comp ?? "MONG";
    let d = diameter;
    // "d≤18" (thường đi kèm 1 dòng d≤10 riêng) theo thông lệ BOQ là nhóm 10<d≤18
    if (d && d[0] === 0 && d[1] > 10 && d[1] <= 18) d = [10, d[1]];
    const options = ([1, 2, 3] as Dia[]).map((x) => rebarCode(c, x, h)).filter((x): x is string => !!x);
    if (!comp) return { code: null, reason: "Không nhận ra cấu kiện cốt thép", options };
    if (!d) return { code: null, reason: "Mô tả không ghi đường kính thép", options };
    const [a, b] = d;
    const g: Dia | null = b <= 10 ? 1 : a >= 10 && b <= 18 ? 2 : a >= 18 ? 3 : null;
    if (!g) return { code: null, reason: "Đường kính trải nhiều nhóm", options };
    return { code: rebarCode(c, g, h)!, reason: `Cốt thép ${COMP_LABEL[c]} ${DIA_LABEL[g]}` };
  }
  if (type === "be_tong") {
    const hand = /thủ công|trộn tại chỗ|trộn thủ công|trộn bằng máy trộn/.test(full) && !/thương phẩm/.test(headLower);
    if (!comp) return { code: null, reason: "Không nhận ra cấu kiện bê tông", options: [] };
    if (!grade) return { code: null, reason: "Mô tả không ghi mác bê tông", options: [] };
    const base = concreteBase(comp, hand, h);
    if (hand) {
      if (!HAND_MIX[grade]) return { code: null, reason: `Chưa có cấp phối bê tông thủ công M${grade}`, options: Object.keys(HAND_MIX).map((m) => concreteCode(base, +m)) };
      return { code: concreteCode(base, grade), reason: `Bê tông ${COMP_LABEL[comp]} thủ công M${grade}` };
    }
    if (!RM_GRADES.includes(grade)) return { code: null, reason: `Chưa có bê tông thương phẩm M${grade}`, options: [] };
    const ngang = h === 2;
    return { code: concreteCode(base, grade, ngang), reason: `Bê tông ${COMP_LABEL[comp]} thương phẩm M${grade}, ${ngang ? "bơm ngang" : "bơm cần"}` };
  }
  if (type === "van_khuon") {
    // các loại đặc biệt (ván khuôn thí, bồn hoa, ghế đá, sàn nâng, bể bơi) giữ định mức riêng đang có
    if (/ván khuôn thí|bồn hoa|ghế đá|sàn nâng|bể bơi|hồ bơi/.test(full)) return null;
    const alu = /nhôm/.test(full);
    if (!comp) return { code: null, reason: "Không nhận ra cấu kiện ván khuôn", options: (Object.keys(FORM) as Comp[]).map((c) => FORM[c].code + (alu ? "-NH" : "")) };
    return { code: FORM[comp].code + (alu ? "-NH" : ""), reason: `Ván khuôn ${alu ? "nhôm" : "phủ phim"} ${FORM[comp].label}` };
  }
  if (type === "xay") {
    const n = normalizeText(symbolize(desc));
    const kn = /khong nung|be tong/.test(n);
    const hollow = /\b(rong|ong|lo)\b/.test(n);
    const kind: BrickKind = kn ? (hollow ? "RONG_KN" : "DAC_KN") : hollow ? "RONG_NUNG" : "DAC_NUNG";
    const m = /(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*(mm|cm)?/i.exec(desc);
    let dims: number[] | null = null;
    if (m) {
      const nums = [m[1], m[2], m[3]].map((x) => parseFloat(x.replace(",", ".")));
      const scale = (m[4] ?? "").toLowerCase() === "cm" || Math.max(...nums) < 40 ? 10 : 1;
      dims = nums.map((x) => x * scale).sort((a, b) => a - b);
    }
    const t = /day (le|lt) ?(\d+) ?(cm|mm)?/.exec(n);
    const thickMm = t ? +t[2] * (t[3] === "mm" ? 1 : 10) : null;
    const thick: 10 | 30 = thickMm != null && thickMm <= 110 ? 10 : 30;
    const all: Brick[] = [
      ...COMPANY_BRICKS,
      ...STATE_BRICKS.flatMap(([base, k, d]) => ([10, 30] as const).map((th) => ({ kind: k, dims: d, thick: th, code: stateBrickCode(base, th, h) }))),
    ];
    const sameKind = all.filter((b) => b.kind === kind);
    const fit = dims ? sameKind.filter((b) => b.dims.every((x, i) => Math.abs(x - dims![i]) <= 10)) : [];
    const exact = fit.find((b) => b.thick === thick) ?? fit[0];
    if (!exact) return { code: null, reason: dims ? `Chưa có định mức gạch ${dims.join("x")}mm loại này` : "Mô tả không ghi kích thước gạch", options: sameKind.map((b) => b.code) };
    return { code: exact.code, reason: `Xây gạch ${exact.dims.join("x")}mm, tường ${exact.thick === 10 ? "≤10" : "≤30"}cm` };
  }
  return null;
}

// ------------------------------------------------------------------------------------------------
// Gợi ý mã khi người dùng bổ sung định mức mới: mã nhà nước theo đặc điểm phần thô (nếu nhận ra), rồi
// mã của các định mức gần giống trong danh mục + đuôi "-1", "-2"... chưa dùng. Chỉ trả mã CHƯA có.
// ------------------------------------------------------------------------------------------------
export function suggestNormCodes(roughCodes: string[], similarCodes: string[], used: Set<string>): string[] {
  const free = (code: string) => {
    if (!used.has(code)) return code;
    const base = code.replace(/-\d+$/, "");
    for (let i = 1; i < 100; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
    return null;
  };
  const out: string[] = [];
  for (const c of [...roughCodes, ...similarCodes]) {
    const f = free(c);
    if (f && !out.includes(f)) out.push(f);
  }
  return out.slice(0, 6);
}
