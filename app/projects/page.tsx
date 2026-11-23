import Link from "next/link";
import { getStats } from "@/lib/data";
import { money, pct, short, PACKAGE_TYPE } from "@/lib/format";
import { Card, FilterBar, Kpi, PageHeader, Table } from "@/components/ui";

const AREAS = ["1", "2", "3", "4", "5"];
const PARTS = [
  { k: "vl", label: "Vật tư", color: "bg-blue-600" },
  { k: "nc", label: "Nhân công", color: "bg-amber-500" },
  { k: "m", label: "Thiết bị / Máy", color: "bg-teal-600" },
  { k: "tp", label: "Thầu phụ", color: "bg-violet-600" },
  { k: "other", label: "Chi phí khác", color: "bg-slate-400" },
] as const;

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const all = getStats();
  const stats = all.filter(
    (s) => (!sp.area || s.area === sp.area) && (!sp.creator || s.creator === sp.creator) && (!sp.project || s.name === sp.project),
  );
  const revenue = stats.reduce((a, s) => a + s.revenue, 0);
  const cost = stats.reduce((a, s) => a + s.cost, 0);
  const parts = PARTS.map((p) => ({ ...p, v: stats.reduce((a, s) => a + s.parts[p.k], 0) }));
  const direct = parts.reduce((a, p) => a + p.v, 0);
  const maxArea = Math.max(1, ...AREAS.map((a) => stats.filter((s) => s.area === a).reduce((x, s) => Math.max(x, s.revenue, s.cost), 0)));
  const uniq = (f: (s: (typeof all)[number]) => string) => [...new Set(all.map(f))].sort();

  return (
    <>
      <PageHeader title="Tổng quan dự án" sub="Mỗi gói thầu là 1 DT-CP. Mở từng hợp đồng ở cụm DT-CP của menu bên trái: Khu vực → Dự án → Hợp đồng." />
      <FilterBar>
        <label>
          Khu vực
          <select name="area" defaultValue={sp.area ?? ""}>
            <option value="">Tất cả</option>
            {AREAS.map((a) => (
              <option key={a} value={a}>Khu vực {a}</option>
            ))}
          </select>
        </label>
        <label>
          Dự án
          <select name="project" defaultValue={sp.project ?? ""}>
            <option value="">Tất cả</option>
            {uniq((s) => s.name).map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          Người thực hiện
          <select name="creator" defaultValue={sp.creator ?? ""}>
            <option value="">Tất cả</option>
            {uniq((s) => s.creator).map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <Link href="/projects" className="py-1 text-xs text-blue-700 hover:underline">Xoá lọc</Link>
      </FilterBar>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Kpi label="Số DT-CP" value={String(stats.length)} sub={`${new Set(stats.map((s) => s.area)).size} khu vực có DT-CP`} />
        <Kpi label="Doanh thu (trước VAT)" value={short(revenue)} sub={`${money(revenue)} đ`} />
        <Kpi label="Chi phí" value={short(cost)} sub={`${pct(cost, revenue)} doanh thu`} />
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-2">
        <Card>
          <div className="mb-2 text-sm font-medium">Doanh thu và chi phí theo khu vực</div>
          <div className="mb-2 flex gap-3 text-xs text-slate-500">
            <span><i className="mr-1 inline-block h-2 w-3 bg-blue-600" />Doanh thu</span>
            <span><i className="mr-1 inline-block h-2 w-3 bg-rose-500" />Chi phí</span>
          </div>
          <div className="space-y-3">
            {AREAS.map((a) => {
              const ss = stats.filter((s) => s.area === a);
              const r = ss.reduce((x, s) => x + s.revenue, 0);
              const c = ss.reduce((x, s) => x + s.cost, 0);
              return (
                <div key={a}>
                  <div className="flex justify-between text-xs">
                    <span className="font-medium">Khu vực {a}</span>
                    <span className="text-slate-500">{ss.length} DT-CP · Doanh thu {short(r) || "0"} · Chi phí {short(c) || "0"}</span>
                  </div>
                  <div className="mt-1 h-2 rounded bg-slate-100"><div className="h-2 rounded bg-blue-600" style={{ width: `${(r / maxArea) * 100}%` }} /></div>
                  <div className="mt-0.5 h-2 rounded bg-slate-100"><div className="h-2 rounded bg-rose-500" style={{ width: `${(c / maxArea) * 100}%` }} /></div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card>
          <div className="mb-2 text-sm font-medium">Cơ cấu chi phí trực tiếp · Tổng {short(direct)}</div>
          <div className="mb-3 flex h-3 overflow-hidden rounded">
            {parts.map((p) => (
              <div key={p.k} className={p.color} style={{ width: pct(p.v, direct).replace(",", ".") }} title={p.label} />
            ))}
          </div>
          <ul className="space-y-1 text-sm">
            {parts.map((p) => (
              <li key={p.k} className="flex items-center gap-2">
                <i className={`inline-block h-2.5 w-2.5 rounded-sm ${p.color}`} />
                <span className="flex-1">{p.label}</span>
                <span className="tabular-nums">{short(p.v) || "0"} · {pct(p.v, direct)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Table head={["Dự án / Gói thầu", "Loại", "KV", "Người thực hiện", "Năm", "Doanh thu", "Chi phí", "% CP/DT"]}>
        {stats.map((s) => (
          <tr key={s.id}>
            <td>
              <Link href={`/projects/${s.id}`} className="font-medium text-blue-800 hover:underline">{s.name}</Link>
              <div className="text-xs text-slate-500">{s.packageName}</div>
            </td>
            <td className="text-xs">{PACKAGE_TYPE[s.packageType] ?? s.packageType}</td>
            <td>{s.area}</td>
            <td className="text-xs">{s.creator}</td>
            <td>{s.year}</td>
            <td className="text-right tabular-nums">{money(s.revenue)}</td>
            <td className="text-right tabular-nums">{money(s.cost)}</td>
            <td className="text-right tabular-nums">{pct(s.cost, s.revenue)}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
