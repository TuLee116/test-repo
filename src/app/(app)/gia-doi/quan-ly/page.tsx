import { Fragment } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getPriceUser } from "@/lib/gia-doi";
import { LIGHT, loadOverviews, type Khoan, type Light, type Overview } from "@/lib/hd-overview";
import { contractKey } from "@/lib/project-site-calc";
import { loadContractInfo } from "@/lib/project-site";

// QUẢN LÝ HỢP ĐỒNG — cộng dồn Khu vực → Cụm dự án → Dự án → Hợp đồng (hợp đồng gốc + phụ lục), cùng các cột với tab
// "Tổng quan quản lý" của từng hợp đồng. Bấm hợp đồng → tab Tổng quan quản lý. ?red=1: chỉ hợp đồng đỏ.
const AREA_NAME: Record<string, string> = { "1": "Đà Nẵng", "2": "Sài Gòn", "3": "Còn lại", "4": "Phú Quốc", "5": "Nhà tư" };
const areaLabel = (a: string) => (a ? `Khu vực ${a}${AREA_NAME[a] ? ` · ${AREA_NAME[a]}` : ""}` : "Chưa chọn khu vực");
const fm = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("vi-VN"));
const pc = (n: number | null | undefined) => (n == null ? "—" : `${(Math.round(n * 1000) / 10).toLocaleString("vi-VN")}%`);
const cmp = (a: string, b: string) => a.localeCompare(b, "vi", { numeric: true });
const RED: Light[] = ["RED", "RED_PL"];

type Sum = { rev: number; cost: number; fc: number; plan: number; done: number; n: number; red: number; revKnown: boolean };
const zero = (): Sum => ({ rev: 0, cost: 0, fc: 0, plan: 0, done: 0, n: 0, red: 0, revKnown: false });
function addTo(s: Sum, o: Overview) {
  s.n++;
  if (o.worst === "RED" || o.worst === "RED_PL") s.red++;
  if (o.revenue.eff != null) {
    s.rev += o.revenue.eff;
    s.revKnown = true;
  }
  s.cost += o.costEff ?? 0;
  s.fc += o.forecast ?? 0;
  s.done += o.done.total;
}

function KCell({ k }: { k: Khoan | undefined }) {
  if (!k) return <td />;
  return (
    <td className="px-2 py-1.5 text-right">
      <span className={`inline-block min-w-[64px] rounded px-1.5 py-0.5 text-[11px] tabular-nums ring-1 ${LIGHT[k.light].cls}`} title={`${k.label}: đã duyệt ${fm(k.approved)} / theo DT-CP ${fm(k.dtcp)} — ${LIGHT[k.light].label}`}>
        {k.pct == null ? (k.approved == null ? "chưa có" : "—") : pc(k.pct)}
      </span>
    </td>
  );
}

export default async function QuanLyHopDongPage({ searchParams }: { searchParams: Promise<{ red?: string; kv?: string }> }) {
  const sp = await searchParams;
  const u = (await getPriceUser())!;
  const roots = await prisma.costContract.findMany({ where: { appendixOfId: null, ...(u.areas ? { area: { in: [...u.areas, ""] } } : {}) }, select: { id: true } });
  const [ovs, cinfo] = await Promise.all([loadOverviews(roots.map((r) => r.id)), loadContractInfo()]);
  let list = [...ovs.values()];
  const areas = [...new Set(list.map((o) => o.area))].sort((a, b) => (a ? (b ? cmp(a, b) : -1) : 1));
  if (sp.kv) list = list.filter((o) => o.area === (sp.kv === "~" ? "" : sp.kv));
  if (sp.red === "1") list = list.filter((o) => RED.includes(o.worst));
  const codeOf = (o: Overview) => cinfo.get(contractKey(o.contractNo))?.code ?? "";

  // cây Khu vực → Cụm → Dự án → Hợp đồng
  type SiteG = { key: string; code: string; name: string; items: Overview[]; s: Sum };
  type CluG = { key: string; code: string; name: string; sites: Map<string, SiteG>; s: Sum };
  type AreaG = { area: string; clusters: Map<string, CluG>; s: Sum };
  const tree = new Map<string, AreaG>();
  for (const o of list) {
    const a = tree.get(o.area) ?? tree.set(o.area, { area: o.area, clusters: new Map(), s: zero() }).get(o.area)!;
    const ck = o.site?.cluster ?? "";
    const c = a.clusters.get(ck) ?? a.clusters.set(ck, { key: ck, code: ck, name: o.site?.clusterName ?? "", sites: new Map(), s: zero() }).get(ck)!;
    const sk = o.site ? `${o.site.code}|${o.site.name}` : `~${o.name}`;
    const g = c.sites.get(sk) ?? c.sites.set(sk, { key: sk, code: o.site?.code ?? "", name: o.site?.name ?? o.name, items: [], s: zero() }).get(sk)!;
    g.items.push(o);
    for (const s of [a.s, c.s, g.s]) addTo(s, o);
  }
  const total = zero();
  list.forEach((o) => addTo(total, o));
  const areaList = [...tree.values()].sort((x, y) => (x.area ? (y.area ? cmp(x.area, y.area) : -1) : 1));

  const th = "px-2 py-1.5 text-right font-medium";
  const td = "px-2 py-1.5 text-right tabular-nums";
  const sumCells = (s: Sum) => {
    const profit = s.revKnown ? s.rev - s.fc : null;
    return (
      <>
        <td className={td}>{s.revKnown ? fm(s.rev) : "—"}</td>
        <td className={td}>{fm(s.cost)}</td>
        <td className={`${td} ${s.fc > s.cost + 0.5 ? "text-red-700" : ""}`}>{fm(s.fc)}</td>
        <td className={`${td} ${profit != null && profit < 0 ? "text-red-700" : ""}`}>
          {fm(profit)}
          {profit != null && s.rev ? <span className="block text-[11px] text-slate-500">{pc(profit / s.rev)}</span> : null}
        </td>
        <td className={td}>{s.revKnown && s.done ? pc(s.done / s.rev) : "—"}</td>
        <td colSpan={2} className="px-2 py-1.5 text-right text-xs">
          {s.red ? <span className="text-red-700">{s.red}/{s.n} HĐ đỏ</span> : <span className="text-slate-500">{s.n} HĐ</span>}
        </td>
      </>
    );
  };
  const link = (q: Record<string, string>) => {
    const p = new URLSearchParams({ ...(sp.kv ? { kv: sp.kv } : {}), ...(sp.red ? { red: sp.red } : {}), ...q });
    for (const [k, v] of [...p]) if (!v) p.delete(k);
    const s = p.toString();
    return `/gia-doi/quan-ly${s ? `?${s}` : ""}`;
  };
  const chip = (on: boolean) => `rounded-full px-3 py-1 text-xs ${on ? "bg-slate-800 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={link({ kv: "" })} className={chip(!sp.kv)}>Tất cả khu vực</Link>
        {areas.map((a) => (
          <Link key={a || "~"} href={link({ kv: a || "~" })} className={chip(sp.kv === (a || "~"))}>{areaLabel(a)}</Link>
        ))}
        <span className="mx-1 text-slate-300">|</span>
        <Link href={link({ red: sp.red === "1" ? "" : "1" })} className={chip(sp.red === "1")}>Chỉ hợp đồng đỏ</Link>
      </div>
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="w-[30%] px-2 py-1.5 text-left font-medium">Khu vực / Cụm / Dự án / Hợp đồng</th>
                <th className={th}>Doanh thu</th>
                <th className={th}>Chi phí theo DT-CP</th>
                <th className={th}>Dự kiến quyết toán</th>
                <th className={th}>Lãi dự kiến</th>
                <th className={`${th} w-[7%]`}>Hoàn thành</th>
                <th className={`${th} w-[8%]`}>Vật tư</th>
                <th className={`${th} w-[8%]`}>Giao khoán</th>
              </tr>
            </thead>
            <tbody>
              {!list.length && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-sm text-slate-500">{sp.red === "1" ? "Không có hợp đồng đỏ 👍" : "Chưa có hợp đồng nào."}</td>
                </tr>
              )}
              {areaList.map((a) => (
                <Fragment key={a.area || "~"}>
                  <tr className="border-t border-sky-200 bg-sky-50 font-semibold text-sky-900">
                    <td className="px-2 py-1.5">{areaLabel(a.area)}</td>
                    {sumCells(a.s)}
                  </tr>
                  {[...a.clusters.values()]
                    .sort((x, y) => (x.code ? (y.code ? cmp(x.code, y.code) : -1) : 1))
                    .map((c) => (
                      <Fragment key={c.key || "~"}>
                        {c.code && (
                          <tr className="border-t border-violet-100 bg-violet-50/60 font-medium text-violet-900">
                            <td className="px-2 py-1.5 pl-5">
                              <span className="mr-1 text-xs text-violet-600">{c.code}</span>
                              {c.name || "Cụm dự án"}
                            </td>
                            {sumCells(c.s)}
                          </tr>
                        )}
                        {[...c.sites.values()]
                          .sort((x, y) => cmp(x.code || `~${x.name}`, y.code || `~${y.name}`))
                          .map((g) => (
                            <Fragment key={g.key}>
                              <tr className="border-t border-slate-100 bg-slate-50/70 font-medium text-slate-800">
                                <td className={`px-2 py-1.5 ${c.code ? "pl-8" : "pl-5"}`}>
                                  {g.code && <span className="mr-1 text-xs text-slate-500">{g.code}</span>}
                                  {g.name}
                                </td>
                                {sumCells(g.s)}
                              </tr>
                              {g.items
                                .sort((x, y) => cmp(codeOf(x) || `~${x.contractNo}`, codeOf(y) || `~${y.contractNo}`))
                                .map((o) => {
                                  const profit = o.profitForecast;
                                  const k = (key: string) => o.rows.find((r) => r.key === key);
                                  return (
                                    <tr key={o.id} className="border-t border-slate-100 hover:bg-amber-50/40">
                                      <td className={`px-2 py-1.5 ${c.code ? "pl-11" : "pl-8"}`}>
                                        <Link href={`/gia-doi/hop-dong/${o.id}`} className="text-sky-700 hover:underline">
                                          {codeOf(o) && <span className="mr-1 text-xs text-slate-500">{codeOf(o)}</span>}
                                          {o.contractNo ? `HĐ ${o.contractNo}` : "(chưa có số HĐ)"}
                                        </Link>
                                        {o.packageName && <span className="block truncate text-xs text-slate-500" title={o.packageName}>{o.packageName}</span>}
                                      </td>
                                      <td className={td}>{fm(o.revenue.eff)}</td>
                                      <td className={td}>{fm(o.costEff)}</td>
                                      <td className={`${td} ${o.forecast != null && o.costEff != null && o.forecast > o.costEff + 0.5 ? "text-red-700" : ""}`}>{fm(o.forecast)}</td>
                                      <td className={`${td} ${profit != null && o.profitPlan != null && profit < o.profitPlan - 1 ? "text-red-700" : ""}`}>
                                        {fm(profit)}
                                        {profit != null && o.revenue.eff ? <span className="block text-[11px] text-slate-500">{pc(profit / o.revenue.eff)}</span> : null}
                                      </td>
                                      <td className={td}>{pc(o.done.pct)}</td>
                                      <KCell k={k("VT")} />
                                      <KCell k={k("GK")} />
                                    </tr>
                                  );
                                })}
                            </Fragment>
                          ))}
                      </Fragment>
                    ))}
                </Fragment>
              ))}
              {list.length > 0 && (
                <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold">
                  <td className="px-2 py-1.5">Tổng cộng</td>
                  {sumCells(total)}
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
          <span>Vật tư / Giao khoán: % đã duyệt so với giá trị theo DT-CP, màu theo trạng thái (xanh · vàng ≥ 90% · đỏ vượt).</span>
          <span>Lãi dự kiến = Doanh thu − Dự kiến quyết toán. Hoàn thành = lũy kế nghiệm thu CĐT / doanh thu.</span>
          <span>Số liệu sau VAT, thời điểm kiểm soát của DT-CP; gồm phụ lục đã duyệt.</span>
        </div>
      </section>
    </div>
  );
}
