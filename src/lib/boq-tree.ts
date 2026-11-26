import { normalizeText } from "@/lib/text-normalize";

// Suy ra cấp bậc của các đầu mục lớn trong BOQ (A, B / I, II / 1, 2 ...) từ STT gốc, để biết
// công tác nào thuộc đầu mục nào. Hàm thuần, dùng được cả server lẫn client.

// rawDescription BẮT BUỘC: cần để nhận dòng tổng cộng / VAT (đóng mọi đầu mục) - thiếu là cây đầu mục sai
type ItemLike = { id: string; isHeading: boolean; stt: string; level?: number | null; rawDescription: string };

const ROMAN = /^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX)$/;

function sttKind(stt: string): string {
  const s = stt.trim().toUpperCase().replace(/[.)]+$/, "");
  if (!s) return "other";
  if (ROMAN.test(s)) return "roman";
  if (/^\d+(\.\d+)*$/.test(s)) return `num${s.split(".").length}`;
  if (/^[A-Z]$/.test(s)) return "alpha";
  if (/^[A-Z](\.\d+)+$/.test(s)) return `alphanum${s.split(".").length}`;
  return "other";
}

export type BoqTree = {
  depthOf: Map<string, number>; // depth của đầu mục (0 = lớn nhất) và của công tác (= số đầu mục đang mở)
  scope: Map<string, string[]>; // id đầu mục → id các công tác (không phải đầu mục) nằm dưới nó
  headingScope: Map<string, string[]>; // id đầu mục → id các đầu mục con cháu nằm dưới nó
};

export function computeBoqTree(items: ItemLike[]): BoqTree {
  const depthOf = new Map<string, number>();
  const scope = new Map<string, string[]>();
  const headingScope = new Map<string, string[]>();
  const stack: { id: string; kind: string; level: number }[] = [];
  for (const it of items) {
    // Dòng tổng cộng / VAT / sau thuế bao trùm toàn bộ BOQ: không thuộc đầu mục nào và đóng mọi đầu mục đang mở
    if (it.isHeading && it.rawDescription && summaryKind(it.rawDescription)) {
      stack.length = 0;
      depthOf.set(it.id, 0);
      scope.set(it.id, []);
      headingScope.set(it.id, []);
      continue;
    }
    if (it.isHeading) {
      const kind = sttKind(it.stt);
      let level: number;
      if (it.level !== null && it.level !== undefined) {
        // cấp do người dùng tự đặt: đóng các đầu mục cùng cấp hoặc nhỏ hơn
        level = Math.max(0, it.level);
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      } else {
        const at = stack.findIndex((h) => h.kind === kind && kind !== "other");
        if (at >= 0) stack.length = at;
        // đầu mục không rõ loại (VD: STT "TT") ngang cấp với đầu mục "không rõ" liền trước, không lồng vào nhau
        if (kind === "other") while (stack.length && stack[stack.length - 1].kind === "other") stack.pop();
        level = stack.length ? stack[stack.length - 1].level + 1 : 0;
      }
      for (const h of stack) headingScope.get(h.id)!.push(it.id);
      stack.push({ id: it.id, kind, level });
      depthOf.set(it.id, level);
      scope.set(it.id, []);
      headingScope.set(it.id, []);
    } else {
      depthOf.set(it.id, stack.length ? stack[stack.length - 1].level + 1 : 0);
      for (const h of stack) scope.get(h.id)!.push(it.id);
    }
  }
  return { depthOf, scope, headingScope };
}

// Màu + kiểu chữ của dòng đầu mục theo cấp (0 = lớn nhất) để phân biệt các lớp đầu mục trong BOQ / CHI TIẾT / Thầu phụ
export function headingClass(depth: number): string {
  const styles = [
    "bg-amber-300 font-bold text-slate-900",
    "bg-amber-200 font-bold text-slate-900",
    "bg-yellow-200 font-semibold text-slate-900",
    "bg-yellow-100 font-semibold text-slate-800",
  ];
  return styles[Math.min(depth, styles.length - 1)];
}

// Dòng tổng cuối BOQ: "Tổng cộng trước thuế", "Thuế VAT", "Tổng cộng đã bao gồm VAT" (nhận diện theo nội dung)
export type SummaryKind = "subtotal" | "vat" | "total";
export function summaryKind(desc: string): SummaryKind | null {
  const t = normalizeText(desc);
  if (/tong cong.*(bao gom|sau thue)|bao gom vat|sau thue/.test(t)) return "total";
  // "Thuế VAT 8%", "Thuế GTGT", "VAT 8%", "GTGT 10%", "Thuế giá trị gia tăng"... (thuế suất tính theo khai báo của dự án)
  if (/^(thue|vat|gtgt)\b|^gia tri gia tang\b/.test(t)) return "vat";
  if (/^tong cong\b|truoc thue/.test(t)) return "subtotal";
  return null;
}

// ---- Đánh lại STT (tự cập nhật khi chèn / xoá đầu mục, công tác) ----
function toRoman(n: number): string {
  const map: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, r] of map) while (n >= v) { out += r; n -= v; }
  return out;
}
function toLetters(n: number): string {
  let s = "";
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

type RnNode = { oldStt: string; newStt: string; level: number; kind: string; counters: Record<string, number> };

// Trả về STT mới của những dòng cần đổi (id → STT mới). Giữ nguyên kiểu đánh số hiện có của từng cấp:
// chữ cái (A, B, C), số La Mã (I, II), số có tiền tố (B.1, II.1.1), số thường (1, 2, 3). Dòng có STT lạ (VD "TT") giữ nguyên.
export function renumberBoq(items: ItemLike[]): Map<string, string> {
  const changes = new Map<string, string>();
  const root: RnNode = { oldStt: "", newStt: "", level: -1, kind: "root", counters: {} };
  const stack: RnNode[] = [];
  const top = () => (stack.length ? stack[stack.length - 1] : root);

  for (const it of items) {
    const old = it.stt.trim();
    if (it.isHeading && it.rawDescription && summaryKind(it.rawDescription)) {
      stack.length = 0; // dòng tổng cuối BOQ: không đánh số, không thuộc đầu mục nào
      continue;
    }
    if (it.isHeading) {
      const kind = sttKind(it.stt);
      // xác định cấp (giống computeBoqTree)
      let level: number;
      if (it.level !== null && it.level !== undefined) {
        level = Math.max(0, it.level);
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      } else {
        const at = stack.findIndex((h) => h.kind === kind && kind !== "other");
        if (at >= 0) stack.length = at;
        if (kind === "other") while (stack.length && stack[stack.length - 1].kind === "other") stack.pop();
        level = stack.length ? stack[stack.length - 1].level + 1 : 0;
      }
      const parent = top();
      let next = old;
      if (kind === "alpha") next = toLetters((parent.counters.alpha = (parent.counters.alpha ?? 0) + 1));
      else if (kind === "roman") next = toRoman((parent.counters.roman = (parent.counters.roman ?? 0) + 1));
      else if (kind === "num1") next = String((parent.counters.int = (parent.counters.int ?? 0) + 1));
      else if (kind.startsWith("num") || kind.startsWith("alphanum")) {
        // dạng có tiền tố: "B.1", "II.1.1", "1.2" - chỉ đánh lại khi tiền tố khớp STT cha
        if (parent.oldStt && old.toLowerCase().startsWith(parent.oldStt.toLowerCase() + ".") && /^(.+)\.(\d+)$/.test(old)) {
          next = parent.newStt + "." + (parent.counters.dot = (parent.counters.dot ?? 0) + 1);
        }
      }
      if (next !== old) changes.set(it.id, next);
      stack.push({ oldStt: old, newStt: next, level, kind, counters: {} });
    } else {
      // công tác: chỉ đánh lại khi STT là số thường, đếm lại từ 1 trong từng đầu mục
      const parent = top();
      if (/^\d+$/.test(old)) {
        const next = String((parent.counters.item = (parent.counters.item ?? 0) + 1));
        if (next !== old) changes.set(it.id, next);
      }
    }
  }
  return changes;
}
