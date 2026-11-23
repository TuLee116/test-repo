import Link from "next/link";
import { getThauPhuList } from "@/lib/data";
import { CATEGORY } from "@/lib/format";
import { FilterBar, PageHeader, Table } from "@/components/ui";
import GiaDoiNav from "@/components/GiaDoiNav";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();

export default async function ThauPhuList({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = norm(sp.q ?? "");
  const rows = getThauPhuList()
    .filter((r) => (!sp.area || r.area === sp.area) && (!sp.branch || r.branch === sp.branch))
    .filter((r) => !q || norm(`${r.no} ${r.projectName} ${r.itemName} ${r.subName} ${r.cdtContract} ${r.hdNo ?? ""}`).includes(q))
    .sort((a, b) => b.no.localeCompare(a.no));

  return (
    <>
      <PageHeader title="Trình giá thầu phụ" sub={`${rows.length} hồ sơ`} />
      <GiaDoiNav active="/gia-doi/thau-phu" />
      <FilterBar>
        <label>Tìm<input name="q" defaultValue={sp.q} placeholder="Số, công trình, thầu phụ…" /></label>
        <label>
          Khu vực
          <select name="area" defaultValue={sp.area ?? ""}>
            <option value="">Tất cả</option>
            {["1", "2", "3", "4", "5"].map((a) => <option key={a} value={a}>Khu vực {a}</option>)}
          </select>
        </label>
        <label>
          Nhánh
          <select name="branch" defaultValue={sp.branch ?? ""}>
            <option value="">Tất cả</option>
            {["A", "B"].map((a) => <option key={a} value={a}>Nhánh {a}</option>)}
          </select>
        </label>
      </FilterBar>
      <Table head={["Số", "Công trình / Hạng mục / Thầu phụ", "KV", "Nhánh", "Loại", "HĐ CĐT", "HĐ/PLHĐ thầu phụ"]}>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="whitespace-nowrap">
              <Link href={`/gia-doi/thau-phu/${r.id}`} className="font-medium text-blue-800 hover:underline">{r.no || "(chưa số)"}</Link>
              <div className="text-xs text-slate-500">lần {r.revision}</div>
            </td>
            <td>
              <div className="font-medium">{r.projectName}</div>
              <div className="text-xs text-slate-500">{r.itemName} · Thầu phụ: {r.subName || "—"}</div>
            </td>
            <td>{r.area}</td>
            <td>{r.branch}</td>
            <td className="text-xs">{CATEGORY[r.category] ?? r.category}</td>
            <td className="text-xs">{r.cdtContract}</td>
            <td className="text-xs">{r.hdNo ?? <span className="text-slate-400">chưa gắn hợp đồng</span>}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
