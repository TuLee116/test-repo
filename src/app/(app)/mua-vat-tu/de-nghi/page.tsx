import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { can, fmtDate, getProcUser, projectScope, REQ_STATUS } from "@/lib/proc";
import { Badge, Empty, LinkText, Section, td, th } from "../ui";

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ status?: string; mine?: string; project?: string }> }) {
  const sp = await searchParams;
  const u = (await getProcUser())!;
  const requests = await prisma.materialRequest.findMany({
    where: {
      ...projectScope(u),
      ...(sp.status ? { status: sp.status } : {}),
      ...(sp.mine ? { createdById: u.id, status: { in: ["DRAFT", "REJECTED"] } } : {}),
      ...(sp.project ? { projectId: sp.project } : {}),
    },
    include: { project: { select: { name: true, packageName: true } }, _count: { select: { items: true } } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const filters = [
    { label: "Tất cả", href: "/mua-vat-tu/de-nghi", on: !sp.status && !sp.mine },
    ...Object.entries(REQ_STATUS).map(([k, v]) => ({ label: v.label, href: `/mua-vat-tu/de-nghi?status=${k}`, on: sp.status === k })),
  ];
  return (
    <Section
      title="Phiếu đề nghị mua vật tư"
      right={
        can(u, "GS", "CHT") && (
          <Link href="/mua-vat-tu/de-nghi/moi" className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800">
            + Lập phiếu đề nghị
          </Link>
        )
      }
    >
      <div className="mb-3 flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <Link key={f.href} href={f.href} className={`rounded-full border px-3 py-1 text-xs ${f.on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
            {f.label}
          </Link>
        ))}
      </div>
      {requests.length === 0 ? (
        <Empty>Chưa có phiếu đề nghị nào</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Số phiếu</th>
                <th className={th}>Dự án</th>
                <th className={th}>Nội dung / đợt</th>
                <th className={th}>Số dòng</th>
                <th className={th}>Ngày cần hàng</th>
                <th className={th}>Người lập</th>
                <th className={th}>Ngày lập</th>
                <th className={th}>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className={td}>
                    <LinkText href={`/mua-vat-tu/de-nghi/${r.id}`}>{r.code}</LinkText>
                  </td>
                  <td className={td}>
                    {r.project.name}
                    {r.project.packageName && <span className="block text-xs text-slate-400">{r.project.packageName}</span>}
                  </td>
                  <td className={td}>{r.title}</td>
                  <td className={td}>{r._count.items}</td>
                  <td className={td}>{fmtDate(r.neededDate)}</td>
                  <td className={td}>{r.createdByName}</td>
                  <td className={td}>{fmtDate(r.createdAt)}</td>
                  <td className={td}>
                    <Badge map={REQ_STATUS} status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
