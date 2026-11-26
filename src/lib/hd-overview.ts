import { prisma } from "@/lib/prisma";
import { dtcpTotals, type DtcpTotals } from "@/lib/dtcp-summary";
import { apprAmountOf, savedTotals } from "@/lib/gia-doi-calc";
import { amt, apprPriceOf, extraSum, noMgmtFlags, parseExtras, parseJson, parseSavedTotals, parseVatRows, propQtyOf, totalsOf, withSaved } from "@/lib/thau-phu-calc";
import { toNums } from "@/lib/thau-phu";

// TỔNG QUAN QUẢN LÝ HỢP ĐỒNG (anh chốt 25/11/2026) — 1 hợp đồng GỐC + các phụ lục của nó, theo từng khoản chi phí:
//   Giá trị theo DT-CP (HĐ gốc + PL đã duyệt) · PL đang trình · Đã duyệt (vật tư: Lũy kế đơn hàng) · Đã nhận hàng · Đã thanh toán
//   · Dự kiến quyết toán · Chênh lệch · Trạng thái (đèn).
// Từ ngữ: KHÔNG dùng "ngân sách" / "cam kết". Mọi số SAU VAT (cùng gốc bảng DOANH THU - CHI PHÍ của DT-CP).
// Nguồn: DT-CP (dtcp-summary) · Vật tư = đơn hàng PTGĐ đã duyệt ở phân hệ Mua vật tư (chỉ DT-CP lập trên phần mềm có) ·
// Thầu phụ = hồ sơ trình giá thầu phụ đã duyệt · Nhân công = hồ sơ giá đội đã duyệt · Thiết bị: chưa có dữ liệu.
// % hoàn thành = lũy kế NGHIỆM THU CĐT (người dùng nhập, OwnerAcceptance) / doanh thu (HĐ + PL đã duyệt).
// "Thi công giao khoán" = Thầu phụ + Nhân công: giao qua lại giữa thầu phụ và tổ đội không làm sai trạng thái.

export type Light = "OK" | "WARN" | "RED_PL" | "RED" | "NA";
export type KhoanKey = "VT" | "GK" | "TP" | "NC" | "TB" | "KHAC";
export type Khoan = {
  key: KhoanKey;
  label: string;
  sub: boolean; // dòng con (Thầu phụ / Nhân công dưới Thi công giao khoán)
  dtcp: number | null; // Giá trị theo DT-CP (HĐ gốc + PL đã duyệt)
  src: string; // "TH" = không đọc được ở sheet DT-CP, cộng sheet TH
  plPending: number; // phụ lục đang trình (chưa duyệt)
  approved: number | null; // Đã duyệt / Lũy kế đơn hàng (null = chưa có nguồn dữ liệu)
  received: number | null; // Đã nhận hàng / đã nghiệm thu
  paid: number | null; // Đã thanh toán
  forecast: number | null; // Dự kiến quyết toán
  diff: number | null; // Giá trị theo DT-CP − Dự kiến quyết toán (âm = vượt)
  pct: number | null; // đã duyệt / giá trị theo DT-CP
  light: Light;
  note: string;
  docs: number; // số hồ sơ đã duyệt
  waiting: number; // số hồ sơ đang trình
};
export type Acceptance = { id: string; period: string; date: string | null; value: number; note: string; by: string };
export type Overview = {
  id: string;
  name: string;
  packageName: string;
  contractNo: string;
  area: string;
  source: string;
  site: { code: string; name: string; cluster: string; clusterName: string } | null;
  revenue: { base: number | null; pl: number; plPending: number; eff: number | null };
  costEff: number | null; // chi phí theo DT-CP (HĐ + PL đã duyệt)
  forecast: number | null; // dự kiến quyết toán (tổng)
  profitPlan: number | null;
  profitForecast: number | null;
  done: { total: number; pct: number | null };
  acceptances: Acceptance[];
  appendices: { id: string; appendixNo: string; approved: boolean; revenue: number | null; cost: number | null }[];
  rows: Khoan[];
  worst: Light;
  redCount: number;
};

export const LIGHT: Record<Light, { label: string; cls: string; bar: string }> = {
  OK: { label: "Xanh", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", bar: "bg-emerald-400" },
  WARN: { label: "Vàng · sắp hết", cls: "bg-amber-50 text-amber-700 ring-amber-200", bar: "bg-amber-400" },
  RED_PL: { label: "Đỏ · có PL đang trình", cls: "bg-orange-50 text-orange-700 ring-orange-200", bar: "bg-orange-400" },
  RED: { label: "Đỏ · chưa có PL", cls: "bg-red-50 text-red-700 ring-red-200", bar: "bg-red-400" },
  NA: { label: "Chưa có số liệu", cls: "bg-slate-50 text-slate-500 ring-slate-200", bar: "bg-slate-300" },
};
const RANK: Record<Light, number> = { NA: 0, OK: 1, WARN: 2, RED_PL: 3, RED: 4 };
const WARN_AT = 0.9; // đã duyệt ≥ 90% giá trị theo DT-CP → vàng
const AHEAD = 0.25; // đã duyệt đi trước % hoàn thành quá 25 điểm → ghi chú

// GIÁ TRỊ ĐÃ DUYỆT của 1 hồ sơ thầu phụ = SAU THUẾ (giống bảng tổng hợp trang Trình giá thầu phụ)
type SubForValue = {
  selectedBidder: string;
  prelim: string;
  vat: string;
  extraRows: string;
  vatRows: string;
  totalAmounts: string;
  lines: { level: string; noMgmt: boolean; cdtQty: number | null; cdtPrice: number | null; baseQty: number | null; basePrice: number | null; bids: string; propQty: number | null; propPrice: number | null; tpPrice: number | null; tpOk: boolean }[];
};
export function subApprovedValue(p: SubForValue): number {
  const skip = noMgmtFlags(p.lines);
  let sum = 0;
  let noPrelim = 0;
  p.lines.forEach((l, i) => {
    if (l.level !== "ITEM") return;
    const a = amt(propQtyOf(toNums(l), p.selectedBidder), apprPriceOf(toNums(l), p.selectedBidder)) ?? 0;
    sum += a;
    if (skip[i]) noPrelim += a;
  });
  const prelim = parseJson<Record<string, number>>(p.prelim, {});
  const vat = parseJson<Record<string, number>>(p.vat, {});
  return withSaved(totalsOf(sum, prelim.D ?? 0, vat.D ?? 0, extraSum(parseExtras(p.extraRows), "D"), parseVatRows(p.vatRows), "D", noPrelim), (({ R, D }) => R ?? D)(parseSavedTotals(p.totalAmounts))).afterVat;
}
const SUB_SELECT = {
  contractId: true, status: true, selectedBidder: true, prelim: true, vat: true, extraRows: true, vatRows: true, totalAmounts: true,
  lines: { orderBy: { orderIndex: "asc" as const }, select: { level: true, noMgmt: true, cdtQty: true, cdtPrice: true, baseQty: true, basePrice: true, bids: true, propQty: true, propPrice: true, tpPrice: true, tpOk: true } },
};

// GIÁ TRỊ ĐÃ DUYỆT của 1 hồ sơ giá đội (giống bảng tổng hợp trang Hồ sơ giá đội)
type PriceForValue = {
  kind: string;
  totalAmounts: string;
  lines: { level: string; qty: number | null; basePrice: number | null; siteOpinion: string; sitePrice: number | null; ptOpinion: string; ptPrice: number | null; tpPrice: number | null; tpOk: boolean; formulas: string; siteAmount: number | null; tpAmount: number | null }[];
};
function priceApprovedValue(x: PriceForValue): number {
  const saved = savedTotals(x.totalAmounts).appr;
  if (saved != null) return saved;
  return x.lines.filter((l) => l.level === "ITEM").reduce((a, l) => a + (apprAmountOf(x.kind, l) ?? 0), 0);
}

const add = (a: number | null, b: number | null) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));

export async function loadOverviews(rootIds: string[]): Promise<Map<string, Overview>> {
  const out = new Map<string, Overview>();
  const ids = [...new Set(rootIds.filter(Boolean))];
  if (!ids.length) return out;
  const [roots, apps] = await Promise.all([
    prisma.costContract.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, packageName: true, contractNo: true, area: true, source: true, projectId: true, site: { select: { code: true, name: true, cluster: true, clusterName: true } } },
    }),
    prisma.costContract.findMany({ where: { appendixOfId: { in: ids } }, orderBy: { appendixNo: "asc" }, select: { id: true, appendixOfId: true, appendixNo: true, approvedVersion: true, projectId: true } }),
  ]);
  const all = [...roots.map((r) => r.id), ...apps.map((a) => a.id)];
  const rootOf = new Map<string, string>([...roots.map((r) => [r.id, r.id] as const), ...apps.map((a) => [a.id, a.appendixOfId!] as const)]);
  const projRoot = new Map<string, string>();
  for (const r of roots) if (r.projectId) projRoot.set(r.projectId, r.id);
  for (const a of apps) if (a.projectId) projRoot.set(a.projectId, a.appendixOfId!);
  const projIds = [...projRoot.keys()];

  const [totals, subs, prices, pos, pays, accs] = await Promise.all([
    dtcpTotals(all),
    prisma.subProposal.findMany({ where: { contractId: { in: all }, status: { not: "REJECTED" } }, select: SUB_SELECT }),
    prisma.priceSubmission.findMany({
      where: { contractId: { in: all }, status: { not: "REJECTED" } },
      select: { contractId: true, status: true, kind: true, totalAmounts: true, lines: { select: { level: true, qty: true, basePrice: true, siteOpinion: true, sitePrice: true, ptOpinion: true, ptPrice: true, tpPrice: true, tpOk: true, formulas: true, siteAmount: true, tpAmount: true } } },
    }),
    projIds.length
      ? prisma.purchaseOrder.findMany({
          where: { projectId: { in: projIds }, status: { not: "CANCELLED" } },
          select: { projectId: true, status: true, items: { select: { quantity: true, selectedQuoteId: true, quoteLines: { select: { quotationId: true, unitPrice: true, quotation: { select: { vatRate: true } } } }, receiptLines: { select: { quantity: true } } } } },
        })
      : Promise.resolve([]),
    projIds.length ? prisma.payment.findMany({ where: { payable: { projectId: { in: projIds } } }, select: { amount: true, payable: { select: { projectId: true } } } }) : Promise.resolve([]),
    prisma.ownerAcceptance.findMany({ where: { contractId: { in: ids } }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
  ]);

  type Acc = { tp: number; nc: number; tpN: number; ncN: number; tpW: number; ncW: number; vt: number; vtRecv: number; vtPaid: number; vtN: number; vtW: number };
  const acc = new Map<string, Acc>(ids.map((id) => [id, { tp: 0, nc: 0, tpN: 0, ncN: 0, tpW: 0, ncW: 0, vt: 0, vtRecv: 0, vtPaid: 0, vtN: 0, vtW: 0 }]));
  for (const p of subs) {
    const a = acc.get(rootOf.get(p.contractId!) ?? "");
    if (!a) continue;
    if (p.status === "APPROVED") {
      a.tp += subApprovedValue(p);
      a.tpN++;
    } else a.tpW++;
  }
  for (const x of prices) {
    const a = acc.get(rootOf.get(x.contractId!) ?? "");
    if (!a) continue;
    if (x.status === "APPROVED") {
      a.nc += priceApprovedValue(x);
      a.ncN++;
    } else a.ncW++;
  }
  const APPROVED_PO = new Set(["APPROVED", "ORDERED", "DONE"]);
  for (const o of pos) {
    const a = acc.get(projRoot.get(o.projectId) ?? "");
    if (!a) continue;
    if (!APPROVED_PO.has(o.status)) {
      a.vtW++;
      continue;
    }
    a.vtN++;
    for (const it of o.items) {
      const q = it.quoteLines.find((l) => l.quotationId === it.selectedQuoteId);
      const price = q ? q.unitPrice * (1 + (q.quotation.vatRate ?? 0)) : 0;
      a.vt += it.quantity * price;
      a.vtRecv += it.receiptLines.reduce((t, r) => t + r.quantity, 0) * price;
    }
  }
  for (const p of pays) {
    const a = acc.get(projRoot.get(p.payable.projectId) ?? "");
    if (a) a.vtPaid += p.amount;
  }

  for (const r of roots) {
    const t0 = totals.get(r.id);
    const mine = apps.filter((a) => a.appendixOfId === r.id);
    const ok = mine.filter((a) => a.approvedVersion > 0);
    const wait = mine.filter((a) => a.approvedVersion <= 0);
    const pick = (t: DtcpTotals | undefined, k: "revenue" | "vt" | "tp" | "nc" | "tb" | "cost") => (t ? t[k] : null);
    const effOf = (k: "revenue" | "vt" | "tp" | "nc" | "tb" | "cost") => ok.reduce<number | null>((s, a) => add(s, pick(totals.get(a.id), k)), pick(t0, k));
    const pendOf = (k: "revenue" | "vt" | "tp" | "nc" | "tb" | "cost") => wait.reduce((s, a) => s + (pick(totals.get(a.id), k) ?? 0), 0);
    const a = acc.get(r.id)!;
    const accList = accs.filter((x) => x.contractId === r.id);
    const doneTotal = accList.reduce((s, x) => s + x.value, 0);
    const revEff = effOf("revenue");
    const donePct = revEff && accList.length ? doneTotal / revEff : null;

    const mk = (key: KhoanKey, label: string, dtcp: number | null, src: string, plPending: number, approved: number | null, extra: Partial<Khoan> = {}): Khoan => {
      const forecast = approved == null ? dtcp : Math.max(dtcp ?? 0, approved);
      const pct = dtcp && approved != null ? approved / dtcp : null;
      let light: Light = "NA";
      if (dtcp != null && approved != null) {
        if (approved > dtcp * 1.0005) light = plPending > 0 ? "RED_PL" : "RED";
        else if (pct != null && pct >= WARN_AT) light = "WARN";
        else light = "OK";
      }
      let note = "";
      if (pct != null && donePct != null && pct - donePct > AHEAD && light !== "NA") note = `Đã duyệt đi trước tiến độ ${Math.round((pct - donePct) * 100)} điểm`;
      return { key, label, sub: false, dtcp, src, plPending, approved, received: null, paid: null, forecast, diff: dtcp != null && forecast != null ? dtcp - forecast : null, pct, light, note, docs: 0, waiting: 0, ...extra };
    };
    const srcOf = (k: "vtSrc" | "tpSrc" | "ncSrc" | "tbSrc") => (t0?.[k] === "TH" ? "TH" : "");
    const hasProc = !!r.projectId || mine.some((x) => x.projectId);
    const vt = mk("VT", "Vật tư", effOf("vt"), srcOf("vtSrc"), pendOf("vt"), hasProc ? a.vt : null, hasProc ? { received: a.vtRecv, paid: a.vtPaid, docs: a.vtN, waiting: a.vtW } : { note: "DT-CP nhập từ Excel: chưa có đơn hàng mua vật tư trên phần mềm" });
    const tp = { ...mk("TP", "Thầu phụ", effOf("tp"), srcOf("tpSrc"), pendOf("tp"), a.tp, { docs: a.tpN, waiting: a.tpW }), sub: true };
    const nc = { ...mk("NC", "Tổ đội (nhân công giao khoán)", effOf("nc"), srcOf("ncSrc"), pendOf("nc"), a.nc, { docs: a.ncN, waiting: a.ncW }), sub: true };
    const gk = mk("GK", "Thi công giao khoán", add(tp.dtcp, nc.dtcp), tp.src || nc.src, tp.plPending + nc.plPending, a.tp + a.nc, { docs: a.tpN + a.ncN, waiting: a.tpW + a.ncW });
    const tb = mk("TB", "Thiết bị", effOf("tb"), srcOf("tbSrc"), pendOf("tb"), null, { note: "Chưa có dữ liệu thuê / mua thiết bị trên phần mềm" });
    const costEff = effOf("cost");
    const known = [vt.dtcp, tp.dtcp, nc.dtcp, tb.dtcp].reduce<number | null>((s, v) => add(s, v), null);
    const khac = mk("KHAC", "Chi phí khác (chi phí chung, …)", costEff != null && known != null ? costEff - known : null, "", 0, null, { note: costEff == null ? "Không đọc được dòng CHI PHÍ ở sheet DT-CP" : "Chỉ có giá trị theo DT-CP" });
    const top = [vt, gk, tb];
    // dự kiến quyết toán = chi phí theo DT-CP + phần đã duyệt VƯỢT giá trị theo DT-CP ở từng khoản (giao khoán tính chung TP + NC)
    const over = top.reduce((s, k) => s + (k.approved == null ? 0 : Math.max(0, k.approved - (k.dtcp ?? 0))), 0);
    const costBase = costEff ?? known;
    const forecast = costBase != null ? costBase + over : null;
    const worst = top.reduce<Light>((w, k) => (RANK[k.light] > RANK[w] ? k.light : w), "NA");
    out.set(r.id, {
      id: r.id,
      name: r.name,
      packageName: r.packageName,
      contractNo: r.contractNo,
      area: r.area,
      source: r.source,
      site: r.site,
      revenue: { base: pick(t0, "revenue"), pl: ok.reduce((s, x) => s + (totals.get(x.id)?.revenue ?? 0), 0), plPending: pendOf("revenue"), eff: revEff },
      costEff: costBase,
      forecast,
      profitPlan: revEff != null && costBase != null ? revEff - costBase : null,
      profitForecast: revEff != null && forecast != null ? revEff - forecast : null,
      done: { total: doneTotal, pct: donePct },
      acceptances: accList.map((x) => ({ id: x.id, period: x.period, date: x.date ? x.date.toISOString().slice(0, 10) : null, value: x.value, note: x.note, by: x.createdByName })),
      appendices: mine.map((x) => ({ id: x.id, appendixNo: x.appendixNo || "(chưa ghi số PL)", approved: x.approvedVersion > 0, revenue: totals.get(x.id)?.revenue ?? null, cost: totals.get(x.id)?.cost ?? null })),
      rows: [vt, gk, tp, nc, tb, khac],
      worst,
      redCount: top.filter((k) => k.light === "RED" || k.light === "RED_PL").length,
    });
  }
  return out;
}
