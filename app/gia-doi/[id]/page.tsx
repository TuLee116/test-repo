import Link from "next/link";
import { notFound } from "next/navigation";
import { getGiaDoi, getGiaDoiList } from "@/lib/data";
import { CATEGORY, KIND, money, qty } from "@/lib/format";
import { Card, PageHeader, StatusBadge, Table } from "@/components/ui";

export const generateStaticParams = () => getGiaDoiList().map((x) => ({ id: x.id }));
export const dynamicParams = false;

export default async function GiaDoiPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = getGiaDoi(id);
  if (!g) notFound();
  const h = g.head;
  const items = g.lines.filter((l) => l.level === "ITEM");
  const site = items.reduce((a, l) => a + (l.siteAmount ?? 0), 0);
  const appr = items.reduce((a, l) => a + (l.apprAmount ?? 0), 0);

  return (
    <>
      <PageHeader title={`Hồ sơ ${g.no || ""} · ${h.projectName}`} sub={`${h.itemName} · Đợt ${h.batch} ${h.batchDate}`} back={{ href: "/gia-doi", label: "Hồ sơ giá đội" }} />
      <Card className="mb-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div><span className="text-slate-500">Trạng thái: </span><StatusBadge status={g.status} /> {g.revision > 1 && <span className="text-xs">· lần {g.revision}</span>}</div>
        <div><span className="text-slate-500">Loại: </span>{KIND[g.kind]}</div>
        <div><span className="text-slate-500">Hạng mục: </span>{CATEGORY[h.category] ?? h.category}</div>
        <div>
          <span className="text-slate-500">Hợp đồng: </span>
          {g.contractId ? <Link className="text-blue-800 hover:underline" href={`/gia-doi/hop-dong/${g.contractId}`}>{h.contractNo}</Link> : h.contractNo}
        </div>
        {h.crewName && <div><span className="text-slate-500">Đội: </span>{h.crewName}</div>}
        <div><span className="text-slate-500">Đề xuất: </span><b className="tabular-nums">{money(site)}</b></div>
        <div><span className="text-slate-500">Duyệt: </span><b className="tabular-nums">{money(appr) || "—"}</b></div>
        {h.qsNote && <div className="sm:col-span-2 lg:col-span-3"><span className="text-slate-500">Ghi chú QS: </span>{h.qsNote}</div>}
        {h.tpNote && <div className="sm:col-span-2 lg:col-span-3"><span className="text-slate-500">Ghi chú TP: </span>{h.tpNote}</div>}
      </Card>
      <Table head={["STT", "Nội dung", "ĐVT", "KL", "Giá CĐT", "Giá HĐ/cơ sở", "Đơn giá đề xuất", "Thành tiền đề xuất", "Giá TP duyệt", "Thành tiền duyệt", "Ghi chú"]}>
        {g.lines.map((l) => {
          const head = l.level !== "ITEM";
          return (
            <tr key={l.id} className={head ? "bg-slate-50 font-semibold" : ""}>
              <td>{l.stt}</td>
              <td className="min-w-64">{l.content}</td>
              <td>{l.unit}</td>
              <td className="text-right tabular-nums">{qty(l.qty)}</td>
              <td className="text-right tabular-nums">{money(l.cdtPrice)}</td>
              <td className="text-right tabular-nums">{money(l.basePrice)}</td>
              <td className="text-right tabular-nums">{money(l.sitePrice)}</td>
              <td className="text-right tabular-nums">{money(l.siteAmount)}</td>
              <td className="text-right tabular-nums">{money(l.tpPrice)}</td>
              <td className="text-right tabular-nums">{money(l.apprAmount)}</td>
              <td className="text-xs text-slate-500">{[l.siteNote, l.qsNote, l.tpNote].filter(Boolean).join(" · ")}</td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
