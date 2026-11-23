import Link from "next/link";
import { getGiaDoiList } from "@/lib/data";
import { KIND, money, STATUS } from "@/lib/format";
import { FilterBar, PageHeader, StatusBadge, Table } from "@/components/ui";
import GiaDoiNav from "@/components/GiaDoiNav";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();

export default async function GiaDoiList({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = norm(sp.q ?? "");
  const rows = getGiaDoiList()
    .filter((r) => (!sp.status || r.status === sp.status) && (!sp.kind || r.kind === sp.kind))
    .filter((r) => !q || norm(`${r.no} ${r.projectName} ${r.itemName} ${r.contractNo} ${r.batch}`).includes(q))
    .sort((a, b) => b.no.localeCompare(a.no));

  return (
    <>
      <PageHeader title="Hồ sơ giá đội" sub={`${rows.length} hồ sơ`} />
      <GiaDoiNav active="/gia-doi" />
      <FilterBar>
        <label>
          Tìm
          <input name="q" defaultValue={sp.q} placeholder="Số, công trình, HĐ…" />
        </label>
        <label>
          Trạng thái
          <select name="status" defaultValue={sp.status ?? ""}>
            <option value="">Tất cả</option>
            {Object.entries(STATUS).filter(([k]) => k !== "TPOK").map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </label>
        <label>
          Loại
          <select name="kind" defaultValue={sp.kind ?? ""}>
            <option value="">Tất cả</option>
            {Object.entries(KIND).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
      </FilterBar>
      <Table head={["Số", "Công trình / Hạng mục / Đợt", "Loại", "Giá trị đề xuất", "Giá trị duyệt", "Trạng thái"]}>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="whitespace-nowrap">
              <Link href={`/gia-doi/${r.id}`} className="font-medium text-blue-800 hover:underline">{r.no || "(chưa số)"}</Link>
              {r.revision > 1 && <div className="text-xs text-slate-500">lần {r.revision}</div>}
            </td>
            <td>
              <div className="font-medium">{r.projectName}</div>
              <div className="text-xs text-slate-500">
                {r.itemName} · Đợt {r.batch} {r.batchDate && `(${r.batchDate})`} · HĐ {r.contractNo}
              </div>
            </td>
            <td className="text-xs">{KIND[r.kind]}</td>
            <td className="text-right tabular-nums">{money(r.siteAmount)}</td>
            <td className="text-right tabular-nums">{money(r.apprAmount) || "—"}</td>
            <td><StatusBadge status={r.status} /></td>
          </tr>
        ))}
      </Table>
    </>
  );
}
