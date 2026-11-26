import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { can, canSeeProject, fmtDate, fmtMoney, getProcUser, PAY_STATUS, payableTotals } from "@/lib/proc";
import { deletePayableAction, deletePaymentAction, recallPayableAction, sendPayableAction } from "@/lib/proc-actions";
import ActionButton from "../../ActionButton";
import { Badge, LogList, Section, td, th } from "../../ui";
import { getPayableForm } from "@/lib/proc-forms";
import PayableSheet from "../../forms/PayableSheet";
import PaymentForm from "./PaymentForm";
import PayablePrintInfo from "./PayablePrintInfo";

export default async function PayableDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = (await getProcUser())!;
  const p = await prisma.payable.findUnique({
    where: { id },
    include: {
      supplier: true,
      project: true,
      lines: { include: { receiptLine: { include: { receipt: true, item: { include: { order: { select: { id: true, code: true } } } } } } } },
      payments: { orderBy: { paidDate: "asc" } },
    },
  });
  if (!p || !canSeeProject(u, p.projectId)) notFound();
  const [logs, form] = await Promise.all([prisma.procLog.findMany({ where: { entity: "PAY", entityId: id }, orderBy: { createdAt: "asc" } }), getPayableForm(id)]);
  const t = payableTotals(p);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link href="/mua-vat-tu/cong-no" className="text-sm text-slate-500 hover:underline">
          ← Công nợ NCC
        </Link>
        <span className="flex-1" />
        {p.status === "DRAFT" && can(u, "CBVT") && (
          <>
            <ActionButton variant="primary" action={sendPayableAction.bind(null, id)} confirm="Gửi đề nghị thanh toán này sang phòng kế toán?">
              Gửi phòng kế toán →
            </ActionButton>
            <ActionButton variant="danger" action={deletePayableAction.bind(null, id)} confirm="Xoá công nợ nháp này? (các dòng hàng quay lại danh sách chưa lên công nợ)" goto="/mua-vat-tu/cong-no">
              Xoá
            </ActionButton>
          </>
        )}
        {p.status === "SENT" && p.payments.length === 0 && can(u, "CBVT") && (
          <ActionButton action={recallPayableAction.bind(null, id)} confirm="Rút lại công nợ về nháp để sửa?">
            Rút lại
          </ActionButton>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="mt-2 text-center">
          <h1 className="text-lg font-bold uppercase text-slate-900">Đề nghị thanh toán nhà cung cấp</h1>
          <p className="text-sm text-slate-600">
            Số <b>{p.code}</b> · lập {fmtDate(p.createdAt)} bởi {p.createdByName}{" "}
            <span className="print:hidden">
              <Badge map={PAY_STATUS} status={p.status} />
            </span>
          </p>
        </div>
        <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="inline text-slate-500">Nhà cung cấp: </dt>
            <dd className="inline font-semibold">{p.supplier.name}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">Dự án: </dt>
            <dd className="inline">
              {p.project.name}
              {p.project.packageName && ` — ${p.project.packageName}`}
            </dd>
          </div>
          <div>
            <dt className="inline text-slate-500">MST: </dt>
            <dd className="inline">{p.supplier.taxCode || "—"}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">Tài khoản: </dt>
            <dd className="inline">
              {p.supplier.bankAccount || "—"} {p.supplier.bankName && `tại ${p.supplier.bankName}`}
            </dd>
          </div>
          <div>
            <dt className="inline text-slate-500">Nội dung: </dt>
            <dd className="inline">{p.title}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">Hạn thanh toán: </dt>
            <dd className="inline">{fmtDate(p.dueDate) || "—"}</dd>
          </div>
          {p.note && (
            <div className="sm:col-span-2">
              <dt className="inline text-slate-500">Ghi chú: </dt>
              <dd className="inline">{p.note}</dd>
            </div>
          )}
        </dl>

      </div>

      {form && <PayableSheet f={form} />}

      <div className="print:hidden">
        <PayablePrintInfo
          payableId={id}
          editable={p.status === "DRAFT" && can(u, "CBVT")}
          initial={{
            periodFrom: p.periodFrom ? p.periodFrom.toISOString().slice(0, 10) : "",
            periodTo: p.periodTo ? p.periodTo.toISOString().slice(0, 10) : "",
            invoiceAdjust: p.invoiceAdjust,
            advanceDeduct: p.advanceDeduct,
          }}
        />
      </div>

      {p.status !== "DRAFT" && (
        <div className="print:hidden">
          <Section title="Thanh toán (phòng kế toán)" right={<span className="text-sm">Còn phải trả: <b className="text-base">{fmtMoney(t.remaining)} đ</b></span>}>
            {p.payments.length > 0 && (
              <table className="mb-3 w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>Ngày chi</th>
                    <th className={`${th} text-right`}>Số tiền</th>
                    <th className={th}>Ghi chú</th>
                    <th className={th}>Người ghi</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {p.payments.map((pm) => (
                    <tr key={pm.id} className="border-t border-slate-100">
                      <td className={td}>{fmtDate(pm.paidDate)}</td>
                      <td className={`${td} text-right font-medium`}>{fmtMoney(pm.amount)}</td>
                      <td className={td}>{pm.note}</td>
                      <td className={td}>{pm.createdByName}</td>
                      <td className={`${td} text-right`}>
                        {can(u, "KT") && (
                          <ActionButton variant="link" action={deletePaymentAction.bind(null, pm.id)} confirm="Xoá lần chi này?">
                            Xoá
                          </ActionButton>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {can(u, "KT") && t.remaining > 0.5 ? <PaymentForm key={Math.round(t.remaining)} payableId={id} remaining={t.remaining} /> : p.payments.length === 0 && <p className="text-sm text-slate-400">Chờ phòng kế toán thanh toán.</p>}
          </Section>
        </div>
      )}

      <div className="print:hidden">
        <Section title="Lịch sử xử lý">
          <LogList logs={logs} />
        </Section>
      </div>
    </div>
  );
}
