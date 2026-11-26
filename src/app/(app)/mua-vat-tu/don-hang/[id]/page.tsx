import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { can, canSeeProject, fmtDate, fmtMoney, fmtQty, getProcUser, PO_STATUS, selectedPriceOf } from "@/lib/proc";
import { approveOrderAction, cancelOrderAction, closeOrderAction, deleteReceiptAction, markOrderedAction, rejectOrderAction, sendToQuotingAction } from "@/lib/proc-actions";
import ActionButton from "../../ActionButton";
import { Badge, LinkText, LogList, Section, td, th } from "../../ui";
import { getOrderForm } from "@/lib/proc-forms";
import OrderSheet from "../../forms/OrderSheet";
import QuoteBoard from "./QuoteBoard";
import OrderItemsEditor from "./OrderItemsEditor";
import ReceiptForm from "./ReceiptForm";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = (await getProcUser())!;
  const o = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      project: true,
      items: { orderBy: { orderIndex: "asc" }, include: { requestItem: { include: { request: { select: { id: true, code: true } } } }, receiptLines: true } },
      quotations: { include: { supplier: true, lines: true }, orderBy: { quoteDate: "asc" } },
      receipts: { include: { supplier: true, lines: { include: { item: true, payableLine: true } } }, orderBy: { receivedDate: "asc" } },
    },
  });
  if (!o || !canSeeProject(u, o.projectId)) notFound();
  const [logs, suppliers, form] = await Promise.all([
    prisma.procLog.findMany({ where: { entity: "PO", entityId: id }, orderBy: { createdAt: "asc" } }),
    prisma.supplier.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    getOrderForm(id),
  ]);
  const quoting = o.status === "DRAFT" || o.status === "QUOTING";
  const showBoard = o.status !== "DRAFT" || o.quotations.length > 0;
  // Bảng trình kí: PTGĐ xem & duyệt ngay trên app; khi kế toán VT còn đang so sánh giá thì hiện bên dưới để xem trước
  const sheetFirst = !quoting && o.status !== "CANCELLED";
  const sheet = showBoard && form && (
    <Section title={sheetFirst ? "Trình kí đơn hàng" : "Xem trước bảng trình kí (theo NCC đang chọn)"}>
      <OrderSheet f={form} />
    </Section>
  );
  const priced = o.items.map((it) => ({ it, sp: selectedPriceOf(it, o.quotations), received: it.receiptLines.reduce((s, l) => s + l.quantity, 0) }));
  const total = priced.reduce((s, x) => s + (x.sp ? x.it.quantity * x.sp.unitPrice * (1 + x.sp.vatRate) : 0), 0);
  const chosenSuppliers = [...new Map(priced.filter((x) => x.sp).map((x) => [x.sp!.supplierId, { id: x.sp!.supplierId, name: x.sp!.supplierName }])).values()];
  const canReceive = o.status === "ORDERED" && can(u, "GS", "CHT", "CBVT");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link href="/mua-vat-tu/don-hang" className="text-sm text-slate-500 hover:underline">
          ← Danh sách đơn hàng
        </Link>
        <span className="flex-1" />
        {o.status === "DRAFT" && can(u, "CBVT") && (
          <ActionButton variant="primary" action={sendToQuotingAction.bind(null, id)} confirm="Chuyển đơn hàng cho kế toán vật tư lấy báo giá?">
            Chuyển kế toán VT lấy báo giá →
          </ActionButton>
        )}
        {o.status === "PENDING" && can(u, "PTGD") && (
          <>
            <ActionButton variant="primary" action={approveOrderAction.bind(null, id)} prompt="Ý kiến phê duyệt (có thể để trống):">
              ✓ Phê duyệt
            </ActionButton>
            <ActionButton variant="danger" action={rejectOrderAction.bind(null, id)} prompt="Lý do trả lại cho kế toán vật tư:" promptRequired>
              Trả lại
            </ActionButton>
          </>
        )}
        {o.status === "APPROVED" && can(u, "CBVT") && (
          <ActionButton variant="primary" action={markOrderedAction.bind(null, id)} confirm="Xác nhận đã đặt hàng với nhà cung cấp?">
            ✓ Đã đặt hàng
          </ActionButton>
        )}
        {o.status === "ORDERED" && can(u, "CBVT") && (
          <ActionButton action={closeOrderAction.bind(null, id)} confirm="Đóng đơn hàng (NCC không giao thêm phần còn thiếu)?">
            Đóng đơn
          </ActionButton>
        )}
        {o.status !== "CANCELLED" && o.status !== "DONE" && o.receipts.length === 0 && can(u, "CBVT") && (
          <ActionButton variant="danger" action={cancelOrderAction.bind(null, id)} prompt="Lý do huỷ đơn hàng:" promptRequired>
            Huỷ đơn
          </ActionButton>
        )}
      </div>

      {sheetFirst && sheet}

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="mt-2 text-center">
          <h1 className="text-lg font-bold uppercase text-slate-900">{showBoard ? "Bảng so sánh giá vật tư" : "Đơn hàng vật tư"}</h1>
          <p className="text-sm text-slate-600">
            Đơn hàng số <b>{o.code}</b> · lập {fmtDate(o.createdAt)} bởi {o.createdByName}{" "}
            <span className="print:hidden">
              <Badge map={PO_STATUS} status={o.status} />
            </span>
          </p>
        </div>
        <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="inline text-slate-500">Dự án: </dt>
            <dd className="inline font-medium">
              {o.project.name}
              {o.project.packageName && ` — ${o.project.packageName}`}
            </dd>
          </div>
          <div>
            <dt className="inline text-slate-500">Nội dung: </dt>
            <dd className="inline">{o.title}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">Giao tại: </dt>
            <dd className="inline">{o.deliveryPlace}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">Theo phiếu đề nghị: </dt>
            <dd className="inline">
              {[...new Map(o.items.filter((i) => i.requestItem).map((i) => [i.requestItem!.request.id, i.requestItem!.request.code])).entries()].map(([rid, code], k) => (
                <span key={rid}>
                  {k > 0 && ", "}
                  <LinkText href={`/mua-vat-tu/de-nghi/${rid}`}>{code}</LinkText>
                </span>
              ))}
            </dd>
          </div>
          {o.note && (
            <div className="sm:col-span-2">
              <dt className="inline text-slate-500">Ghi chú: </dt>
              <dd className="inline">{o.note}</dd>
            </div>
          )}
          {o.rejectReason && o.status === "QUOTING" && <div className="rounded bg-red-50 px-2 py-1 text-red-700 sm:col-span-2 print:hidden">PTGĐ trả lại: {o.rejectReason}</div>}
          {o.approvedAt && (
            <div className="rounded bg-emerald-50 px-2 py-1 text-emerald-800 sm:col-span-2">
              PTGĐ {o.approvedByName} đã duyệt ngày {fmtDate(o.approvedAt)}
              {o.approvalNote && ` — "${o.approvalNote}"`}
            </div>
          )}
        </dl>

        {quoting && can(u, "CBVT", "KTVT") && (
          <details className="mt-4 rounded border border-slate-200 p-3 print:hidden" open={o.status === "DRAFT"}>
            <summary className="cursor-pointer text-sm font-medium text-slate-700">Sửa dòng vật tư của đơn hàng</summary>
            <div className="mt-3">
              <OrderItemsEditor
                orderId={id}
                head={{ title: o.title, deliveryPlace: o.deliveryPlace, note: o.note }}
                items={o.items.map((i) => ({ id: i.id, name: i.name, spec: i.spec, unit: i.unit, quantity: i.quantity, note: i.note, reqCode: i.requestItem?.request.code ?? "" }))}
              />
            </div>
          </details>
        )}

        {showBoard ? (
          <div className="mt-4">
            <QuoteBoard
              orderId={id}
              editable={quoting && can(u, "KTVT")}
              canSubmit={o.status === "QUOTING" && can(u, "KTVT")}
              items={o.items.map((i) => ({ id: i.id, name: i.name, spec: i.spec, unit: i.unit, quantity: i.quantity, selectedQuoteId: i.selectedQuoteId }))}
              quotes={o.quotations.map((q) => ({
                id: q.id,
                supplierName: q.supplier.name,
                vatRate: q.vatRate,
                deliveryTerms: q.deliveryTerms,
                paymentTerms: q.paymentTerms,
                note: q.note,
                quoteDate: q.quoteDate.toISOString().slice(0, 10),
                prices: Object.fromEntries(q.lines.map((l) => [l.itemId, l.unitPrice])),
              }))}
              suppliers={suppliers}
            />
          </div>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>STT</th>
                <th className={th}>Tên vật tư</th>
                <th className={th}>Quy cách</th>
                <th className={th}>ĐVT</th>
                <th className={`${th} text-right`}>Số lượng</th>
              </tr>
            </thead>
            <tbody>
              {o.items.map((it, i) => (
                <tr key={it.id} className="border-t border-slate-100">
                  <td className={td}>{i + 1}</td>
                  <td className={td}>{it.name}</td>
                  <td className={td}>{it.spec}</td>
                  <td className={td}>{it.unit}</td>
                  <td className={`${td} text-right`}>{fmtQty(it.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!sheetFirst && sheet}

      {["APPROVED", "ORDERED", "DONE"].includes(o.status) && (
        <div className="print:hidden">
          <Section title="Tình hình giao nhận hàng" right={<span className="text-sm text-slate-600">Giá trị đơn hàng (gồm VAT): <b>{fmtMoney(total)} đ</b></span>}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>Tên vật tư</th>
                    <th className={th}>NCC</th>
                    <th className={th}>ĐVT</th>
                    <th className={`${th} text-right`}>SL đặt</th>
                    <th className={`${th} text-right`}>Đã nhận</th>
                    <th className={`${th} text-right`}>Còn lại</th>
                    <th className={`${th} text-right`}>Đơn giá (chưa VAT)</th>
                  </tr>
                </thead>
                <tbody>
                  {priced.map(({ it, sp, received }) => (
                    <tr key={it.id} className="border-t border-slate-100">
                      <td className={td}>{it.name}</td>
                      <td className={td}>{sp?.supplierName}</td>
                      <td className={td}>{it.unit}</td>
                      <td className={`${td} text-right`}>{fmtQty(it.quantity)}</td>
                      <td className={`${td} text-right`}>{received ? fmtQty(received) : "—"}</td>
                      <td className={`${td} text-right ${it.quantity - received > 1e-9 ? "font-medium text-amber-700" : "text-emerald-700"}`}>{it.quantity - received > 1e-9 ? fmtQty(it.quantity - received) : "✓ đủ"}</td>
                      <td className={`${td} text-right`}>{sp ? fmtMoney(sp.unitPrice) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="mb-2 mt-5 text-sm font-medium text-slate-800">Các lần nhận hàng ({o.receipts.length})</h3>
            {o.receipts.length === 0 ? (
              <p className="text-sm text-slate-400">Chưa có lần nhận hàng nào.</p>
            ) : (
              <ul className="space-y-2">
                {o.receipts.map((r) => {
                  const billed = r.lines.some((l) => l.payableLine);
                  return (
                    <li key={r.id} className="rounded border border-slate-200 p-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <b>{r.code}</b>
                        <span>· {fmtDate(r.receivedDate)}</span>
                        <span>· {r.supplier.name}</span>
                        {r.deliveryNoteNo && <span className="text-slate-500">· Phiếu giao {r.deliveryNoteNo}</span>}
                        <span className="text-slate-500">· báo bởi {r.createdByName}</span>
                        {billed ? (
                          <span className="rounded-full bg-sky-100 px-2 text-xs text-sky-800">đã lên công nợ</span>
                        ) : (
                          can(u, "GS", "CHT", "CBVT") && (
                            <ActionButton variant="link" action={deleteReceiptAction.bind(null, r.id)} confirm={`Xoá phiếu nhận ${r.code}?`}>
                              Xoá
                            </ActionButton>
                          )
                        )}
                      </div>
                      <ul className="mt-1 pl-4 text-slate-600">
                        {r.lines.map((l) => (
                          <li key={l.id}>
                            {l.item.name}: <b>{fmtQty(l.quantity)}</b> {l.item.unit}
                            {l.note && <span className="text-amber-700"> — {l.note}</span>}
                          </li>
                        ))}
                      </ul>
                      {r.note && <p className="mt-1 text-xs text-slate-500">Ghi chú: {r.note}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
            {canReceive && (
              <div className="mt-4">
                <ReceiptForm
                  orderId={id}
                  suppliers={chosenSuppliers}
                  lines={priced.filter((x) => x.sp).map(({ it, sp, received }) => ({ itemId: it.id, supplierId: sp!.supplierId, name: it.name, spec: it.spec, unit: it.unit, ordered: it.quantity, received }))}
                />
              </div>
            )}
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
