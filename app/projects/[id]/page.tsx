import { notFound } from "next/navigation";
import { getProject, getStats } from "@/lib/data";
import { money, qty } from "@/lib/format";
import { Card, Kpi, PageHeader, StatusBadge, Table } from "@/components/ui";

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab } = await searchParams;
  const p = getProject(id);
  if (!p) notFound();
  const s = getStats().find((x) => x.id === id);
  const st = p.status;

  return (
    <>
      <PageHeader
        title={s?.name ?? "DT-CP"}
        sub={<>{s?.packageName}{st?.contractNo && <> · HĐ {st.contractNo}</>}</>}
        back={{ href: "/projects", label: "Tổng quan dự án" }}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Kpi label="A. Doanh thu (Hợp đồng sau VAT)" value={money(p.totalA)} />
        <Kpi label="B. Chi phí" value={money(p.totalB)} />
        <Card>
          <div className="text-xs text-slate-500">Trạng thái</div>
          {st ? (
            <div className="mt-1 space-y-1 text-xs">
              <StatusBadge status={st.status} />
              <div>{st.submitted}</div>
              <div>Duyệt: {st.approved}</div>
              <div>QSTT: {st.qsttName}</div>
            </div>
          ) : (
            "—"
          )}
        </Card>
      </div>

      <div className="mb-3 flex gap-1 text-sm">
        {[
          ["", "Bảng DT-CP"],
          ["boq", `BOQ (${p.boq.length})`],
          ["log", "Lịch sử duyệt"],
        ].map(([k, l]) => (
          <a key={k} href={k ? `?tab=${k}` : "?"} className={`rounded px-3 py-1 ${(tab ?? "") === k ? "bg-blue-700 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}>
            {l}
          </a>
        ))}
      </div>

      {(tab ?? "") === "" && (
        <Table head={["Mục", "Mã", "Nội dung", "ĐVT", "Thành tiền", "Ghi chú"]}>
          {(p.rows ?? []).map((r) => (
            <tr key={r.id} className={r.depth === 0 ? "bg-slate-50 font-semibold" : ""}>
              <td>{r.section}</td>
              <td>{r.code}</td>
              <td style={{ paddingLeft: 8 + r.depth * 16 }}>{r.name}</td>
              <td>{r.unit}</td>
              <td className="text-right tabular-nums">{money(r.amount)}</td>
              <td className="text-xs text-slate-500">{r.note}</td>
            </tr>
          ))}
        </Table>
      )}

      {tab === "boq" && (
        <Table head={["TT", "Mô tả công việc (BOQ)", "Mã định mức", "ĐVT", "Khối lượng"]}>
          {p.boq.map((b) => (
            <tr key={b.id} className={b.isHeading ? "bg-slate-50 font-semibold" : ""}>
              <td>{b.stt}</td>
              <td>{b.rawDescription}</td>
              <td className="text-xs" title={b.workItemName ?? ""}>{b.workItemCode}</td>
              <td>{b.rawUnit}</td>
              <td className="text-right tabular-nums">{b.isHeading ? "" : qty(b.quantity)}</td>
            </tr>
          ))}
        </Table>
      )}

      {tab === "log" && (
        <Table head={["Thời gian", "Thao tác", "Người", "Ghi chú"]}>
          {(st?.logs ?? []).map((l, i) => (
            <tr key={i}>
              <td className="whitespace-nowrap">{l.at}</td>
              <td>{l.action}</td>
              <td>{l.user}</td>
              <td>{l.note}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
