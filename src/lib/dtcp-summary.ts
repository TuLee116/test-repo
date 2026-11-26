import { prisma } from "@/lib/prisma";
import { controlVersion } from "@/lib/hop-dong";
import { parsePrices, priceAt } from "@/lib/hop-dong-calc";
import { normName } from "@/lib/project-site-calc";

// GIÁ TRỊ THEO DT-CP của từng hợp đồng (BẢNG TỔNG HỢP trang thầu phụ / đội thi công), tại THỜI ĐIỂM KIỂM SOÁT (đã duyệt),
// đọc ở bảng "DOANH THU - CHI PHÍ" của sheet DT-CP — các file DT-CP ghi SAU VAT ("Thành tiền (Có VAT)", "Giá trị sau thuế"):
// - revenue: dòng "A. DOANH THU" (trống thì dòng ngay dưới, VD "Hợp đồng")
// - tp: dòng "4. Thầu phụ" · nc: dòng "5.1 Nhân công giao khoán"
// Sheet không có dòng đó thì cộng TH Thầu Phụ / TH Nhân Công (khối lượng × đơn giá thời điểm kiểm soát) — src = "TH".
// (bổ sung 25/11 cho TỔNG QUAN QUẢN LÝ HỢP ĐỒNG) vt: dòng "Vật tư" (không có thì "Vật tư chính" + "Vật tư phụ") · tb: dòng "Thiết bị"
// · cost: dòng "B. CHI PHÍ" (tổng chi phí). Thiếu vt / tb thì cộng TH Vật Tư / TH Thiết Bị (src = "TH").
type Src = "DTCP" | "TH" | "";
export type DtcpTotals = { revenue: number | null; tp: number | null; nc: number | null; tpSrc: Src; ncSrc: Src; vt: number | null; tb: number | null; vtSrc: Src; tbSrc: Src; cost: number | null };

const TTL = 10 * 60 * 1000;
const cache = new Map<string, { at: number; v: DtcpTotals }>();

type Cell = unknown;
const cellVal = (c: Cell): unknown => {
  if (!c || typeof c !== "object") return c;
  const o = c as Record<string, unknown>;
  return o.v ?? o.r ?? o.t ?? null;
};
const num = (c: Cell): number | null => {
  const v = cellVal(c);
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?[\d.,]+$/.test(v.trim())) {
    const n = Number(v.trim().replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const txt = (c: Cell) => normName(String(cellVal(c) ?? ""));

// đọc bảng "DOANH THU - CHI PHÍ" từ bản chụp sheet DT-CP ({rows: [{c: [...]}]}); version = thời điểm kiểm soát
// (cột "THỜI ĐIỂM n…" thứ n trên dòng tiêu đề, thiếu thì cột cuối; không có tiêu đề thì số đầu tiên sau nhãn)
type SheetTotals = { revenue: number | null; tp: number | null; nc: number | null; vt: number | null; tb: number | null; cost: number | null };
export function readDtcpSheet(json: string, version: number): SheetTotals {
  const out: SheetTotals = { revenue: null, tp: null, nc: null, vt: null, tb: null, cost: null };
  let vtMain: number | null = null;
  let vtSub: number | null = null;
  let rows: Cell[][] = [];
  try {
    const o = JSON.parse(json) as { rows?: { c?: Cell[] }[] } | Cell[][];
    rows = Array.isArray(o) ? (o as Cell[][]) : (o.rows ?? []).map((r) => (Array.isArray(r) ? (r as Cell[]) : (r.c ?? [])));
  } catch {
    return out;
  }
  let tdCols: number[] = [];
  for (const r of rows.slice(0, 40)) {
    const cols = r.map((c, i) => (/^thoi diem( \d+)?( |$)/.test(txt(c)) ? i : -1)).filter((i) => i >= 0);
    if (cols.length) {
      tdCols = cols;
      break;
    }
  }
  const col = tdCols.length ? tdCols[Math.min(Math.max(version, 1), tdCols.length) - 1] : -1;
  const label = (r: Cell[]) => {
    for (let i = 0; i < Math.min(r.length, 5); i++) {
      const t = txt(r[i]);
      if (t && !/^([a-z]|[ivx]+|[\d ]+)$/.test(t)) return { t, i }; // bỏ ô STT (A, I, 4, 4.1.1)
    }
    return null;
  };
  const valueOf = (r: Cell[], at: number): number | null => {
    if (col >= 0) return num(r[col]);
    for (let i = at + 1; i < r.length; i++) {
      const n = num(r[i]);
      if (n != null) return n;
    }
    return null;
  };
  let seenRevenue = false;
  for (let k = 0; k < rows.length; k++) {
    const lb = label(rows[k]);
    if (!lb) continue;
    if (lb.t === "doanh thu" && !seenRevenue) {
      seenRevenue = true;
      out.revenue = valueOf(rows[k], lb.i);
      // dòng DOANH THU trống (file QN): lấy dòng ngay dưới (VD "Hợp đồng")
      for (let j = k + 1; !out.revenue && j < Math.min(rows.length, k + 4); j++) {
        const lj = label(rows[j]);
        if (!lj || lj.t === "chi phi") break;
        out.revenue = valueOf(rows[j], lj.i);
      }
    } else if (lb.t === "thau phu" && out.tp == null) out.tp = valueOf(rows[k], lb.i);
    else if (lb.t === "nhan cong giao khoan" && out.nc == null) out.nc = valueOf(rows[k], lb.i);
    else if ((lb.t === "vat tu" || lb.t === "vat lieu") && out.vt == null) out.vt = valueOf(rows[k], lb.i);
    else if (lb.t === "vat tu chinh" && vtMain == null) vtMain = valueOf(rows[k], lb.i);
    else if (lb.t === "vat tu phu" && vtSub == null) vtSub = valueOf(rows[k], lb.i);
    else if ((lb.t === "thiet bi" || lb.t === "may thi cong") && out.tb == null) out.tb = valueOf(rows[k], lb.i);
    else if (lb.t === "chi phi" && seenRevenue && out.cost == null) out.cost = valueOf(rows[k], lb.i);
  }
  if (out.vt == null && (vtMain != null || vtSub != null)) out.vt = (vtMain ?? 0) + (vtSub ?? 0);
  return out;
}

const lineSum = (lines: { qty: number | null; prices: string; amount: number | null }[], v: number) => {
  if (!lines.length) return null;
  return lines.reduce((t, l) => {
    const p = priceAt(parsePrices(l.prices), v);
    return t + (l.qty != null && p != null ? l.qty * p : (l.amount ?? 0));
  }, 0);
};

export async function dtcpTotals(ids: string[]): Promise<Map<string, DtcpTotals>> {
  const out = new Map<string, DtcpTotals>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return out;
  const cs = await prisma.costContract.findMany({ where: { id: { in: uniq } }, select: { id: true, updatedAt: true, approvedVersion: true, versions: true } });
  const now = Date.now();
  const need: typeof cs = [];
  for (const c of cs) {
    const hit = cache.get(`${c.id}:${c.updatedAt.getTime()}:${c.approvedVersion}`);
    if (hit && now - hit.at < TTL) out.set(c.id, hit.v);
    else need.push(c);
  }
  if (!need.length) return out;
  const nIds = need.map((c) => c.id);
  const [sheets, lines] = await Promise.all([
    prisma.costSheet.findMany({ where: { contractId: { in: nIds }, role: "DTCP" }, orderBy: { orderIndex: "asc" }, select: { contractId: true, rows: true } }),
    prisma.costLine.findMany({ where: { contractId: { in: nIds }, kind: { in: ["TP", "NC", "VT", "TB"] }, level: "ITEM" }, select: { contractId: true, kind: true, qty: true, prices: true, amount: true } }),
  ]);
  for (const c of need) {
    const v = controlVersion(c);
    const sh = sheets.find((s) => s.contractId === c.id);
    const mine = lines.filter((l) => l.contractId === c.id);
    const d: SheetTotals = sh ? readDtcpSheet(sh.rows, v) : { revenue: null, tp: null, nc: null, vt: null, tb: null, cost: null };
    const th = (k: string, have: number | null) => (have == null ? lineSum(mine.filter((l) => l.kind === k), v) : null);
    const thTp = th("TP", d.tp);
    const thNc = th("NC", d.nc);
    const thVt = th("VT", d.vt);
    const thTb = th("TB", d.tb);
    const t: DtcpTotals = {
      revenue: d.revenue,
      tp: d.tp ?? thTp,
      nc: d.nc ?? thNc,
      tpSrc: d.tp != null ? "DTCP" : thTp != null ? "TH" : "",
      ncSrc: d.nc != null ? "DTCP" : thNc != null ? "TH" : "",
      vt: d.vt ?? thVt,
      tb: d.tb ?? thTb,
      vtSrc: d.vt != null ? "DTCP" : thVt != null ? "TH" : "",
      tbSrc: d.tb != null ? "DTCP" : thTb != null ? "TH" : "",
      cost: d.cost,
    };
    cache.set(`${c.id}:${c.updatedAt.getTime()}:${c.approvedVersion}`, { at: now, v: t });
    out.set(c.id, t);
  }
  return out;
}
