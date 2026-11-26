import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { can, fmtDate, fmtMoney, getProcUser, PAY_STATUS, payableTotals, projectScope } from "@/lib/proc";
import { unbilledReceiptLines } from "@/lib/proc-tasks";
import { Badge, Empty, LinkText, Section, td, th } from "../ui";

export default async function PayablesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const u = (await getProcUser())!;
  const [unbilled, payables] = await Promise.all([
    unbilledReceiptLines(u),
    prisma.payable.findMany({
      where: { ...projectScope(u) },
      include: { supplier: true, project: { select: { name: true, packageName: true } }, lines: true, payments: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Hàng đã nhận chưa lên công nợ: gom theo dự án + NCC
  const groups = new Map<string, { projectId: string; supplierId: string; project: string; supplier: string; n: number; amount: number }>();
  for (const l of unbilled) {
    const p = l.item.order.project;
    const k = `${p.id}|${l.receipt.supplierId}`;
    const g = groups.get(k) ?? { projectId: p.id, supplierId: l.receipt.supplierId, project: p.packageName ? `${p.name} — ${p.packageName}` : p.name, supplier: l.receipt.supplier.name, n: 0, amount: 0 };
    g.n++;
    g.amount += l.amount;
    groups.set(k, g);
  }

  // Tổng hợp công nợ theo NCC (chỉ các đợt đã gửi kế toán)
  const bySupplier = new Map<string, { name: string; total: number; paid: number }>();
  for (const p of payables) {
    if (p.status === "DRAFT") continue;
    const t = payableTotals(p);
    const s = bySupplier.get(p.supplierId) ?? { name: p.supplier.name, total: 0, paid: 0 };
    s.total += t.total;
    s.paid += t.paid;
    bySupplier.set(p.supplierId, s);
  }

  const shown = sp.status === "SENT" ? payables.filter((p) => p.status === "SENT" || p.status === "PARTIAL") : sp.status ? payables.filter((p) => p.status === sp.status) : payables;
  const filters = [{ label: "Tất cả", href: "/mua-vat-tu/cong-no", on: !sp.status }, ...Object.entries(PAY_STATUS).map(([k, v]) => ({ label: v.label, href: `/mua-vat-tu/cong-no?status=${k}`, on: sp.status === k }))];

  return (
    <div className="space-y-4">
      {groups.size > 0 && (
        <Section title="Hàng BCH đã nhận — chưa lên công nợ">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Dự án</th>
                <th className={th}>Nhà cung cấp</th>
                <th className={th}>Số dòng nhận</th>
                <th className={`${th} text-right`}>Giá trị (gồm VAT)</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {[...groups.values()].map((g) => (
                <tr key={`${g.projectId}|${g.supplierId}`} className="border-t border-slate-100">
                  <td className={td}>{g.project}</td>
                  <td className={td}>{g.supplier}</td>
                  <td className={td}>{g.n}</td>
                  <td className={`${td} text-right font-medium`}>{fmtMoney(g.amount)}</td>
                  <td className={`${td} text-right`}>
                    {can(u, "CBVT") && (
                      <Link href={`/mua-vat-tu/cong-no/moi?project=${g.projectId}&supplier=${g.supplierId}`} className="rounded-md bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-800">
                        Lên công nợ đợt →
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section title="Công nợ từng đợt / đề nghị thanh toán">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <Link key={f.href} href={f.href} className={`rounded-full border px-3 py-1 text-xs ${f.on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
              {f.label}
            </Link>
          ))}
        </div>
        {shown.length === 0 ? (
          <Empty>Chưa có công nợ</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Số</th>
                  <th className={th}>Nhà cung cấp</th>
                  <th className={th}>Dự án</th>
                  <th className={th}>Nội dung</th>
                  <th className={`${th} text-right`}>Giá trị (gồm VAT)</th>
                  <th className={`${th} text-right`}>Đã chi</th>
                  <th className={`${th} text-right`}>Còn phải trả</th>
                  <th className={th}>Hạn TT</th>
                  <th className={th}>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const t = payableTotals(p);
                  return (
                    <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className={td}>
                        <LinkText href={`/mua-vat-tu/cong-no/${p.id}`}>{p.code}</LinkText>
                      </td>
                      <td className={td}>{p.supplier.name}</td>
                      <td className={td}>{p.project.name}</td>
                      <td className={td}>{p.title}</td>
                      <td className={`${td} text-right`}>{fmtMoney(t.total)}</td>
                      <td className={`${td} text-right`}>{t.paid ? fmtMoney(t.paid) : ""}</td>
                      <td className={`${td} text-right font-medium`}>{fmtMoney(t.remaining)}</td>
                      <td className={td}>{fmtDate(p.dueDate)}</td>
                      <td className={td}>
                        <Badge map={PAY_STATUS} status={p.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Tổng hợp công nợ theo nhà cung cấp" right={<span className="text-xs text-slate-500">Chỉ tính các đợt đã gửi kế toán</span>}>
        {bySupplier.size === 0 ? (
          <Empty>Chưa có</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Nhà cung cấp</th>
                <th className={`${th} text-right`}>Tổng công nợ</th>
                <th className={`${th} text-right`}>Đã thanh toán</th>
                <th className={`${th} text-right`}>Còn nợ</th>
              </tr>
            </thead>
            <tbody>
              {[...bySupplier.values()]
                .sort((a, b) => b.total - b.paid - (a.total - a.paid))
                .map((s) => (
                  <tr key={s.name} className="border-t border-slate-100">
                    <td className={td}>{s.name}</td>
                    <td className={`${td} text-right`}>{fmtMoney(s.total)}</td>
                    <td className={`${td} text-right`}>{fmtMoney(s.paid)}</td>
                    <td className={`${td} text-right font-semibold`}>{fmtMoney(s.total - s.paid)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
