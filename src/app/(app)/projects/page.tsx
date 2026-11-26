import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { areaWhere, getAccess } from "@/lib/access";
import { normalizePackageType } from "@/lib/package-types";
import { getProjectWithBoq } from "@/lib/project-data";
import { getDtcpData } from "@/lib/dtcp";
import { computeProjectTotals } from "@/lib/sheet-links";
import Dashboard, { type ProjectStat } from "./Dashboard";

export default async function ProjectsPage() {
  const access = await getAccess();
  if (!access) redirect("/login");
  if (!access.isAdmin && (!access.apps.has("DTCP") || !access.dtcp.size)) redirect("/khong-co-quyen");
  const projects = await prisma.project.findMany({
    where: areaWhere(access),
    include: { createdBy: true },
    orderBy: { updatedAt: "desc" },
  });
  // Số liệu dashboard: doanh thu / chi phí lấy từ DT-CP của từng dự án (cùng cách tính với sheet DT-CP)
  const stats: ProjectStat[] = [];
  const statById = new Map<string, ProjectStat>();
  for (const p of projects) {
    try {
      const full = await getProjectWithBoq(p.id);
      if (!full) continue;
      const d = await getDtcpData(full);
      const t = computeProjectTotals(full, {}).named;
      const st: ProjectStat = {
        id: p.id,
        name: p.name,
        packageName: p.packageName,
        packageType: normalizePackageType(p.packageType),
        area: p.area || "",
        creator: p.createdBy.name,
        year: p.preparedDate.getFullYear(),
        revenue: d.totalA / (1 + full.vatRate),
        cost: d.totalB,
        parts: { vl: t.vl, nc: t.nc, m: t.m, tp: t.subcontractor, other: t.other },
      };
      stats.push(st);
      statById.set(p.id, st);
    } catch {
      // dự án lỗi dữ liệu thì bỏ qua khỏi dashboard, vẫn hiện trong danh sách
    }
  }

  return (
    <div className="space-y-8">
      <div className="min-w-0 space-y-8">
      <section>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Dự án</h1>
            <p className="mt-1 text-sm text-slate-500">Mở từng hợp đồng / gói thầu (mỗi gói thầu là 1 DT-CP) ở cụm <b>DT-CP</b> của menu bên trái: Khu vực → Dự án → Hợp đồng.</p>
          </div>
        </div>

        <div className="mt-4">
          <Dashboard stats={stats} />
        </div>
      </section>

      </div>
    </div>
  );
}
