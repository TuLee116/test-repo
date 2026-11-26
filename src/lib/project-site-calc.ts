// DANH MỤC DỰ ÁN — phần dùng chung client / server: chuẩn hoá tên, tìm, gợi ý dự án gần giống (không đụng CSDL)

// cluster / clusterName: CỤM DỰ ÁN (Khu vực → Cụm → Dự án → Hợp đồng), VD "KV4-SB" · "SÂN BAY PHÚ QUỐC"; trống = không thuộc cụm
export type SiteOpt = { id: string; code: string; name: string; area: string; status: string; aliases: string[]; cluster?: string; clusterName?: string };

export const parseAliases = (s: string | null | undefined): string[] => {
  try {
    const v = JSON.parse(s || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : [];
  } catch {
    return [];
  }
};

// so tên: bỏ dấu, hoa thường, ký tự đặc biệt ("3-2" = "3 2", "–" = "-"), khoảng trắng thừa
export const normName = (s: string) =>
  (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// khoá so tên GIỮ DẤU (chỉ bỏ hoa thường, ký tự đặc biệt, khoảng trắng thừa): "Anh Hùng" ≠ "Anh Hưng" — dùng khi gom / nhận đúng tên.
// normName (bỏ dấu) chỉ dùng cho ô tìm và gợi ý gần giống.
export const nameKey = (s: string) =>
  (s || "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// từ không mang nghĩa phân biệt dự án (địa danh hành chính, từ nối) — bỏ khi tính độ giống
const STOP = new Set(["thanh", "pho", "tp", "phuong", "quan", "huyen", "tinh", "xa", "va", "cua", "du", "an", "cong", "trinh", "khu", "the", "and", "tai"]);
const NUM_WORD: Record<string, string> = { hai: "2", ba: "3", tu: "4", nam: "5", thang: "thang" };
const tokens = (s: string) =>
  normName(s)
    .split(" ")
    .map((w) => NUM_WORD[w] ?? w)
    .filter((w) => w && !STOP.has(w));

// độ giống 2 tên (0..1): phần chung / tên ngắn hơn — "Khu đô thị đường 3 tháng 2" nằm gọn trong "Khu đô thị đường 3-2 Vũng Tàu - 2025"
export function nameScore(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const w of ta) if (tb.has(w)) common++;
  const small = Math.min(ta.size, tb.size);
  const big = Math.max(ta.size, tb.size);
  return (common / small) * 0.75 + (common / big) * 0.25;
}

export const siteNamesOf = (s: Pick<SiteOpt, "name" | "aliases">) => [s.name, ...s.aliases];

// tên này đã có trong danh mục (đúng tên chuẩn hoặc 1 tên gọi khác; so GIỮ DẤU, bỏ hoa thường / ký tự đặc biệt)?
export function siteByName<T extends Pick<SiteOpt, "name" | "aliases">>(name: string, sites: T[]): T | undefined {
  const k = nameKey(name);
  if (!k) return undefined;
  return sites.find((s) => siteNamesOf(s).some((n) => nameKey(n) === k));
}

// dự án gần giống (để hỏi "Có phải là …?" trước khi đề nghị dự án mới / gợi ý gộp tên cũ)
export function similarSites<T extends SiteOpt>(name: string, sites: T[], area = "", limit = 5, min = 0.5): { site: T; score: number }[] {
  return sites
    .map((site) => ({ site, score: Math.max(...siteNamesOf(site).map((n) => nameScore(name, n))) + (area && site.area === area ? 0.05 : 0) }))
    .filter((x) => x.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ô tìm: gõ mã hoặc vài chữ trong tên / tên gọi khác / mã, tên CỤM (gõ "KV4-SB" hoặc "san bay" ra cả cụm) — không dấu, không cần đúng thứ tự từ
export function searchSites<T extends SiteOpt>(q: string, sites: T[]): T[] {
  const words = normName(q).split(" ").filter(Boolean);
  if (!words.length) return sites;
  return sites.filter((s) => {
    const hay = normName([s.code, ...siteNamesOf(s), s.cluster ?? "", s.clusterName ?? ""].join(" "));
    return words.every((w) => hay.includes(w));
  });
}

export const siteLabel = (s: Pick<SiteOpt, "code" | "name">) => (s.code ? `${s.code} · ${s.name}` : s.name);

export const clusterLabel = (s: Pick<SiteOpt, "cluster" | "clusterName">) => (s.cluster ? `${s.cluster} · ${s.clusterName || ""}`.replace(/ · $/, "") : "");

// KHOÁ SO SỐ HỢP ĐỒNG: "số/năm/BÊN" — bỏ chữ HĐ / số 0 đầu / khoảng trắng / phần đuôi (-TMN, -QN…) để chịu được gõ khác nhẹ:
// "HĐ 324/2026/HĐ/PCC-TMN", "324/2026/HD/PCC-TMN", "324.2026.HĐ.PCC-TMN" → "324/2026/PCC". Chưa có số ("…/2026/HĐ/NTP") → "".
export function contractKey(s: string | null | undefined): string {
  if (!s) return "";
  const u = String(s).toUpperCase().replace(/Đ/g, "D").replace(/(\d)\.(\d{4})\.HD\./g, "$1/$2/HD/");
  const m = /([0-9]+[A-Z]?)\s*\/\s*(\d{4})\s*\/\s*HD(?:NT)?\s*\/\s*([A-Z0-9]+)/.exec(u);
  if (!m) return "";
  return `${m[1].replace(/^0+(?=\d)/, "")}/${m[2]}/${m[3].replace(/^0/, "O")}`;
}

// dòng hợp đồng trong BẢNG TT DỰ ÁN: "HĐ số 324/2026/HĐ/PCC-TMN - Thi công …" → số HĐ + nội dung
export function splitContractLine(text: string): { contractNo: string; title: string } {
  const t = (text || "").replace(/\s+/g, " ").trim();
  const m = /^H[ĐD]\s*(?:số|so)?\s*:?\s*(.*)$/i.exec(t);
  if (!m) return { contractNo: "", title: t };
  // tách ở " - " đầu tiên; không có thì ở "- " ("…PCC-TMN-TN- Thi công")
  const rest = m[1];
  const i = rest.search(/\s[-–]\s/);
  const j = i >= 0 ? i : rest.search(/[-–]\s/);
  if (j < 0) return { contractNo: rest.trim(), title: "" };
  return { contractNo: rest.slice(0, j).trim(), title: rest.slice(j).replace(/^\s*[-–]\s*/, "").trim() };
}

// VIẾT GÓI THẦU CÙNG 1 KIỂU (anh dặn 25/11/2026): chữ thường, viết hoa chữ cái đầu câu; giữ hoa tên riêng / địa điểm / mã
// (CC01, S8, FB2, DV20,21, MEP, Beach Bar…). Chữ tiếng Việt (có dấu hoặc từ thường gặp) → thường; từ không phải tiếng Việt
// (tên riêng, tiếng Anh) giữ hoa chữ đầu; mã có số / chữ viết tắt kỹ thuật giữ nguyên hoa.
const VN_PLAIN = new Set(
  "thi khoan va khu cho theo tai ban can kinh mau tham xa ca an hai ba bao che cua ga lo mai nam tang bo cao tre tu so phan tho hoan thien noi that ngoai nha toa cap tram tuong san tran mai op lat son cua kinh nhom thep be tong coc mong ham cau duong ong dien nuoc chong tham cay xanh canh quan va cac cong trinh hang muc goi thau thi cong lap dat cung cap gia cong san xuat".split(" "),
);
const KEEP_UPPER = new Set(["MEP", "BOH", "FOH", "VIP", "PCCC", "BTCT", "HVAC", "ELV", "M&E", "HĐ", "TP", "CĐT", "PL", "LRT", "UC", "VVIP", "F&B", "BQL", "QL", "KCN", "KĐT", "KS", "CC", "TTTM", "PMU"]);
const LOWER_EN = new Set(["fitout", "fit-out", "built-in", "built", "in", "loose", "public", "and"]);
const hasVnMark = (w: string) => /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(w);
// địa danh / tên riêng hay gặp trong gói thầu — luôn viết hoa chữ đầu
const PLACES = [
  "Đà Nẵng", "Phú Quốc", "Hòn Thơm", "Bà Nà", "Vũng Tàu", "Sài Gòn", "Hồ Chí Minh", "Nha Trang", "Hà Nội", "Hà Nam", "Bắc Ninh", "Quảng Ninh", "Hải Phòng",
  "Cát Bà", "Hội An", "Sơn Trà", "Hòa Xuân", "Hòa Quý", "An Thới", "Bãi Đất Đỏ", "Bãi Trào", "Bãi Tây", "Đá Trào", "Suối Mơ", "Núi Ông Quán", "Sầm Sơn",
  "Thanh Hóa", "Tây Hồ", "Nội Bài", "Mỹ An", "Dung Quất", "Lê Duẩn", "Trần Thị Lý", "Minh Mạng", "Phan Đăng Lưu", "Nguyễn Phước Lan", "Trần Khánh Dư",
  "Ánh Dương", "Ánh Bình Minh", "Kim Cương", "Làng Pháp", "Địa Trung Hải", "Làng Nhiệt Đới", "Nam Phương", "Vương Thừa Vũ", "Lý Thái Tổ", "Tam Thắng",
  "Hòa Phát", "Sun Group", "Sungroup", "Nhà Hát Thành Phố", "Quảng Trường Vì Dân", "Hồ Tây", "Tổ hợp pháo hoa", "Việt Nam",
];
const PLACE_RE = PLACES.map((p) => [new RegExp(`(^|[^\\p{L}])(${p})(?=$|[^\\p{L}])`, "giu"), p] as const);
export function tidyText(s: string | null | undefined): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  // chuỗi viết HOA TOÀN BỘ / Hoa Mọi Chữ Đầu: từ nước ngoài viết hoa toàn bộ → hoa chữ đầu (ACCOR → Accor);
  // chuỗi viết thường bình thường: từ nước ngoài viết hoa toàn bộ giữ nguyên (chữ viết tắt: BOQ, FB…)
  const words = t.split(" ").filter((w) => /\p{L}/u.test(w));
  const capped = words.filter((w) => /^[^\p{L}]*\p{Lu}/u.test(w)).length;
  const shouty = words.length > 0 && capped / words.length >= 0.6;
  const out = t.split(" ").map((tok) => {
    const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(tok)!;
    const [, pre, core, post] = m;
    if (!core) return tok;
    const up = core.toUpperCase();
    const low = core.toLowerCase();
    let w: string;
    if (/\d/.test(core)) w = core; // mã có số (CC01, S8, DV20,21) giữ nguyên
    else if (KEEP_UPPER.has(up)) w = up;
    else if (hasVnMark(core) || VN_PLAIN.has(normName(core))) w = low; // tiếng Việt → thường (địa danh trả hoa lại ở dưới)
    else if (LOWER_EN.has(low)) w = low;
    else w = shouty && core.length > 1 && core === up ? core[0] + low.slice(1) : core; // tên riêng / tiếng Anh: hoa chữ đầu (BEACH → Beach)
    return pre + w + post;
  });
  let x = out.join(" ");
  for (const [re, p] of PLACE_RE) x = x.replace(re, (_m, a: string) => `${a}${p}`);
  return x.charAt(0).toUpperCase() + x.slice(1);
}
