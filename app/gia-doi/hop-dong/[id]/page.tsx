import Link from "next/link";
import { notFound } from "next/navigation";
import { getContract, getContracts, getGiaDoiList } from "@/lib/data";
import { money, qty } from "@/lib/format";
import { Card, PageHeader, StatusBadge, Table } from "@/components/ui";

export const generateStaticParams = () => getContracts().map((x) => ({ id: x.id }));
export const dynamicParams = false;

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = getContract(id);
  if (!c) notFound();
  const vers = [...c.versions].sort((a, b) => a.n - b.n);
  const docs = getGiaDoiList().filter((g) => g.contractId === id).sort((a, b) => b.no.localeCompare(a.no));

  return (
    <>
      <PageHeader title={c.packageName} sub={`${c.name} · HĐ ${c.contractNo}${c.appendixNo ? ` · Phụ lục ${c.appendixNo}` : ""} · Khu vực ${c.area}`} back={{ href: "/gia-doi/hop-dong", label: "Hợp đồng & sổ giá" }} />
      <Card className="mb-4 text-sm">
        <div className="mb-1 text-slate-500">Các thời điểm giá</div>
        <ul className="flex flex-wrap gap-2">
          {vers.map((v) => (
            <li key={v.n} className={`rounded px-2 py-0.5 ring-1 ${v.approved ? "bg-emerald-50 ring-emerald-200" : "bg-slate-50 ring-slate-200"}`}>
              {v.n}. {v.label} {v.approved && "· đang áp dụng"}
            </li>
          ))}
        </ul>
      </Card>

      <h2 className="mb-2 text-sm font-semibold">Sổ giá đội theo hợp đồng ({c.lines.length} dòng)</h2>
      <Table head={["#", "Nội dung", "ĐVT", "KL DT-CP", ...vers.map((v) => `Giá TĐ ${v.n}`)]}>
        {c.lines.map((l, i) => (
          <tr key={l.key}>
            <td>{i + 1}</td>
            <td>{l.name}</td>
            <td>{l.unit}</td>
            <td className="text-right tabular-nums">{qty(l.qty)}</td>
            {vers.map((v) => (
              <td key={v.n} className="text-right tabular-nums">{money(l.prices[String(v.n)])}</td>
            ))}
          </tr>
        ))}
      </Table>

      <h2 className="mb-2 mt-6 text-sm font-semibold">Hồ sơ giá đội của hợp đồng ({docs.length})</h2>
      <Table head={["Số", "Đợt", "Hạng mục", "Đề xuất", "Duyệt", "Trạng thái"]}>
        {docs.map((g) => (
          <tr key={g.id}>
            <td><Link href={`/gia-doi/${g.id}`} className="text-blue-800 hover:underline">{g.no || "(chưa số)"}</Link></td>
            <td className="text-xs">{g.batch} {g.batchDate}</td>
            <td className="text-xs">{g.itemName}</td>
            <td className="text-right tabular-nums">{money(g.siteAmount)}</td>
            <td className="text-right tabular-nums">{money(g.apprAmount) || "—"}</td>
            <td><StatusBadge status={g.status} /></td>
          </tr>
        ))}
      </Table>
    </>
  );
}
