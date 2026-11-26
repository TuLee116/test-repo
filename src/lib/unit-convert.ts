// Quy đổi đơn vị tính giữa BOQ của chủ đầu tư và định mức (VD BOQ tính kg, định mức tính tấn → 1 kg BOQ = 0,001 đơn vị định mức).
// Chỉ quy đổi khi cả hai ĐVT cùng loại đại lượng (khối lượng / chiều dài / diện tích / thể tích) và nhận dạng được; còn lại giữ nguyên (hệ số 1).

type Dim = "mass" | "length" | "area" | "volume";
const BASE: Record<string, { dim: Dim; k: number }> = {
  kg: { dim: "mass", k: 1 },
  g: { dim: "mass", k: 0.001 },
  tan: { dim: "mass", k: 1000 },
  t: { dim: "mass", k: 1000 },
  ta: { dim: "mass", k: 100 }, // tạ
  yen: { dim: "mass", k: 10 },
  m: { dim: "length", k: 1 },
  md: { dim: "length", k: 1 },
  cm: { dim: "length", k: 0.01 },
  mm: { dim: "length", k: 0.001 },
  km: { dim: "length", k: 1000 },
  m2: { dim: "area", k: 1 },
  cm2: { dim: "area", k: 0.0001 },
  km2: { dim: "area", k: 1e6 },
  ha: { dim: "area", k: 10000 },
  m3: { dim: "volume", k: 1 },
  cm3: { dim: "volume", k: 1e-6 },
  lit: { dim: "volume", k: 0.001 },
  l: { dim: "volume", k: 0.001 },
};

function strip(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/\^/g, "")
    .replace(/[\s.()]/g, "");
}

export function parseUnit(raw: string): { dim: Dim; scale: number } | null {
  const m = /^(\d+(?:,\d+)?)?([a-z]+\d?)$/.exec(strip(raw || ""));
  if (!m) return null;
  const base = BASE[m[2]];
  if (!base) return null;
  const mult = m[1] ? Number(m[1].replace(",", ".")) : 1;
  return mult > 0 ? { dim: base.dim, scale: mult * base.k } : null;
}

// Hệ số nhân khối lượng BOQ để ra khối lượng theo ĐVT của định mức (1 = không quy đổi)
export function unitFactor(boqUnit: string, normUnit: string): number {
  const b = parseUnit(boqUnit);
  const n = parseUnit(normUnit);
  if (!b || !n || b.dim !== n.dim) return 1;
  return b.scale / n.scale;
}

// true = hai ĐVT khác nhau mà không quy đổi được (cần người dùng kiểm tra)
export function unitMismatch(boqUnit: string, normUnit: string): boolean {
  const a = strip(boqUnit || "");
  const c = strip(normUnit || "");
  if (!a || !c || a === c) return false;
  const b = parseUnit(boqUnit);
  const n = parseUnit(normUnit);
  return !(b && n && b.dim === n.dim);
}
