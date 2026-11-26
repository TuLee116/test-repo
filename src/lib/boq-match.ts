import { normalizeText } from "@/lib/text-normalize";
import { resolveRough } from "@/lib/rough-norms";
import { paintCount, paintPartsOfDesc, paintPartsOfNorm } from "@/lib/paint";

// Mã định mức nhà nước theo đặc điểm phần thô của mô tả (1 mã nếu đủ thông tin, nhiều mã nếu thiếu VD
// đường kính) - dùng gợi ý mã khi bổ sung định mức mới
export function roughCodeHints(desc: string, unit = ""): string[] {
  const d = extractFeatures(desc, unit);
  const head = (desc.split(/\r?\n/).find((l) => l.trim()) ?? "").toLowerCase().normalize("NFC");
  const r = resolveRough(desc, head, d.type, d.diameter, d.grade);
  if (!r) return [];
  return "options" in r ? r.options : [r.code];
}

// res: tên các hao phí trong định mức (không bắt buộc) - để xếp ưu tiên hệ sơn đủ bộ bả + lót + phủ
export type CatalogEntry = { id: string; code: string; name: string; unit: string; res?: string };

export type MatchCandidate = { id: string; code: string; name: string; unit: string; score: number };

export type MatchResult = {
  workItemId: string | null;
  workItemName: string | null;
  workItemUnit: string | null;
  matchType: "alias" | "rule" | "exact" | "fuzzy" | "none"; // rule = định mức chuẩn phần thô chọn theo đặc điểm (rough-norms.ts)
  // Các mã gần nhất (đã loại mã lệch loại công tác/cấu kiện/đường kính/mác/đơn vị) - hiện cho người dùng
  // chọn 1 lần bấm khi phần mềm không đủ chắc để tự gán.
  candidates: MatchCandidate[];
};

// Dùng chung cho cả khớp công tác với danh mục định mức (ở đây) lẫn khớp dòng BOQ cũ/mới khi "Cập
// nhật BOQ" (xem src/lib/boq-diff.ts) - nên export thay vì giữ riêng.
export function tokenSet(s: string): Set<string> {
  return new Set(s.split(" ").filter(Boolean));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ---------------------------------------------------------------------------------------------------
// Đặc điểm kỹ thuật của 1 mô tả công việc. normalizeText() xoá hết ký hiệu ≤ < > nên "d≤18" và "d>18"
// thành giống hệt nhau - ở đây đổi ký hiệu sang chữ TRƯỚC khi chuẩn hoá để giữ được nhóm đường kính.
// ---------------------------------------------------------------------------------------------------

function symbolize(s: string): string {
  return s
    .replace(/≤|<=|=</g, " le ")
    .replace(/≥|>=|=>/g, " ge ")
    .replace(/</g, " lt ")
    .replace(/>/g, " gt ")
    .replace(/[φΦØø]/g, " fi ");
}

// Khoá ghi nhớ cách viết (WorkItemAlias) - giữ ký hiệu so sánh để "d≤18" và "d>18" là 2 khoá khác nhau.
export function aliasKey(desc: string): string {
  return normalizeText(symbolize(desc));
}

// Dòng phụ chỉ mô tả phạm vi/thanh toán, không giúp nhận diện công tác
const FILLER_LINE = /^\s*[-–•+]?\s*(không bao gồm|ko bao gồm|kích thước thực tế|khối lượng|theo mẫu|ghi chú)/i;

const STOPWORDS = new Set(
  "gia cong san xuat lap dung dat thi cung cap va cho bang tai cong tac cac loai bao gom nha thau tu can doi phu trong tien do khong phat sinh hoac tuong duong theo mau trinh duyet".split(" ")
);

type WorkType =
  | "cot_thep" | "van_khuon" | "be_tong" | "xay" | "trat" | "lat" | "op" | "son" | "ba" | "chong_tham"
  | "tran" | "can_nen" | "dao" | "dap" | "van_chuyen" | "khoan_cay" | "cua" | "pha_do" | "lang";

const TYPE_PATTERNS: [WorkType, RegExp][] = [
  ["van_khuon", /\bvan khuon\b|\bcop pha\b|\bcoppha\b/],
  ["cot_thep", /\bcot thep\b/],
  ["be_tong", /\bbe tong\b/],
  ["khoan_cay", /\bkhoan cay\b/],
  ["xay", /\bxay\b/],
  ["trat", /\btrat\b/],
  ["chong_tham", /\bchong tham\b/],
  ["can_nen", /\bcan nen\b|\bcan vua\b/],
  ["lat", /\blat\b/],
  ["op", /\bop\b/],
  ["son", /\bson\b/],
  ["ba", /\bba (bot|matit|ma tit|\d|lop)/],
  ["tran", /\btran\b/],
  ["dao", /\bdao\b/],
  ["dap", /\bdap\b/],
  ["lang", /\blang\b/],
  ["van_chuyen", /\bvan chuyen\b/],
  ["cua", /\bcua\b/],
];

// Loại công tác = từ khoá xuất hiện SỚM NHẤT trong dòng đầu ("Xây ốp gạch vào kết cấu bê tông cốt
// thép" là công tác xây chứ không phải cốt thép).
function detectType(head: string): WorkType | null {
  let best: { t: WorkType; pos: number } | null = null;
  for (const [t, re] of TYPE_PATTERNS) {
    const m = re.exec(head);
    if (m && (!best || m.index < best.pos)) best = { t, pos: m.index };
  }
  return best?.t ?? null;
}

// Cấu kiện - dò trên chữ CÒN DẤU vì "cột" và "cốt" (cốt thép) bỏ dấu đều thành "cot".
const COMPONENTS: [string, RegExp][] = [
  ["mong", /móng|hố ga|hố pit|đài cọc|đáy hầm/],
  ["coc", /cọc/],
  ["cot", /cột|vách/],
  ["dam_san", /dầm|sàn/],
  ["lanh_to", /lanh tô|lanh-tô|bổ trụ|chân cơ|ô văng|tấm đan|giằng tường/],
  ["cau_thang", /cầu thang|bậc cấp|bậc thang/],
  ["be", /(^|[^\p{L}])bể([^\p{L}]|$)/u], // \b của JS không hiểu chữ có dấu
  ["ram_doc", /ram dốc/],
];
// Đặc điểm riêng: danh mục có mà BOQ không có (hoặc ngược lại) thì không tự gán - VD "dầm, sàn NÂNG"
// không được tự gán cho "dầm, sàn" thường, "lanh tô CONG" không tự gán cho lanh tô thẳng.
const QUALIFIERS: [string, RegExp][] = [
  ["nang", /sàn nâng|dầm, sàn nâng|dầm sàn nâng/],
  ["cong", /\bcong\b|vòm/],
  ["xien", /mái xiên|mái dốc/],
  ["ghe_da", /ghế đá/],
  ["bon_hoa", /bồn hoa/],
  ["neo", /neo cọc|thép neo/],
];
// Loại công tác dùng cấu kiện để phân biệt (với công tác hoàn thiện "sàn"/"cột" chỉ là vị trí)
const STRUCTURAL: Set<WorkType> = new Set(["cot_thep", "van_khuon", "be_tong"]);

const B_TO_M: Record<string, number> = { "7.5": 100, "10": 150, "12.5": 150, "15": 200, "20": 250, "22.5": 300, "25": 350, "30": 400, "35": 450, "40": 500 };

type Range = [number, number];

// Nhóm đường kính cốt thép: [nhỏ nhất, lớn nhất]. VD d≤10 → [0,10]; 10<Fi≤18 → [10,18]; d>18 → [18,∞).
function detectDiameter(norm: string): Range | null {
  let lo = 0;
  let hi = Infinity;
  let found = false;
  const pre = "(?:d|fi|phi|duong kinh)";
  // a < d ≤ b
  for (const m of norm.matchAll(new RegExp(`(\\d+) (?:lt|le) ${pre} (?:lt|le) (\\d+)`, "g"))) {
    lo = Math.max(lo, +m[1]);
    hi = Math.min(hi, +m[2]);
    found = true;
  }
  for (const m of norm.matchAll(new RegExp(`${pre} (lt|le|ge|gt) (\\d+)`, "g"))) {
    const v = +m[2];
    if (m[1] === "lt" || m[1] === "le") hi = Math.min(hi, v);
    else lo = Math.max(lo, v);
    found = true;
  }
  return found && lo < hi ? [lo, hi] : null;
}

function detectGrade(norm: string): number | null {
  const m = /\bm ?(\d{3})\b/.exec(norm);
  if (m) return +m[1];
  const b = /\bb ?(\d{1,2})(?: (5))?\b/.exec(norm);
  if (b) {
    const key = b[2] ? `${b[1]}.5` : b[1];
    if (B_TO_M[key]) return B_TO_M[key];
  }
  return null;
}

function unitFamily(u: string): string | null {
  const n = normalizeText(u).replace(/\s/g, "");
  if (!n) return null;
  if (/^(kg|tan|t|100kg)$/.test(n)) return "mass";
  if (/^(100)?m2$/.test(n)) return "area";
  if (/^(100)?m3$/.test(n)) return "vol";
  if (/^(md|m|100m|mdai)$/.test(n)) return "len";
  return "count";
}

export type WorkFeatures = {
  type: WorkType | null;
  components: Set<string>;
  qualifiers: Set<string>;
  diameter: Range | null;
  grade: number | null;
  unit: string | null;
  tokens: Set<string>;
};

export function extractFeatures(text: string, unit = ""): WorkFeatures {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const head = lines[0] ?? "";
  const kept = lines.filter((l, i) => i === 0 || !FILLER_LINE.test(l));
  const headLower = head.toLowerCase().normalize("NFC");
  const headNorm = normalizeText(symbolize(head));
  // tách số khỏi chữ để "30cm" và "30 cm", "m75" và "m 75" ra cùng token
  // tách số khỏi chữ để "30cm" và "30 cm", "m75" và "m 75" ra cùng token
  const fullNorm = normalizeText(symbolize(kept.join(" "))).replace(/(\d)([a-z])/g, "$1 $2").replace(/([a-z])(\d)/g, "$1 $2");
  // "đắp" và "đập" bỏ dấu đều là "dap" → phá dỡ / đập nhận trên chữ còn dấu
  const typeNorm = detectType(headNorm);
  const pha = /(^|[^\p{L}])(đập|phá dỡ|phá|tháo dỡ)([^\p{L}]|$)/u.exec(head.toLowerCase().normalize("NFC"));
  const type: WorkType | null = pha && (typeNorm === null || typeNorm === "dap" || pha.index <= 6) ? "pha_do" : typeNorm;
  const components = new Set<string>();
  if (type && STRUCTURAL.has(type)) for (const [k, re] of COMPONENTS) if (re.test(headLower)) components.add(k);
  const qualifiers = new Set<string>();
  for (const [k, re] of QUALIFIERS) if (re.test(headLower)) qualifiers.add(k);
  return {
    type,
    components,
    qualifiers,
    diameter: type === "cot_thep" ? detectDiameter(headNorm) : null,
    grade: type === "be_tong" ? detectGrade(headNorm) : null,
    unit: unitFamily(unit),
    tokens: new Set(fullNorm.split(" ").filter((t) => t && !STOPWORDS.has(t))),
  };
}

const TYPE_LABEL: Record<WorkType, string> = {
  cot_thep: "cốt thép", van_khuon: "ván khuôn", be_tong: "bê tông", xay: "xây", trat: "trát", lat: "lát", op: "ốp",
  son: "sơn", ba: "bả", chong_tham: "chống thấm", tran: "trần", can_nen: "cán nền", dao: "đào", dap: "đắp",
  van_chuyen: "vận chuyển", khoan_cay: "khoan cấy", cua: "cửa", pha_do: "phá dỡ", lang: "láng",
};
const COMPONENT_LABEL: Record<string, string> = {
  mong: "móng", coc: "cọc", cot: "cột/vách", dam_san: "dầm/sàn", lanh_to: "lanh tô/bổ trụ/chân cơ", cau_thang: "cầu thang/bậc cấp", be: "bể", ram_doc: "ram dốc",
};
const QUALIFIER_LABEL: Record<string, string> = { nang: "sàn nâng", cong: "cong/vòm", xien: "mái xiên", ghe_da: "ghế đá", bon_hoa: "bồn hoa", neo: "neo cọc" };
const fmtRange = ([a, b]: Range) => (a === 0 ? `d≤${b}` : b === Infinity ? `d≥${a}` : `${a}<d≤${b}`);

type Verdict = { verdict: "ok" | "unsure" | "reject"; reason: string; unitMismatch: boolean };

// "reject" = chắc chắn KHÁC công tác (kèm lý do để hiện cho người dùng); "unsure" = có thể đúng nhưng
// không đủ chắc để tự gán. Lệch đơn vị chỉ là "unsure" vì danh mục gốc có chỗ ghi sai đơn vị (VD ván
// khuôn cột hầm ghi m3).
function compare(d: WorkFeatures, c: WorkFeatures): Verdict {
  let unsure = false;
  const reject = (reason: string): Verdict => ({ verdict: "reject", reason, unitMismatch: false });
  if (d.type && c.type && d.type !== c.type) return reject(`BOQ là công tác ${TYPE_LABEL[d.type]}, định mức là ${TYPE_LABEL[c.type]}`);
  if (!d.type || !c.type) unsure = true;
  const unitMismatch = !!(d.unit && c.unit && d.unit !== c.unit);
  if (unitMismatch) unsure = true;
  if (d.components.size && c.components.size) {
    let hit = false;
    for (const x of d.components) if (c.components.has(x)) hit = true;
    if (!hit)
      return reject(`BOQ là ${[...d.components].map((x) => COMPONENT_LABEL[x]).join(", ")}, định mức là ${[...c.components].map((x) => COMPONENT_LABEL[x]).join(", ")}`);
  } else if (d.components.size !== c.components.size) unsure = true;
  // Đặc điểm riêng chỉ phân biệt ở công tác kết cấu (với trát/lát... "bồn hoa" chỉ là vị trí thi công)
  if (c.type && STRUCTURAL.has(c.type)) {
    for (const q of c.qualifiers) if (!d.qualifiers.has(q)) return reject(`Định mức dành riêng cho ${QUALIFIER_LABEL[q]}, BOQ không phải`);
  }
  for (const q of d.qualifiers) if (!c.qualifiers.has(q)) unsure = true;
  if (d.diameter && c.diameter) {
    const [a, b] = d.diameter;
    const [x, y] = c.diameter;
    if (b <= x || a >= y) return reject(`Đường kính BOQ ${fmtRange(d.diameter)}, định mức ${fmtRange(c.diameter)}`);
    if (!(a >= x && b <= y)) unsure = true; // giao một phần (VD BOQ ghi "d≤18" chung chung)
  } else if (d.diameter || c.diameter) unsure = true;
  if (d.grade && c.grade && d.grade !== c.grade) return reject(`Mác bê tông BOQ M${d.grade}, định mức M${c.grade}`);
  return { verdict: unsure ? "unsure" : "ok", reason: "", unitMismatch };
}

// Độ giống nội dung: ưu tiên "mô tả BOQ phủ được bao nhiêu % tên định mức" (tên định mức thường ngắn,
// mô tả BOQ thường dài kèm thông số), Jaccard thuần bị mô tả dài kéo điểm xuống quá thấp.
function similarity(d: Set<string>, c: Set<string>): number {
  if (!d.size || !c.size) return 0;
  let inter = 0;
  for (const t of c) if (d.has(t)) inter++;
  return 0.65 * (inter / c.size) + 0.35 * (inter / d.size);
}

const AUTO_THRESHOLD = 0.6; // điểm giống tối thiểu để tự gán
const AUTO_MARGIN = 0.08; // phải hơn hẳn mã đứng thứ 2 (khác tên) - sát nút thì để người dùng chọn
const SUGGEST_MIN = 0.2;
const UNIT_MISMATCH_FACTOR = 0.7;

export type AssignmentReview = {
  // Mã đang gán lệch hẳn nội dung (khác loại công tác/cấu kiện/đường kính/mác) - kèm lý do
  reason: string | null;
  // Mã nên đổi sang: khớp đúng tên/cách viết đã xác nhận, hoặc mã gần nhất không lệch
  suggestion: MatchCandidate | null;
  candidates: MatchCandidate[];
};

// Bộ khớp dùng chung cho Nhập/Cập nhật BOQ, sheet BOQ và CHI TIẾT. Tạo 1 lần cho mỗi lần tải trang
// (tính sẵn đặc điểm của toàn bộ danh mục).
export function createMatcher(catalog: CatalogEntry[], aliases: { normalizedText: string; workItemId: string; confirmed?: boolean }[]) {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const byKey = new Map<string, CatalogEntry>();
  const features = new Map<string, WorkFeatures>();
  // chia danh mục theo loại công tác: khác loại thì chắc chắn loại, khỏi so từng mã
  const byType = new Map<WorkType | null, CatalogEntry[]>();
  for (const item of catalog) {
    const key = aliasKey(item.name);
    if (!byKey.has(key)) byKey.set(key, item);
    const f = extractFeatures(item.name, item.unit);
    features.set(item.id, f);
    const bucket = byType.get(f.type) ?? [];
    bucket.push(item);
    byType.set(f.type, bucket);
  }
  const aliasMap = new Map(aliases.map((a) => [a.normalizedText, a.workItemId]));
  const confirmedKeys = new Set(aliases.filter((a) => a.confirmed).map((a) => a.normalizedText));
  const toCandidate = (item: CatalogEntry, score: number): MatchCandidate => ({ id: item.id, code: item.code, name: item.name, unit: item.unit, score: Math.round(score * 100) / 100 });

  // Hệ sơn: định mức có đúng các thành phần mô tả BOQ nêu (bả / lót / phủ) được cộng điểm, thiếu thì trừ;
  // mô tả không nói rõ thì ưu tiên hệ đủ bộ bả + lót + phủ
  function paintBonus(desc: string, item: CatalogEntry): number {
    const have = paintPartsOfNorm(item.res);
    if (!have) return 0;
    const want = paintPartsOfDesc(desc);
    if (!want) return 0.03 * paintCount(have);
    const miss = +(want.ba && !have.ba) + +(want.lot && !have.lot) + +(want.phu && !have.phu);
    const extra = +(!want.ba && have.ba) + +(!want.lot && have.lot) + +(!want.phu && have.phu);
    return miss === 0 && extra === 0 ? 0.15 : -0.06 * (miss + extra);
  }

  function rank(d: WorkFeatures, desc = "") {
    const scored: { item: CatalogEntry; score: number; sure: boolean }[] = [];
    const pool = d.type ? [...(byType.get(d.type) ?? []), ...(byType.get(null) ?? [])] : catalog;
    for (const item of pool) {
      const c = features.get(item.id);
      if (!c) continue;
      const v = compare(d, c);
      if (v.verdict === "reject") continue;
      const score = similarity(d.tokens, c.tokens) * (v.unitMismatch ? UNIT_MISMATCH_FACTOR : 1) + (d.type === "son" || d.type === "ba" ? paintBonus(desc, item) : 0);
      if (score >= SUGGEST_MIN) scored.push({ item, score, sure: v.verdict === "ok" });
    }
    return scored.sort((a, b) => b.score - a.score);
  }

  // Cách viết người dùng đã xác nhận. Khoá cũ (normalizeText, mất ký hiệu ≤ < >) chỉ dùng khi không
  // lệch đặc điểm, vì "d≤18" và "d>18" trùng khoá cũ.
  function aliasFor(desc: string, d: WorkFeatures): { item: CatalogEntry; confirmed: boolean } | null {
    const newId = aliasMap.get(aliasKey(desc));
    if (newId && byId.has(newId) && confirmedKeys.has(aliasKey(desc))) return { item: byId.get(newId)!, confirmed: true };
    const oldId = aliasMap.get(normalizeText(desc));
    const f = oldId ? features.get(oldId) : undefined;
    if (oldId && byId.has(oldId) && (!f || compare(d, f).verdict !== "reject")) return { item: byId.get(oldId)!, confirmed: false };
    return null;
  }

  // Phần thô (cốt thép / bê tông / ván khuôn / xây): chọn thẳng định mức chuẩn theo đặc điểm kỹ thuật.
  // item null + options = là phần thô nhưng thiếu thông tin (VD không ghi đường kính) → cho người dùng chọn.
  const byCode = new Map(catalog.map((c) => [c.code, c]));
  function roughFor(desc: string, d: WorkFeatures) {
    const head = (desc.split(/\r?\n/).find((l) => l.trim()) ?? "").toLowerCase().normalize("NFC");
    const r = resolveRough(desc, head, d.type, d.diameter, d.grade);
    if (!r) return null;
    if (r.code) {
      const item = byCode.get(r.code);
      return item ? { item, reason: r.reason, options: [] as CatalogEntry[] } : null;
    }
    return { item: null, reason: r.reason, options: ("options" in r ? r.options : []).map((c) => byCode.get(c)).filter((x): x is CatalogEntry => !!x) };
  }

  function match(desc: string, unit = ""): MatchResult {
    const none: MatchResult = { workItemId: null, workItemName: null, workItemUnit: null, matchType: "none", candidates: [] };
    if (!normalizeText(desc)) return none;
    const d = extractFeatures(desc, unit);
    const hit = (item: CatalogEntry, matchType: MatchResult["matchType"], candidates: MatchCandidate[] = []): MatchResult => ({
      workItemId: item.id, workItemName: item.name, workItemUnit: item.unit, matchType, candidates,
    });

    const alias = aliasFor(desc, d);
    if (alias?.confirmed) return hit(alias.item, "alias"); // người dùng đã tự chọn → luôn theo người dùng
    const rough = roughFor(desc, d);
    if (rough?.item) return hit(rough.item, "rule");
    if (rough && rough.options.length) return { ...none, candidates: rough.options.map((o) => toCandidate(o, 1)).slice(0, 5) };
    if (alias) return hit(alias.item, "alias");
    const exact = byKey.get(aliasKey(desc));
    if (exact) return hit(exact, "exact");

    const scored = rank(d, desc);
    const candidates = scored.slice(0, 5).map((s) => toCandidate(s.item, s.score));
    const best = scored[0];
    const second = best && scored.find((s) => normalizeText(s.item.name) !== normalizeText(best.item.name));
    if (best && best.sure && best.score >= AUTO_THRESHOLD && (!second || best.score - second.score >= AUTO_MARGIN)) return hit(best.item, "fuzzy", candidates);
    return { ...none, candidates };
  }

  // Rà soát 1 dòng: chưa gán → danh sách gợi ý; đã gán → cảnh báo nếu mã đang gán lệch nội dung hoặc
  // có mã khớp đúng hơn. Dòng người dùng đã bấm "Giữ mã này" (lưu cách viết) thì không cảnh báo nữa.
  // rough = dự án áp dụng nguyên tắc phần thô (cảnh báo dòng đang gán khác định mức chuẩn)
  function review(desc: string, unit: string, assignedId: string | null, opts: { rough?: boolean } = {}): AssignmentReview {
    const empty: AssignmentReview = { reason: null, suggestion: null, candidates: [] };
    if (!normalizeText(desc)) return empty;
    const d = extractFeatures(desc, unit);
    if (!assignedId) {
      const m = match(desc, unit);
      if (m.workItemId) {
        const item = byId.get(m.workItemId)!;
        return { reason: null, suggestion: toCandidate(item, 1), candidates: [toCandidate(item, 1), ...m.candidates.filter((c) => c.id !== item.id)].slice(0, 5) };
      }
      return { reason: null, suggestion: m.candidates[0] ?? null, candidates: m.candidates };
    }
    const alias = aliasFor(desc, d);
    if (alias?.confirmed && alias.item.id === assignedId) return empty;
    if (opts.rough) {
      const r = roughFor(desc, d);
      if (r?.item && r.item.id !== assignedId) return { reason: `Nguyên tắc phần thô: ${r.reason}`, suggestion: toCandidate(r.item, 1), candidates: [toCandidate(r.item, 1)] };
      if (r && !r.item && !byId.has(assignedId) && r.options.length)
        return { reason: `Định mức đang gán đã thay bằng định mức chuẩn phần thô (${r.reason.toLowerCase()})`, suggestion: null, candidates: r.options.map((o) => toCandidate(o, 1)).slice(0, 5) };
    }
    const exact = alias?.item ?? byKey.get(aliasKey(desc));
    const assigned = features.get(assignedId);
    const v = assigned ? compare(d, assigned) : null;
    if (exact && exact.id !== assignedId) {
      return { reason: v?.verdict === "reject" ? v.reason : `Mô tả khớp đúng với mã ${exact.code}`, suggestion: toCandidate(exact, 1), candidates: [toCandidate(exact, 1)] };
    }
    if (v?.verdict !== "reject") return empty;
    const candidates = rank(d, desc).slice(0, 5).map((s) => toCandidate(s.item, s.score));
    return { reason: v.reason, suggestion: candidates[0] ?? null, candidates };
  }

  return { match, review, byId };
}

// Nhóm mã định mức nhà nước (tiêu đề Phụ lục II TT38/2026, src/data/state-norm-headings.json) gần nhất
// với mô tả BOQ - gợi ý khi danh mục công ty chưa có gì giống. Trả tiền tố mã (bỏ số 0 cuối, VD
// AB.25000 → "AB.25") để người dùng điền tiếp phần chi tiết.
export function stateHeadingHints(desc: string, unit: string, headings: [string, string][], limit = 3): { prefix: string; code: string; title: string }[] {
  const d = extractFeatures(desc, unit);
  if (!d.tokens.size) return [];
  const scored: { code: string; title: string; score: number }[] = [];
  for (const [code, title] of headings) {
    const h = extractFeatures(title.toLowerCase(), "");
    if (d.type && d.type !== h.type) continue; // đã nhận ra loại công tác thì chỉ lấy nhóm mã cùng loại
    const s = similarity(d.tokens, h.tokens);
    if (s >= 0.25) scored.push({ code, title, score: s + (d.type && d.type === h.type ? 0.1 : 0) });
  }
  scored.sort((a, b) => b.score - a.score || b.code.length - a.code.length);
  const out: { prefix: string; code: string; title: string }[] = [];
  for (const s of scored) {
    const prefix = s.code.replace(/0+$/, "");
    if (out.some((o) => o.prefix === prefix)) continue;
    out.push({ prefix, code: s.code, title: s.title });
    if (out.length >= limit) break;
  }
  return out;
}
