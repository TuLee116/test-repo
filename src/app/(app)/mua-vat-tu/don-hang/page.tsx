import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { can, fmtDate, fmtMoney, getProcUser, PO_STATUS, projectScope, selectedPriceOf } from "@/lib/proc";
import { pendingRequestItems } from "@/lib/proc-tasks";
import { Badge, Empty, LinkText, Section, td, th } from "../ui";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const u = (await getProcUser())!;
  const [waiting, orders] = await Promise.all([
    pendingRequestItems(u),
    prisma.purchaseOrder.findMany({
      where: { ...projectScope(u), ...(sp.status ? { status: sp.status } : {}) },
      include: { project: { select: { name: true, packageName: true } }, items: true, quotations: { include: { lines: true, supplier: true } } },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
  ]);
  // Gom dòng chờ lên đơn theo dự án
  const byProject = new Map<string, { name: string; n: number; reqs: Set<string> }>();
  for (const it of waiting) {
    const p = it.request.project;
    const g = byProject.get(p.id) ?? { name: p.packageName ? `${p.name} — ${p.packageName}` : p.name, n: 0, reqs: new Set<string>() };
    g.n++;
    g.reqs.add(it.request.code);
    byProject.set(p.id, g);
  }
  const filters = [{ label: "Tất cả", href: "/mua-vat-tu/don-hang", on: !sp.status }, ...Object.entries(PO_STATUS).map(([k, v]) => ({ label: v.label, href: `/mua-vat-tu/don-hang?status=${k}`, on: sp.status === k }))];

  return (
    <div className="space-y-4">
      {byProject.size > 0 && (
        <Section title="Đề nghị đã được CHT duyệt — chờ lên đơn hàng">
          <ul className="divide-y divide-slate-100 text-sm">
            {[...byProject.entries()].map(([pid, g]) => (
              <li key={pid} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <b>{g.name}</b> — {g.n} dòng vật tư từ phiếu {[...g.reqs].join(", ")}
                </span>
                {can(u, "CBVT") && (
                  <Link href={`/mua-vat-tu/don-hang/moi?project=${pid}`} className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800">
                    Lên đơn hàng →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Đơn hàng">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <Link key={f.href} href={f.href} className={`rounded-full border px-3 py-1 text-xs ${f.on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
              {f.label}
            </Link>
          ))}
        </div>
        {orders.length === 0 ? (
          <Empty>Chưa có đơn hàng</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Số đơn</th>
                  <th className={th}>Dự án</th>
                  <th className={th}>Nội dung</th>
                  <th className={th}>Số dòng</th>
                  <th className={th}>Số NCC báo giá</th>
                  <th className={`${th} text-right`}>Giá trị chọn (gồm VAT)</th>
                  <th className={th}>Ngày lập</th>
                  <th className={th}>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const value = o.items.reduce((s, it) => {
                    const p = selectedPriceOf(it, o.quotations);
                    return s + (p ? it.quantity * p.unitPrice * (1 + p.vatRate) : 0);
                  }, 0);
                  return (
                    <tr key={o.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className={td}>
                        <LinkText href={`/mua-vat-tu/don-hang/${o.id}`}>{o.code}</LinkText>
                      </td>
                      <td className={td}>
                        {o.project.name}
                        {o.project.packageName && <span className="block text-xs text-slate-400">{o.project.packageName}</span>}
                      </td>
                      <td className={td}>{o.title}</td>
                      <td className={td}>{o.items.length}</td>
                      <td className={td}>{o.quotations.length}</td>
                      <td className={`${td} text-right`}>{value ? fmtMoney(value) : "—"}</td>
                      <td className={td}>{fmtDate(o.createdAt)}</td>
                      <td className={td}>
                        <Badge map={PO_STATUS} status={o.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
