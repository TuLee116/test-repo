import Link from "next/link";
import { getCatalog } from "@/lib/data";
import { qty } from "@/lib/format";
import { FilterBar, PageHeader } from "@/components/ui";

const PAGE = 50;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
const CAT: Record<string, string> = { VT: "Vật tư", NC: "Nhân công", M: "Máy", TB: "Thiết bị" };

export default async function CatalogPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const all = getCatalog();
  const sections = [...new Set(all.map((r) => r.section))];
  const q = norm(sp.q ?? "");
  const rows = all.filter((r) => (!sp.section || r.section === sp.section) && (!q || norm(`${r.code} ${r.name}`).includes(q)));
  const page = Math.max(1, Number(sp.page) || 1);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const view = rows.slice((page - 1) * PAGE, page * PAGE);
  const link = (p: number) => `?${new URLSearchParams({ ...(sp.q && { q: sp.q }), ...(sp.section && { section: sp.section }), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Định mức" sub={`${rows.length} / ${all.length} định mức`} />
      <FilterBar>
        <label>Tìm<input name="q" defaultValue={sp.q} placeholder="Mã hoặc tên định mức" /></label>
        <label>
          Chương
          <select name="section" defaultValue={sp.section ?? ""} className="max-w-72">
            <option value="">Tất cả</option>
            {sections.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      </FilterBar>
      <div className="space-y-2">
        {view.map((r) => (
          <details key={r.id} className="rounded-lg border border-slate-200 bg-white">
            <summary className="flex cursor-pointer list-none gap-3 px-3 py-2 text-sm hover:bg-slate-50">
              <span className="w-28 shrink-0 font-mono text-xs text-blue-800">{r.code}</span>
              <span className="flex-1">{r.name}</span>
              <span className="text-xs text-slate-500">{r.unit}</span>
              <span className="text-xs text-slate-400">{r.lines.length} hao phí</span>
            </summary>
            <table className="mx-3 mb-2 w-[calc(100%-1.5rem)] text-xs">
              <tbody>
                {r.lines.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100">
                    <td className="py-1 text-slate-500">{CAT[l.category] ?? l.category}</td>
                    <td className="font-mono">{l.code}</td>
                    <td>{l.name}</td>
                    <td>{l.unit}</td>
                    <td className="text-right tabular-nums">{l.formula ?? qty(l.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-sm">
        {page > 1 && <Link href={link(page - 1)} className="rounded bg-white px-2 py-1 ring-1 ring-slate-200">← Trước</Link>}
        <span className="text-slate-500">Trang {page} / {pages}</span>
        {page < pages && <Link href={link(page + 1)} className="rounded bg-white px-2 py-1 ring-1 ring-slate-200">Sau →</Link>}
      </div>
    </>
  );
}
