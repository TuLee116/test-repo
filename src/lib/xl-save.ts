import crypto from "node:crypto";
import { remapIds } from "@/lib/xl-formula";

// Lưu công thức kiểu Excel của các ô số (bảng duyệt giá đội / thầu phụ) — xem src/lib/xl-formula.ts.

// Dòng thêm mới trên màn hình có mã tạm "new:..." → cấp mã thật TRƯỚC khi lưu để công thức trỏ tới dòng đó không bị lệch
export function newIdMap(ids: string[]): Map<string, string> {
  return new Map(ids.filter((x) => x.startsWith("new:")).map((x) => [x, `c${crypto.randomBytes(12).toString("hex")}`]));
}

// Chép dòng sang hồ sơ mới (trình lại lần 2, 3...): mỗi dòng cấp mã mới, công thức đổi theo mã mới; bỏ công thức các cột `drop`
export const freshIdMap = (ids: string[]) => new Map(ids.map((x) => [x, `c${crypto.randomBytes(12).toString("hex")}`]));
export function copyFormulas(json: string | null | undefined, idMap: Map<string, string>, drop: string[] = []): string {
  const o = parse(json);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) if (!drop.includes(k)) out[k] = remapIds(v, idMap);
  return JSON.stringify(out);
}

const parse = (s: string | null | undefined): Record<string, string> => {
  try {
    const o = JSON.parse(s || "{}");
    return o && typeof o === "object" ? (o as Record<string, string>) : {};
  } catch {
    return {};
  }
};

// Gộp công thức gửi lên (chỉ các cột `keys` người này được sửa) vào công thức đang lưu của dòng; cột khác giữ nguyên
export function mergeFormulas(old: string | null | undefined, sent: Record<string, string> | undefined, keys: string[], idMap?: Map<string, string>): string {
  const out = parse(old);
  for (const k of keys) delete out[k];
  for (const k of keys) {
    const v = sent?.[k];
    if (typeof v === "string" && v.trim().startsWith("=") && v.length <= 2000) out[k] = idMap ? remapIds(v.trim(), idMap) : v.trim();
  }
  return JSON.stringify(out);
}
