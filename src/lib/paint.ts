import { normalizeText } from "@/lib/text-normalize";

// Thành phần hệ sơn: bột bả / sơn lót / sơn phủ. Nhận theo tên các hao phí của định mức (res, ngăn cách " | ")
// hoặc theo mô tả BOQ. Hàm thuần, dùng được cả server lẫn client.
export type PaintParts = { ba: boolean; lot: boolean; phu: boolean };

const BA = /\b(bot ba|ba matit|matit|ba \d|ba hai|bả)\b|\bba\b/;
const LOT = /\b(son lot|lot)\b/;
const PHU = /\b(son phu|phu)\b/;

function parts(text: string): PaintParts {
  const t = normalizeText(text);
  return { ba: BA.test(t), lot: LOT.test(t), phu: PHU.test(t) };
}

// Thành phần của 1 định mức theo tên hao phí bên trong; null = không phải định mức sơn / bả
export function paintPartsOfNorm(res: string | undefined): PaintParts | null {
  if (!res) return null;
  const p = { ba: false, lot: false, phu: false };
  for (const r of res.split(" | ")) {
    const t = normalizeText(r);
    if (/bot ba|matit/.test(t)) p.ba = true;
    if (/son lot/.test(t)) p.lot = true;
    if (/son phu/.test(t)) p.phu = true;
  }
  return p.ba || p.lot || p.phu ? p : null;
}

// Thành phần mô tả BOQ yêu cầu (VD "02 lớp bả, 01 lớp lót, 02 lớp phủ"); null = mô tả không nói rõ
export function paintPartsOfDesc(desc: string): PaintParts | null {
  const p = parts(desc);
  return p.ba || p.lot || p.phu ? p : null;
}

export const paintCount = (p: PaintParts | null) => (p ? +p.ba + +p.lot + +p.phu : 0);

export function paintLabel(p: PaintParts | null): string | null {
  if (!p) return null;
  const n = paintCount(p);
  if (n === 3) return "Bả + Lót + Phủ";
  const s = [p.ba && "Bả", p.lot && "Lót", p.phu && "Phủ"].filter(Boolean).join(" + ");
  return n === 1 ? `chỉ ${s}` : s;
}
