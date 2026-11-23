import Link from "next/link";
import { getContracts } from "@/lib/data";
import { FilterBar, PageHeader, Table } from "@/components/ui";
import GiaDoiNav from "@/components/GiaDoiNav";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();

export default async function ContractList({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = norm(sp.q ?? "");
  const all = getContracts();
  const byId = new Map(all.map((c) => [c.id, c]));
  const rows = all
    .filter((c) => (!sp.area || c.area === sp.area) && (!q || norm(`${c.name} ${c.packageName} ${c.contractNo} ${c.appendixNo}`).includes(q)))
    .sort((a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader title="Hợp đồng & sổ giá" sub={`${rows.length} hợp đồng / phụ lục`} />
      <GiaDoiNav active="/gia-doi/hop-dong" />
      <FilterBar>
        <label>Tìm<input name="q" defaultValue={sp.q} placeholder="Dự án, gói thầu, số HĐ…" /></label>
        <label>
          Khu vực
          <select name="area" defaultValue={sp.area ?? ""}>
            <option value="">Tất cả</option>
            {["1", "2", "3", "4", "5"].map((a) => <option key={a} value={a}>Khu vực {a}</option>)}
          </select>
        </label>
      </FilterBar>
      <Table head={["KV", "Dự án", "Gói thầu", "Số HĐ", "Nguồn", "Số dòng giá", "Thời điểm giá"]}>
        {rows.map((c) => (
          <tr key={c.id}>
            <td>{c.area}</td>
            <td className="font-medium">{c.name}</td>
            <td>
              <Link href={`/gia-doi/hop-dong/${c.id}`} className="text-blue-800 hover:underline">
                {c.appendixNo ? `↳ ${c.appendixNo} · ` : ""}{c.packageName}
              </Link>
              {c.appendixOfId && <div className="text-xs text-slate-500">Phụ lục của {byId.get(c.appendixOfId)?.contractNo}</div>}
            </td>
            <td className="text-xs">{c.contractNo}</td>
            <td className="text-xs">{c.source === "EXCEL" ? "DT-CP Excel (HĐ cũ)" : c.source}</td>
            <td className="text-right tabular-nums">{c.lineCount}</td>
            <td className="text-right tabular-nums">{c.versionCount}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
