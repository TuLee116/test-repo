import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { can, canSeeProject, fmtDate, fmtQty, getProcUser, REQ_STATUS } from "@/lib/proc";
import { getRequestForm } from "@/lib/proc-forms";
import { approveRequestAction, deleteRequestAction, rejectRequestAction, submitRequestAction } from "@/lib/proc-actions";
import ActionButton from "../../ActionButton";
import { Badge, LinkText, LogList, Section, td, th } from "../../ui";
import RequestSheet from "../../forms/RequestSheet";

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = (await getProcUser())!;
  const r = await prisma.materialRequest.findUnique({
    where: { id },
    include: {
      items: { orderBy: { orderIndex: "asc" }, include: { poItems: { include: { order: { select: { id: true, code: true, status: true } }, receiptLines: true } } } },
    },
  });
  if (!r || !canSeeProject(u, r.projectId)) notFound();
  const [f, logs] = await Promise.all([getRequestForm(id), prisma.procLog.findMany({ where: { entity: "REQ", entityId: id }, orderBy: { createdAt: "asc" } })]);
  if (!f) notFound();
  const editable = r.status === "DRAFT" || r.status === "REJECTED";
  const progress = r.items.map((it) => {
    const live = it.poItems.filter((p) => p.order.status !== "CANCELLED");
    return {
      it,
      live,
      ordered: live.reduce((s, p) => s + p.quantity, 0),
      received: live.reduce((s, p) => s + p.receiptLines.reduce((a, x) => a + x.quantity, 0), 0),
    };
  });
  const hasProgress = progress.some((x) => x.live.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/mua-vat-tu/de-nghi" className="text-sm text-slate-500 hover:underline">
          ← Danh sách đề nghị
        </Link>
        <span className="text-sm text-slate-600">
          Phiếu <b>{r.code}</b> · {r.title} · lập {fmtDate(r.createdAt)} bởi {r.createdByName}
        </span>
        <Badge map={REQ_STATUS} status={r.status} />
        <span className="flex-1" />
        {editable && can(u, "GS", "CHT") && (
          <>
            <Link href={`/mua-vat-tu/de-nghi/${id}/sua`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
              ✎ Sửa
            </Link>
            <ActionButton variant="primary" action={submitRequestAction.bind(null, id)} confirm="Trình chỉ huy trưởng duyệt phiếu này?">
              Trình CHT duyệt
            </ActionButton>
            <ActionButton variant="danger" action={deleteRequestAction.bind(null, id)} confirm="Xoá phiếu đề nghị này?" goto="/mua-vat-tu/de-nghi">
              Xoá
            </ActionButton>
          </>
        )}
        {r.status === "SUBMITTED" && can(u, "CHT") && (
          <>
            <ActionButton variant="primary" action={approveRequestAction.bind(null, id)} confirm="Duyệt giấy đề xuất và chuyển cán bộ vật tư lên đơn hàng?">
              ✓ Duyệt
            </ActionButton>
            <ActionButton variant="danger" action={rejectRequestAction.bind(null, id)} prompt="Lý do trả lại phiếu:" promptRequired>
              Trả lại
            </ActionButton>
          </>
        )}
      </div>

      {r.status === "REJECTED" && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">Lý do trả lại: {r.rejectReason}</div>}
      {r.note && <div className="rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">Ghi chú: {r.note}</div>}

      <RequestSheet f={f} />

      {hasProgress && (
        <Section title="Tình trạng mua hàng">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>STT</th>
                  <th className={th}>Tên vật tư</th>
                  <th className={th}>ĐVT</th>
                  <th className={`${th} text-right`}>KL đề xuất</th>
                  <th className={`${th} text-right`}>Đã lên đơn</th>
                  <th className={th}>Đơn hàng</th>
                  <th className={`${th} text-right`}>Đã nhận</th>
                </tr>
              </thead>
              <tbody>
                {progress.map(({ it, live, ordered, received }, i) => (
                  <tr key={it.id} className="border-t border-slate-100">
                    <td className={td}>{i + 1}</td>
                    <td className={td}>{it.name}</td>
                    <td className={td}>{it.unit}</td>
                    <td className={`${td} text-right`}>{fmtQty(it.quantity)}</td>
                    <td className={`${td} text-right`}>{ordered ? fmtQty(ordered) : "—"}</td>
                    <td className={td}>
                      {live.map((p, k) => (
                        <span key={p.id}>
                          {k > 0 && ", "}
                          <LinkText href={`/mua-vat-tu/don-hang/${p.order.id}`}>{p.order.code}</LinkText>
                        </span>
                      ))}
                    </td>
                    <td className={`${td} text-right`}>{received ? fmtQty(received) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="Lịch sử xử lý">
        <LogList logs={logs} />
      </Section>
    </div>
  );
}
