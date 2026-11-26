// Ô gộp của bảng tự do (GRID): lưu dạng JSON trong ProjectSheet.merges. Hàm thuần, dùng được cả server lẫn client.
// Dòng tiêu đề có chỉ số âm: -1 = dòng tên cột, -2, -3... = các dòng tiêu đề phụ phía trên nó. Ô gộp không trộn dòng tiêu đề với dòng dữ liệu.

export type GridMerge = { r1: number; c1: number; r2: number; c2: number };

export function parseMerges(json: string | undefined): GridMerge[] {
  try {
    const arr = JSON.parse(json || "[]");
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((m) => m && [m.r1, m.r2].every((n: unknown) => Number.isInteger(n) && (n as number) >= -50) && [m.c1, m.c2].every((n: unknown) => Number.isInteger(n) && (n as number) >= 0))
      .map((m) => normalizeMerge(m))
      .filter((m) => m.r2 > m.r1 || m.c2 > m.c1);
  } catch {
    return [];
  }
}

export const normalizeMerge = (m: GridMerge): GridMerge => ({ r1: Math.min(m.r1, m.r2), r2: Math.max(m.r1, m.r2), c1: Math.min(m.c1, m.c2), c2: Math.max(m.c1, m.c2) });

export const mergesIntersect = (a: GridMerge, b: GridMerge) => a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2;

export const mergeContains = (m: GridMerge, r: number, c: number) => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2;

// Sau khi chèn / xoá / chuyển dòng cột: tính lại vị trí các ô gộp. rowMap/colMap = vị trí mới (null = đã xoá).
// Ô gộp bị xoá bớt thì co lại, chèn vào giữa thì giãn ra; nếu thứ tự dòng/cột bị xáo (chuyển dòng), hoặc còn
// lại chỉ 1 ô, hoặc đè lên dòng đầu mục thì bỏ ô gộp đó.
export function remapMerges(merges: GridMerge[], rowMap: (r: number) => number | null, colMap: (c: number) => number | null, headingRows: Set<number>): GridMerge[] {
  const span = (lo: number, hi: number, map: (n: number) => number | null): [number, number] | null => {
    const mapped: number[] = [];
    for (let n = lo; n <= hi; n++) {
      const v = map(n);
      if (v !== null) mapped.push(v);
    }
    if (mapped.length === 0) return null;
    for (let i = 1; i < mapped.length; i++) if (mapped[i] <= mapped[i - 1]) return null;
    return [mapped[0], mapped[mapped.length - 1]];
  };
  const out: GridMerge[] = [];
  for (const m of merges) {
    const rs: [number, number] | null = m.r1 < 0 ? [m.r1, m.r2] : span(m.r1, m.r2, rowMap); // ô gộp tiêu đề không đổi dòng
    const cs = span(m.c1, m.c2, colMap);
    if (!rs || !cs) continue;
    const nm = { r1: rs[0], r2: rs[1], c1: cs[0], c2: cs[1] };
    if (nm.r1 === nm.r2 && nm.c1 === nm.c2) continue;
    let overHeading = false;
    for (let r = nm.r1; r <= nm.r2; r++) if (headingRows.has(r)) overHeading = true;
    if (!overHeading) out.push(nm);
  }
  return out;
}
