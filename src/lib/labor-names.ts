// Đặt tên hao phí nhân công theo công việc BOQ (nhân công khoán theo công việc của dự án), VD:
//   "Bê tông lót móng, lót giằng móng, lót nền, lót hố ga, hố Pit bê tông thương phẩm M100, đá 4x6 ..."
//   → "Đổ bê tông lót móng, giằng móng, nền, hố ga, hố Pit"
// Chỉ là tên gợi ý ban đầu - người dùng sửa được ở TH Nhân Công / CHI TIẾT.

// Từ đây trở đi là thông số vật tư (mác, loại đá, độ sụt, vữa, quy cách thép...) - không thuộc tên công việc nhân công
const SPEC_CUT = [
  /,?\s*bê tông thương phẩm/i,
  /,?\s*thương phẩm/i,
  /,?\s*bê tông thủ công/i,
  /,?\s*bê tông (ximang|xi măng)/i,
  /,?\s*(cấp độ bền|độ sụt|mác)\b/i,
  /,?\s*vữa\b/i,
  /,?\s*\bVXM\b/,
  /,?\s*đá\s*\d/i,
  /,?\s*\b[BM]\s?\d{2,3}\b/,
  /,?\s*\bCB\s?\d{3}/i,
  /,?\s*\b(d|fi|φ|Ø)\s*[≤<>≥=]/i,
  /,?\s*đường kính/i,
  /,?\s*(kích thước|KT)\s*[:\d]/i,
  /,?\s*theo mẫu/i,
  /,?\s*bao gồm\s*:?\s*$/i,
  /\s*\(/,
];

// Bỏ phần "cung cấp" (vật tư) - nhân công chỉ làm phần thi công / lắp đặt
const PREFIX_FIX: [RegExp, string][] = [
  [/^công tác\s+/i, ""],
  [/^(cung cấp\s*(&|và|,)\s*)(thi công|lắp đặt|lắp dựng)/i, "$3"],
  [/^cung cấp,?\s*/i, ""],
  [/^gia công sản xuất,?\s*lắp dựng/i, "Gia công lắp dựng"],
  [/^sản xuất,?\s*lắp dựng/i, "Gia công lắp dựng"],
  [/^gia công,\s*lắp dựng/i, "Gia công lắp dựng"],
  [/^bê tông/i, "Đổ bê tông"],
  [/^cốt thép/i, "Gia công lắp dựng cốt thép"],
  [/^ván khuôn/i, "Gia công lắp dựng, tháo dỡ ván khuôn"],
];

const TRAIL = /[\s,;:.\-–&]+$/;

// Kích thước của công việc (dày / cao / rộng / sâu / dài + số đo) quyết định công khoán (cán nền dày 2cm khác
// dày 4cm) → giữ lại trong tên dù đứng sau phần thông số vật tư bị cắt ("Cán nền vữa XM M75 dày 20mm")
const DIM = /(?:chiều\s+)?(?:dày|cao|rộng|sâu|dài)\s*(?:[≤<>≥=]\s*)?\d+(?:[.,]\d+)?\s*(?:mm|cm|m)\b/giu;
// số đo < 5mm là quy cách vật liệu (tôn 0,75mm, inox 2mm, tấm trần 3mm) chứ không phải kích thước công việc
const MM = { mm: 1, cm: 10, m: 1000 } as const;
const dimsOf = (s: string) =>
  [...s.matchAll(DIM)]
    .filter((m) => {
      const n = /(\d+(?:[.,]\d+)?)\s*(mm|cm|m)\b/i.exec(m[0]);
      return !n || Number(n[1].replace(",", ".")) * MM[n[2].toLowerCase() as keyof typeof MM] >= 5;
    })
    .map((m) => m[0].replace(/\s+/g, " "));

// Đường kính (khoan cấy thép D14 / D16, cốt thép Fi<10 / Fi>18, chống thấm cổ ống D≤90...) cũng quyết định công
// khoán → giữ lại (1 thông số, viết gọn thống nhất: "Fi > 18" → "Fi>18", "<=" → "≤")
const DIA = [
  /\d+(?:[.,]\d+)?\s*(?:<=|≤|<)\s*(?:fi|phi|φ|ø|d)\s*(?:<=|≤|<)\s*\d+(?:[.,]\d+)?(?:\s*mm)?/iu,
  /(?:^|[\s(,])((?:fi|phi|φ|ø)\s*(?:<=|>=|≤|≥|<|>|=)?\s*\d+(?:[.,]\d+)?(?:\s*mm)?)/iu,
  /đường kính\s*(?:d\s*)?(?:<=|>=|≤|≥|<|>|=)?\s*\d+(?:[.,]\d+)?(?:\s*mm)?/iu,
  /\bd\s*(?:<=|>=|≤|≥|<|>|=)\s*\d+(?:[.,]\d+)?(?:\s*mm)?/iu,
  /\bD\d{1,3}\b/u,
];
function diameterOf(s: string): string | null {
  for (const re of DIA) {
    const m = re.exec(s);
    if (!m) continue;
    const t = (m[1] ?? m[0]).replace(/<=/g, "≤").replace(/>=/g, "≥");
    return t.toLocaleLowerCase("vi").startsWith("đường kính") ? `đường kính ${t.slice(10).replace(/\s+/g, "")}` : t.replace(/\s+/g, "");
  }
  return null;
}

function capitalize(s: string) {
  return s ? s[0].toLocaleUpperCase("vi") + s.slice(1) : s;
}

// keepSpecs = false: quy tắc cũ (không giữ kích thước / đường kính) - để nhận ra tên phần mềm tự đặt trước đây
// khi tách lại các nhân công đang gộp nhầm (xem labor-sync.ts)
export function laborNameFromBoq(desc: string, keepSpecs = true): string {
  let s = (desc.split(/\r?\n/).find((l) => l.trim()) ?? "").trim().replace(/\s+/g, " ");
  // "Bê tông thương phẩm, (đổ bằng bơm bê tông,) bê tông đầu cọc..." → bỏ phần vật tư đứng đầu câu
  s = s.replace(/^bê tông thương phẩm,?\s*(đổ bằng bơm( bê tông)?,?\s*)?/i, "");
  // khoảng đường kính "10<=Fi<=18" bị cắt dở ở chữ Fi → lấy ra trước, nối lại gọn ở cuối
  let range: string | null = null;
  if (keepSpecs) {
    const m = DIA[0].exec(s);
    if (m && m.index > 0) {
      range = diameterOf(m[0]);
      s = (s.slice(0, m.index) + s.slice(m.index + m[0].length)).replace(/\s*,\s*,/g, ",").replace(/\s+/g, " ").trim();
    }
  }
  // cắt thông số - chỉ khi nó nằm SAU tên công việc (đứng đầu câu thì cắt là mất hết)
  const full = s;
  for (const re of SPEC_CUT) {
    const m = re.exec(s);
    if (m && m.index > 0) s = s.slice(0, m.index);
  }
  s = s.replace(TRAIL, "").trim();
  // kích thước / đường kính nằm trong phần vừa cắt → nối lại vào cuối tên (sau khi chuẩn hoá xong phần tên)
  const tail = full.slice(s.length);
  const kept = new Set(dimsOf(s).map((d) => d.toLocaleLowerCase("vi")));
  const specs = [...new Set(dimsOf(tail).filter((d) => !kept.has(d.toLocaleLowerCase("vi"))))];
  const dia = range ?? (diameterOf(s) ? null : diameterOf(tail));
  if (dia) specs.push(dia);
  for (const [re, to] of PREFIX_FIX) s = s.replace(re, to);
  s = s
    .replace(/\bbê tông tại chỗ,?\s*/i, "")
    .replace(/\s*cho bê tông đổ tại chỗ,?/i, "")
    .replace(/cốt thép tại chỗ,?\s*cốt thép/i, "cốt thép")
    .replace(/ván khuôn,?\s*(ván khuôn)/gi, "$1")
    .replace(/\bcốt thép bê tông\b/i, "cốt thép")
    .replace(/cốt thép,?\s+cốt thép/i, "cốt thép");

  // "lót móng, lót giằng móng, lót nền" → "lót móng, giằng móng, nền": cùng 1 từ đứng đầu từ 2 vế trở
  // lên (và có trong vế 1) là từ lặp → bỏ. Chỉ 1 vế thì giữ ("cổ cột, cột vuông" vẫn là "cột vuông").
  // Không tách ở dấu phẩy thập phân ("dày 3,0cm").
  const parts = s.split(/\s*,(?!\d)\s*/);
  if (parts.length > 2) {
    const lead = (x: string) => x.split(" ")[0].toLocaleLowerCase("vi");
    const firstWords = new Set(parts[0].toLocaleLowerCase("vi").split(" "));
    const count = new Map<string, number>();
    for (const x of parts.slice(1)) if (x.includes(" ")) count.set(lead(x), (count.get(lead(x)) ?? 0) + 1);
    for (let i = 1; i < parts.length; i++) {
      const w = lead(parts[i]);
      if (parts[i].includes(" ") && firstWords.has(w) && (count.get(w) ?? 0) >= 2) parts[i] = parts[i].split(" ").slice(1).join(" ");
    }
    s = parts.filter(Boolean).join(", ");
  }
  s = s.replace(TRAIL, "").trim();
  if (keepSpecs && specs.length && s) s = `${s} ${specs.join(", ")}`;
  return capitalize(s) || capitalize(desc.trim().slice(0, 80));
}
