import { prisma } from "@/lib/prisma";
import { fmtDate, fmtQty, getProcUser, projectScope } from "@/lib/proc";
import { Empty, LinkText, Section, td, th } from "../ui";

export default async function ReceivingPage() {
  const u = (await getProcUser())!;
  const scope = projectScope(u);
  const [orders, receipts] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { status: "ORDERED", ...scope },
      include: { project: { select: { name: true, packageName: true } }, items: { include: { receiptLines: true } } },
      orderBy: { orderedAt: "asc" },
    }),
    prisma.goodsReceipt.findMany({
      where: { order: scope },
      include: { supplier: true, order: { select: { id: true, code: true, project: { select: { name: true } } } }, lines: { include: { item: true } } },
      orderBy: { receivedDate: "desc" },
      take: 100,
    }),
  ]);
  return (
    <div className="space-y-4">
      <Section title="Đơn hàng đã đặt — chờ giao / báo nhận hàng">
        <p className="mb-3 text-xs text-slate-500">Mở đơn hàng và bấm &quot;Báo nhận hàng&quot; mỗi lần nhà cung cấp giao hàng tới công trình.</p>
        {orders.length === 0 ? (
          <Empty>Không có đơn hàng nào đang chờ giao</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Đơn hàng</th>
                <th className={th}>Dự án</th>
                <th className={th}>Nội dung</th>
                <th className={th}>Ngày đặt</th>
                <th className={th}>Tiến độ nhận</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const done = o.items.filter((it) => it.receiptLines.reduce((s, l) => s + l.quantity, 0) >= it.quantity - 1e-9).length;
                return (
                  <tr key={o.id} className="border-t border-slate-100">
                    <td className={td}>
                      <LinkText href={`/mua-vat-tu/don-hang/${o.id}`}>{o.code}</LinkText>
                    </td>
                    <td className={td}>
                      {o.project.name}
                      {o.project.packageName && <span className="block text-xs text-slate-400">{o.project.packageName}</span>}
                    </td>
                    <td className={td}>{o.title}</td>
                    <td className={td}>{fmtDate(o.orderedAt)}</td>
                    <td className={td}>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-28 overflow-hidden rounded bg-slate-200">
                          <div className="h-full bg-emerald-600" style={{ width: `${(done / Math.max(1, o.items.length)) * 100}%` }} />
                        </div>
                        <span className="text-xs text-slate-600">
                          {done}/{o.items.length} dòng đủ
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Các lần nhận hàng gần đây">
        {receipts.length === 0 ? (
          <Empty>Chưa có</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Số phiếu</th>
                <th className={th}>Ngày nhận</th>
                <th className={th}>Đơn hàng</th>
                <th className={th}>Dự án</th>
                <th className={th}>NCC</th>
                <th className={th}>Hàng nhận</th>
                <th className={th}>Người báo</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className={td}>{r.code}</td>
                  <td className={td}>{fmtDate(r.receivedDate)}</td>
                  <td className={td}>
                    <LinkText href={`/mua-vat-tu/don-hang/${r.order.id}`}>{r.order.code}</LinkText>
                  </td>
                  <td className={td}>{r.order.project.name}</td>
                  <td className={td}>{r.supplier.name}</td>
                  <td className={`${td} text-xs`}>
                    {r.lines.map((l) => (
                      <span key={l.id} className="block">
                        {l.item.name}: {fmtQty(l.quantity)} {l.item.unit}
                      </span>
                    ))}
                  </td>
                  <td className={td}>{r.createdByName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
