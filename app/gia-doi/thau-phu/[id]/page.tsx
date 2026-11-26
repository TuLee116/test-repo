import { notFound } from "next/navigation";
import { getThauPhu, getThauPhuList } from "@/lib/data";
import { CATEGORY, money, qty } from "@/lib/format";
import { Card, PageHeader, Table } from "@/components/ui";

export const generateStaticParams = () => getThauPhuList().map((x) => ({ id: x.id }));
export const dynamicParams = false;

export default async function ThauPhuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = getThauPhu(id);
  if (!t) notFound();
  const h = t.head;
  const amount = (q: number | null, p: number | null) => (q != null && p != null ? q * p : null);

  return (
    <>
      <PageHeader title={`Hồ sơ ${t.no} · ${h.projectName}`} sub={`${h.itemName} · Thầu phụ: ${h.subName}`} back={{ href: "/gia-doi/thau-phu", label: "Trình giá thầu phụ" }} />
      <Card className="mb-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div><span className="text-slate-500">Khu vực: </span>{h.area}</div>
        <div><span className="text-slate-500">Nhánh: </span>{t.branch} <span className="text-xs text-slate-500">({t.branchReason})</span></div>
        <div><span className="text-slate-500">Hạng mục: </span>{CATEGORY[t.category] ?? t.category}</div>
        <div><span className="text-slate-500">HĐ chủ đầu tư: </span>{h.cdtContract}</div>
        <div><span className="text-slate-500">HĐ thầu phụ: </span>{t.hd ? `${t.hd.no} (${t.hd.at})` : "chưa có"}</div>
        <div><span className="text-slate-500">Lần trình: </span>{t.revision}</div>
        {t.reviewNote && <div className="sm:col-span-3"><span className="text-slate-500">Ý kiến: </span>{t.reviewNote}</div>}
      </Card>

      <Table head={["STT", "Nội dung", "ĐVT", "KL CĐT", "Giá CĐT", "KL cơ sở", "Giá cơ sở", ...t.bidders.map((b) => `Giá ${b.key}`), "KL đề xuất", "Giá đề xuất", "Thành tiền đề xuất", "Giá TP duyệt", "Ghi chú"]}>
        {t.lines.map((l) => (
          <tr key={l.id} className={l.level !== "ITEM" ? "bg-slate-50 font-semibold" : ""}>
            <td>{l.stt}</td>
            <td className="min-w-64">{l.content}</td>
            <td>{l.unit}</td>
            <td className="text-right tabular-nums">{qty(l.cdtQty)}</td>
            <td className="text-right tabular-nums">{money(l.cdtPrice)}</td>
            <td className="text-right tabular-nums">{qty(l.baseQty)}</td>
            <td className="text-right tabular-nums">{money(l.basePrice)}</td>
            {t.bidders.map((b) => (
              <td key={b.key} className="text-right tabular-nums">{money(l.bids?.[b.key]?.price)}</td>
            ))}
            <td className="text-right tabular-nums">{qty(l.propQty)}</td>
            <td className="text-right tabular-nums">{money(l.propPrice)}</td>
            <td className="text-right tabular-nums">{money(amount(l.propQty, l.propPrice))}</td>
            <td className="text-right tabular-nums">{money(l.tpPrice)}</td>
            <td className="text-xs text-slate-500">{l.note}</td>
          </tr>
        ))}
      </Table>

      {h.terms?.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-sm font-semibold">Điều khoản</h2>
          <Table head={["Điều khoản", "CĐT", "Cơ sở", "Đề xuất", "Duyệt"]}>
            {h.terms.map((x) => (
              <tr key={x.label} className="align-top">
                <td className="font-medium">{x.label}</td>
                <td className="whitespace-pre-line text-xs">{x.cdt}</td>
                <td className="whitespace-pre-line text-xs">{x.base}</td>
                <td className="whitespace-pre-line text-xs">{x.prop}</td>
                <td className="whitespace-pre-line text-xs">{x.appr}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}
