import { prisma } from "@/lib/prisma";
import { parsePrices, priceAt, lineKeyOf, similarity } from "@/lib/hop-dong-calc";
import { controlVersion, loadLedger } from "@/lib/hop-dong";
import { amt, apprPriceOf, baseOfLine, branchOf, extraSum, noMgmtFlags, ntPartKey, ntProductKey, parseExtras, parseSavedTotals, parseVatRows, parseJson, propPriceOf, propQtyOf, spOwnerOf, totalsOf, withSaved, type Bid, type Bidder, type ColTotals, type NtAppr, type SubLineNums } from "@/lib/thau-phu-calc";

// Trình giá thầu phụ — phần server: dòng TH Thầu Phụ của hợp đồng (giá cơ sở TĐ1, giá kiểm soát, giá đã duyệt theo thầu phụ),
// tự khớp dòng, xếp nhánh A / B.

export type SubRef = {
  key: string;
  name: string;
  unit: string;
  qty: number | null; // khối lượng DT-CP
  prevQty: number; // lũy kế KL đã trình ở hồ sơ khác của hợp đồng (0 khi chưa tính)
  base1: number | null; // đơn giá cơ sở THỜI ĐIỂM 1 (điều kiện nhánh A)
  price: number | null; // đơn giá thời điểm kiểm soát (đã duyệt)
  approved: { crew: string; price: number; date: string; code: string }[];
  future: { crew: string; price: number; date: string; code: string }[];
};

// proposalId: tính thêm LŨY KẾ khối lượng đã trình ở các hồ sơ thầu phụ KHÁC của cùng hợp đồng (để kiểm vượt khối lượng DT-CP, như giá đội)
export async function subRefs(contractId: string, proposalId?: string): Promise<SubRef[]> {
  const led = await loadLedger(contractId, "TP");
  if (!led) return [];
  const lines = await prisma.costLine.findMany({ where: { contractId, kind: "TP", level: "ITEM" }, select: { key: true, prices: true } });
  const p1 = new Map(lines.map((l) => [l.key, priceAt(parsePrices(l.prices), 1)]));
  const prev = proposalId ? await subPrevQty(contractId, proposalId) : new Map<string, number>();
  return led.rows
    .filter((r) => r.level === "ITEM")
    .map((r) => ({ key: r.key, name: r.name, unit: r.unit, qty: r.qty, prevQty: prev.get(r.key) ?? 0, base1: p1.get(r.key) ?? null, price: r.price, approved: r.crews.map((c) => ({ crew: c.crew, price: c.price, date: c.date, code: c.code })), future: r.future }));
}

// Lũy kế KL đã trình / đã duyệt ở hồ sơ khác cùng hợp đồng: không tính các lần trình trước của chính hồ sơ này, hồ sơ đã có lần trình sau, dòng TP không đồng ý
async function subPrevQty(contractId: string, proposalId: string): Promise<Map<string, number>> {
  const all = await prisma.subProposal.findMany({ where: { contractId }, select: { id: true, parentId: true } });
  const parentOf = new Map(all.map((x) => [x.id, x.parentId]));
  const mine = new Set<string>([proposalId]);
  for (let cur = parentOf.get(proposalId); cur && !mine.has(cur); cur = parentOf.get(cur)) mine.add(cur);
  const superseded = new Set(all.map((x) => x.parentId).filter((x): x is string => !!x));
  const others = await prisma.subLine.findMany({
    where: { proposal: { contractId, status: { in: ["SUBMITTED", "PTG_PENDING", "APPROVED"] }, id: { notIn: [...mine] } }, level: "ITEM", lineKey: { notIn: ["", "-"] } },
    select: { lineKey: true, propQty: true, baseQty: true, cdtQty: true, bids: true, tpOk: true, proposal: { select: { id: true, status: true, selectedBidder: true } } },
  });
  const prev = new Map<string, number>();
  for (const o of others) {
    if (superseded.has(o.proposal.id)) continue;
    if (o.proposal.status === "APPROVED" && !o.tpOk) continue;
    const bids = parseJson<Record<string, Bid>>(o.bids, {});
    const q = o.propQty ?? bids[o.proposal.selectedBidder]?.qty ?? o.baseQty ?? o.cdtQty ?? 0;
    prev.set(o.lineKey, (prev.get(o.lineKey) ?? 0) + q);
  }
  return prev;
}

// Tự khớp dòng đề xuất chưa khớp với dòng TH Thầu Phụ: nhớ khớp cũ → trùng tên + ĐVT → tên giống nhất (≥ 0,6, cùng ĐVT)
export async function subAutoMatch(proposalId: string, contractId: string) {
  const [lines, tps, memo] = await Promise.all([
    prisma.subLine.findMany({ where: { proposalId, level: "ITEM", lineKey: "" }, select: { id: true, content: true, workName: true, unit: true } }),
    prisma.costLine.findMany({ where: { contractId, kind: "TP", level: "ITEM" }, select: { key: true, name: true, unit: true } }),
    prisma.priceMatch.findMany({ where: { contractId, srcKey: { startsWith: "TP|" } } }),
  ]);
  const memoMap = new Map(memo.map((m) => [m.srcKey, m.lineKey]));
  const keys = new Set(tps.map((n) => n.key));
  const updates: { id: string; lineKey: string }[] = [];
  for (const l of lines) {
    const src = lineKeyOf(l.content, l.unit);
    let k = memoMap.get(`TP|${src}`);
    if (k && k !== "-" && !keys.has(k)) k = undefined;
    if (!k && keys.has(src)) k = src;
    if (!k) {
      const unit = lineKeyOf("", l.unit);
      let best: { key: string; s: number } | null = null;
      for (const n of tps) {
        if (lineKeyOf("", n.unit) !== unit) continue;
        const sc = Math.max(similarity(l.content, n.name), similarity(`${l.workName} ${l.content}`, n.name));
        if (sc >= 0.6 && (!best || sc > best.s)) best = { key: n.key, s: sc };
      }
      k = best?.key;
    }
    if (k) updates.push({ id: l.id, lineKey: k });
  }
  if (updates.length) await prisma.$transaction(updates.map((u) => prisma.subLine.update({ where: { id: u.id }, data: { lineKey: u.lineKey } })));
  return updates.length;
}

export const toNums = (l: { level: string; cdtQty: number | null; cdtPrice: number | null; baseQty: number | null; basePrice: number | null; bids: string; propQty: number | null; propPrice: number | null; tpPrice: number | null; tpOk: boolean }): SubLineNums => ({
  ...l,
  bids: parseJson<Record<string, Bid>>(l.bids, {}),
});

// Xếp nhánh cho hồ sơ: giá cơ sở = đơn giá TĐ1 của dòng TH Thầu Phụ đã khớp (không khớp được thì đơn giá cơ sở ghi trong file)
export async function computeBranch(p: { id: string; contractId: string | null; selectedBidder: string; prelim: string; vat: string; extraRows?: string; vatRows?: string; totalAmounts?: string }) {
  const allLines = await prisma.subLine.findMany({ where: { proposalId: p.id }, orderBy: { orderIndex: "asc" } });
  const skip = noMgmtFlags(allLines); // dòng không tính chi phí quản lý
  const lines = allLines.filter((l) => l.level === "ITEM");
  const skipItems = allLines.map((l, i) => (l.level === "ITEM" ? skip[i] : null)).filter((x) => x !== null) as boolean[];
  const refs = p.contractId ? new Map((await subRefs(p.contractId)).map((r) => [r.key, r])) : new Map<string, SubRef>();
  const items = lines.map((l) => {
    const n = toNums(l);
    const base = baseOfLine(l, refs.get(l.lineKey)?.base1);
    return { content: l.content, prop: propPriceOf(n, p.selectedBidder), base, amount: amt(propQtyOf(n, p.selectedBidder), propPriceOf(n, p.selectedBidder)) ?? 0 };
  });
  const sum = items.reduce((s, i) => s + i.amount, 0);
  const noPrelim = items.reduce((s, i, k) => s + (skipItems[k] ? i.amount : 0), 0);
  const prelim = parseJson<Record<string, number>>(p.prelim, {});
  const vat = parseJson<Record<string, number>>(p.vat, {});
  const value = withSaved(totalsOf(sum, prelim.D ?? prelim[p.selectedBidder] ?? 0, vat.D ?? vat[p.selectedBidder] ?? 0, extraSum(parseExtras(p.extraRows), "D"), parseVatRows(p.vatRows), "D", noPrelim), parseSavedTotals(p.totalAmounts).D).afterVat;
  return { ...branchOf(items, value), value };
}

export { controlVersion };

// Tổng giá trị 4 cột của 1 hồ sơ thầu phụ (giống bảng trên màn hình, sau Prelim + VAT):
// A = Chủ đầu tư, B = Giá cơ sở (đơn giá TĐ1 của dòng DT-CP đã khớp, chưa khớp thì giá cơ sở trong file), D = Đề xuất (thầu phụ được chọn), R = Duyệt,
// H = theo HỢP ĐỒNG gốc (PLHĐ điều chỉnh: KL hợp đồng × đơn giá hợp đồng; Prelim / VAT theo cột D như màn hình).
export type PropTotals = { A: ColTotals; B: ColTotals; D: ColTotals; R: ColTotals; H: ColTotals };
export function proposalTotals(
  p: { selectedBidder: string; prelim: string; vat: string; extraRows?: string; vatRows?: string; totalAmounts?: string },
  lines: (Parameters<typeof toNums>[0] & { lineKey: string; baseManual?: boolean; noMgmt?: boolean; hdQty?: number | null; hdPrice?: number | null })[],
  refs: Map<string, SubRef>,
): PropTotals {
  const sel = p.selectedBidder;
  const sums = { A: 0, B: 0, D: 0, R: 0, H: 0 };
  const no = { A: 0, B: 0, D: 0, R: 0, H: 0 }; // phần không tính chi phí quản lý
  const skip = noMgmtFlags(lines); // `lines` đủ mọi dòng theo thứ tự trên bảng
  for (const [li, l] of lines.entries()) {
    if (l.level !== "ITEM") continue;
    const n = toNums(l);
    const base = baseOfLine(l, refs.get(l.lineKey)?.base1);
    sums.A += amt(l.cdtQty, l.cdtPrice) ?? 0;
    sums.B += amt(l.baseQty, base) ?? 0;
    sums.D += amt(propQtyOf(n, sel), propPriceOf(n, sel)) ?? 0;
    sums.R += amt(propQtyOf(n, sel), apprPriceOf(n, sel)) ?? 0;
    sums.H += amt(l.hdQty ?? null, l.hdPrice ?? null) ?? 0;
    if (skip[li]) {
      no.H += amt(l.hdQty ?? null, l.hdPrice ?? null) ?? 0;
      no.A += amt(l.cdtQty, l.cdtPrice) ?? 0;
      no.B += amt(l.baseQty, base) ?? 0;
      no.D += amt(propQtyOf(n, sel), propPriceOf(n, sel)) ?? 0;
      no.R += amt(propQtyOf(n, sel), apprPriceOf(n, sel)) ?? 0;
    }
  }
  const prelim = parseJson<Record<string, number>>(p.prelim, {});
  const vat = parseJson<Record<string, number>>(p.vat, {});
  const extras = parseExtras(p.extraRows);
  const vatRows = parseVatRows(p.vatRows);
  const t = (c: "A" | "B" | "D" | "R" | "H") => { const k = c === "R" || c === "H" ? "D" : c; return totalsOf(sums[c], prelim[k] ?? 0, vat[k] ?? 0, extraSum(extras, c), vatRows, k, no[c]); };
  // cột có công thức ở các dòng tổng (làm tròn...) → số đã lưu lúc bấm Lưu / Trình / Duyệt
  const sv = parseSavedTotals(p.totalAmounts);
  return { A: withSaved(t("A"), sv.A), B: withSaved(t("B"), sv.B), D: withSaved(t("D"), sv.D), R: withSaved(t("R"), sv.R), H: withSaved(t("H"), sv.H) };
}

// ---- LŨY KẾ PHỤ LỤC: HĐ thầu phụ gốc + các phụ lục đã duyệt trước = PLĐC (giá trị hợp đồng sau điều chỉnh) ----
export type SubChain = { rootLabel: string; rootValue: number; priors: { code: string; value: number }[] };
const CHAIN_SELECT = {
  id: true, code: true, hdNo: true, status: true, contractId: true, selectedBidder: true, prelim: true, vat: true, extraRows: true, vatRows: true, totalAmounts: true, submittedAt: true, createdAt: true,
  lines: { orderBy: { orderIndex: "asc" }, select: { level: true, noMgmt: true, lineKey: true, baseManual: true, cdtQty: true, cdtPrice: true, baseQty: true, basePrice: true, bids: true, propQty: true, propPrice: true, tpPrice: true, tpOk: true } },
} as const;

export async function subChain(p: { id: string; hdtpId: string | null; submittedAt: Date | null }): Promise<SubChain | null> {
  if (!p.hdtpId) return null;
  const root = await prisma.subProposal.findUnique({ where: { id: p.hdtpId }, select: CHAIN_SELECT });
  if (!root) return null;
  const refsOf = new Map<string, Map<string, SubRef>>();
  const valueOf = async (s: typeof root) => {
    let refs = s.contractId ? refsOf.get(s.contractId) : undefined;
    if (s.contractId && !refs) {
      refs = new Map((await subRefs(s.contractId)).map((r) => [r.key, r]));
      refsOf.set(s.contractId, refs);
    }
    const t = proposalTotals(s, s.lines, refs ?? new Map());
    return s.status === "APPROVED" ? t.R.afterVat : t.D.afterVat;
  };
  // các phụ lục KHÁC của cùng hợp đồng thầu phụ đã được duyệt trước hồ sơ này (bỏ hồ sơ đã có lần trình lại)
  const pls = await prisma.subProposal.findMany({ where: { hdtpId: p.hdtpId, id: { not: p.id }, status: "APPROVED" }, select: CHAIN_SELECT, orderBy: { createdAt: "asc" } });
  const replaced = new Set((await prisma.subProposal.findMany({ where: { parentId: { in: pls.map((x) => x.id) } }, select: { parentId: true } })).map((x) => x.parentId));
  const cutoff = p.submittedAt ?? new Date();
  const priors: SubChain["priors"] = [];
  for (const s of pls) if (!replaced.has(s.id) && (s.submittedAt ?? s.createdAt) < cutoff) priors.push({ code: s.code, value: await valueOf(s) });
  return { rootLabel: `${root.hdNo ? `HĐ ${root.hdNo} — ` : ""}${root.code}`, rootValue: await valueOf(root), priors };
}

// Các hồ sơ HĐ THẦU PHỤ (đã duyệt, đã có SỐ HĐ) để QSĐT chọn khi trình PHỤ LỤC: cùng hợp đồng DT-CP (chưa gắn thì cùng tên dự án)
export async function hdtpOptions(p: { id: string; contractId: string | null; projectName: string; hdtpId: string | null }) {
  const rows = await prisma.subProposal.findMany({
    where: {
      id: { not: p.id },
      OR: [{ hdtpId: null, proposalType: { in: ["HDTP", ""] }, status: "APPROVED", hdNo: { not: "" }, ...(p.contractId ? { contractId: p.contractId } : { projectName: p.projectName }) }, ...(p.hdtpId ? [{ id: p.hdtpId }] : [])],
    },
    select: { id: true, code: true, hdNo: true, subName: true, itemName: true, selectedBidder: true, bidders: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => {
    const name = parseJson<Bidder[]>(r.bidders, []).find((b) => b.key === r.selectedBidder)?.name || r.subName;
    return { id: r.id, label: [r.hdNo ? `HĐ ${r.hdNo}` : "(chưa có số HĐ)", name, r.itemName, `(${r.code})`].filter(Boolean).join(" — ") };
  });
}

// ---- NỘI THẤT: giá các PHẦN VIỆC đã duyệt ở hồ sơ nội thất KHÁC của cùng hợp đồng (chưa có hợp đồng: cùng dự án) ----
// Khớp theo mã sản phẩm (không có mã thì tên sản phẩm) + tên phần việc. Trả về:
//  - refAppr: dòng REF (phần việc khác) của hồ sơ này → giá đã duyệt ở hồ sơ kia (thay cho giá dự kiến QSĐT gõ)
//  - extra:   dòng SP (sản phẩm) của hồ sơ này → các phần việc đã duyệt ở hồ sơ khác mà hồ sơ này không có dòng (hiện thêm để thấy đủ giá trị sản phẩm)
export type NtContext = { refAppr: Record<string, NtAppr>; extra: Record<string, NtAppr[]> };
export async function ntContext(p: { id: string; isNt: boolean; contractId: string | null; projectName: string; lines: { id: string; level: string; code: string; content: string }[] }): Promise<NtContext> {
  const out: NtContext = { refAppr: {}, extra: {} };
  if (!p.isNt || (!p.contractId && !p.projectName.trim())) return out;
  const others = await prisma.subProposal.findMany({
    where: { isNt: true, status: "APPROVED", id: { not: p.id }, ...(p.contractId ? { contractId: p.contractId } : { projectName: p.projectName }) },
    orderBy: { tpAt: "asc" }, // duyệt sau thì đè giá duyệt trước
    select: {
      id: true, code: true, subName: true, selectedBidder: true,
      lines: { orderBy: { orderIndex: "asc" }, select: { level: true, code: true, content: true, unit: true, cdtQty: true, cdtPrice: true, baseQty: true, basePrice: true, bids: true, propQty: true, propPrice: true, tpPrice: true, tpOk: true } },
    },
  });
  if (!others.length) return out;
  // giá duyệt của từng phần việc: khoá (sản phẩm | phần việc) → giá
  const appr = new Map<string, NtAppr>();
  const byProduct = new Map<string, string[]>(); // sản phẩm → các khoá phần việc (giữ thứ tự)
  for (const o of others) {
    const own = spOwnerOf(o.lines);
    o.lines.forEach((l, i) => {
      if (l.level !== "ITEM" || own[i] < 0 || !l.tpOk) return;
      const pk = ntProductKey(o.lines[own[i]]);
      const k = ntPartKey(pk, l.content);
      const n = toNums(l);
      if (!appr.has(k)) byProduct.set(pk, [...(byProduct.get(pk) ?? []), k]);
      appr.set(k, { code: o.code, proposalId: o.id, sub: o.subName, name: l.content, unit: l.unit, qty: propQtyOf(n, o.selectedBidder), price: apprPriceOf(n, o.selectedBidder) });
    });
  }
  const own = spOwnerOf(p.lines);
  const seen = new Map<number, Set<string>>(); // dòng SP → các khoá phần việc hồ sơ này đã có dòng
  p.lines.forEach((l, i) => {
    if (own[i] < 0) return;
    const k = ntPartKey(ntProductKey(p.lines[own[i]]), l.content);
    seen.set(own[i], (seen.get(own[i]) ?? new Set<string>()).add(k));
    const a = appr.get(k);
    if (a && l.level === "REF") out.refAppr[l.id] = a;
  });
  p.lines.forEach((l, i) => {
    if (l.level !== "SP") return;
    const have = seen.get(i) ?? new Set<string>();
    const list = (byProduct.get(ntProductKey(l)) ?? []).filter((k) => !have.has(k)).map((k) => appr.get(k)!);
    if (list.length) out.extra[l.id] = list;
  });
  return out;
}
