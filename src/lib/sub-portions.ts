// Phần giao thầu phụ của 1 dòng BOQ (SubcontractorItem có boqItemId): thầu phụ bao vật tư / thiết bị / nhân công, hoặc từng dòng hao phí.
export type SubPortionScope = { coverVT: boolean; coverTB: boolean; coverNC: boolean; coveredLines: string | null };

export function parseCoveredLines(s: string | null | undefined): string[] | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : null;
  } catch {
    return null;
  }
}

// Thầu phụ có bao dòng hao phí này không (chọn riêng từng dòng thì theo danh sách, không thì theo 3 ô VT / TB / NC)
export function subCovers(p: SubPortionScope, line: { id: string; category: string }): boolean {
  const list = parseCoveredLines(p.coveredLines);
  if (list) return list.includes(line.id);
  return line.category === "VT" ? p.coverVT : line.category === "TB" ? p.coverTB : p.coverNC;
}

export function scopeLabel(p: SubPortionScope): string {
  if (parseCoveredLines(p.coveredLines)) return "chọn riêng từng dòng";
  const parts = [p.coverVT && "Vật tư", p.coverTB && "Thiết bị", p.coverNC && "Nhân công"].filter(Boolean);
  return parts.length ? `bao ${parts.join(" + ")}` : "chưa chọn phạm vi";
}

// Các trường project-data gắn thêm vào dòng hao phí khi 1 phần khối lượng của công tác được giao thầu phụ
export type LineExtra = { baseQuantity?: number; ownFactor?: number };
