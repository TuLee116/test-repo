import { computeBoqTree } from "@/lib/boq-tree";

// Thành tiền của từng dòng BOQ (hàm thuần), dùng chung cho sheet BOQ, DT-CP và xuất Excel:
// - Công tác (dòng thường): Trực tiếp phí = đơn giá trực tiếp × khối lượng; Báo giá CĐT = đơn giá báo × khối lượng.
// - Đầu mục lớn KHÔNG có công tác con (VD A.1 Biện pháp thi công, A.2 Chi phí Prelim) có thể "liên kết giá", riêng
//   cho Trực tiếp phí (directMode) và cho Báo giá CĐT (quotedMode): "LINK" lấy từ sheet bảng tự do, "PCT" = tỷ lệ %
//   × tổng thành tiền (cùng loại) các công tác thuộc đầu mục cơ sở. Khi tính cơ sở không tính các dòng cũng đang
//   theo % (cùng loại), để không bao giờ bị tính vòng. Đầu mục liên kết được cộng vào Subtotal của đầu mục cha
//   như 1 công tác.

type TreeItem = { id: string; isHeading: boolean; stt: string; level?: number | null; rawDescription: string };
type LinkFlags = { directMode?: string | null; quotedMode?: string | null };

export type BoqAmountItem = TreeItem & {
  sheetId: string | null;
  quantity: number;
  quotedUnitPrice: number | null;
  directMode: string | null;
  directPct: number | null;
  directBaseId: string | null;
  directLink: string | null;
  quotedMode: string | null;
  quotedPct: number | null;
  quotedBaseId: string | null;
  quotedLink: string | null;
};

export type BoqAmount = { directTotal: number; quotedTotal: number | null };

// Đầu mục không có gì nằm dưới nó (dòng kế tiếp không lồng vào nó)
export function childlessHeadingIds(list: TreeItem[]): Set<string> {
  const tree = computeBoqTree(list);
  const out = new Set<string>();
  list.forEach((it, i) => {
    if (!it.isHeading) return;
    const next = list[i + 1];
    if (!next || (tree.depthOf.get(next.id) ?? 0) <= (tree.depthOf.get(it.id) ?? 0)) out.add(it.id);
  });
  return out;
}

const hasOwnLink = (it: LinkFlags) => !!it.directMode || !!it.quotedMode;

// Id các dòng "có thành tiền" nằm dưới từng đầu mục: công tác + đầu mục không có con đã liên kết giá
export function scopeWithLinkedHeadings(list: (TreeItem & LinkFlags)[]): Map<string, string[]> {
  const tree = computeBoqTree(list);
  const childless = childlessHeadingIds(list);
  const linked = new Set(list.filter((it) => it.isHeading && childless.has(it.id) && hasOwnLink(it)).map((it) => it.id));
  const out = new Map<string, string[]>();
  for (const [headingId, ids] of tree.scope) out.set(headingId, [...ids, ...(tree.headingScope.get(headingId) ?? []).filter((id) => linked.has(id))]);
  return out;
}

export function computeBoqAmounts(items: BoqAmountItem[], directUnitOf: (id: string) => number, links: Record<string, number>): Map<string, BoqAmount> {
  const out = new Map<string, BoqAmount>();
  const bySheet = new Map<string, BoqAmountItem[]>();
  for (const it of items) {
    const key = it.sheetId ?? "";
    if (!bySheet.has(key)) bySheet.set(key, []);
    bySheet.get(key)!.push(it);
  }
  for (const list of bySheet.values()) {
    const childless = childlessHeadingIds(list);
    const isAmountRow = (it: BoqAmountItem) => !it.isHeading || (childless.has(it.id) && hasOwnLink(it));
    const direct = new Map<string, number>();
    const quoted = new Map<string, number | null>();
    for (const it of list) {
      if (!isAmountRow(it)) continue;
      const linkable = it.isHeading;
      const dMode = linkable ? it.directMode : null;
      const qMode = linkable ? it.quotedMode : null;
      const d = dMode === "LINK" ? (it.directLink ? (links[it.directLink] ?? 0) : 0) : dMode === "PCT" ? 0 : directUnitOf(it.id) * it.quantity;
      let q: number | null;
      if (qMode === "LINK") q = it.quotedLink ? (links[it.quotedLink] ?? 0) : 0;
      else if (qMode === "PCT") q = null;
      else q = it.quotedUnitPrice != null ? it.quotedUnitPrice * it.quantity : null;
      direct.set(it.id, d);
      quoted.set(it.id, q);
      out.set(it.id, { directTotal: d, quotedTotal: q });
    }
    const needsPct = list.some((it) => isAmountRow(it) && it.isHeading && (it.directMode === "PCT" || it.quotedMode === "PCT"));
    if (!needsPct) continue;
    const scope = scopeWithLinkedHeadings(list);
    const byId = new Map(list.map((x) => [x.id, x]));
    const baseSum = (baseId: string | null, side: "direct" | "quoted") => {
      let sum = 0;
      for (const id of baseId ? (scope.get(baseId) ?? []) : []) {
        const row = byId.get(id);
        if (!row) continue;
        if (row.isHeading && (side === "direct" ? row.directMode : row.quotedMode) === "PCT") continue;
        sum += (side === "direct" ? direct.get(id) : quoted.get(id)) ?? 0;
      }
      return sum;
    };
    for (const it of list) {
      if (!it.isHeading || !isAmountRow(it)) continue;
      const amt = out.get(it.id)!;
      if (it.directMode === "PCT") amt.directTotal = ((it.directPct ?? 0) / 100) * baseSum(it.directBaseId, "direct");
      if (it.quotedMode === "PCT") amt.quotedTotal = ((it.quotedPct ?? 0) / 100) * baseSum(it.quotedBaseId, "quoted");
    }
  }
  return out;
}
