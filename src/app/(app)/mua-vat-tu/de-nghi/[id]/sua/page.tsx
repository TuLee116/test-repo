import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { can, canSeeProject, getProcUser, visibleProjects } from "@/lib/proc";
import { getMaterialBudget, getRequestDefaults } from "@/lib/proc-budget";
import RequestEditor from "../../RequestEditor";

export default async function EditRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = (await getProcUser())!;
  const r = await prisma.materialRequest.findUnique({ where: { id }, include: { items: { orderBy: { orderIndex: "asc" } } } });
  if (!r || !canSeeProject(u, r.projectId)) notFound();
  if (!can(u, "GS", "CHT") || (r.status !== "DRAFT" && r.status !== "REJECTED")) return <p className="text-sm text-red-600">Phiếu này không sửa được (đã gửi duyệt hoặc bạn không có quyền).</p>;
  const [projects, budget, defaults] = await Promise.all([visibleProjects(u), getMaterialBudget(r.projectId, r.id), getRequestDefaults(r.projectId, r)]);
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold text-slate-900">Sửa phiếu đề nghị {r.code}</h2>
      <RequestEditor
        requestId={r.id}
        projects={projects}
        projectId={r.projectId}
        budget={budget}
        initial={{
          title: r.title,
          neededDate: r.neededDate ? r.neededDate.toISOString().slice(0, 10) : "",
          note: r.note,
          contractNo: r.contractNo,
          category: r.category,
          area: r.area,
          batchNo: defaults.batchNo,
          items: r.items.map((it) => ({
            resourceId: it.resourceId,
            name: it.name,
            spec: it.spec,
            unit: it.unit,
            quantity: it.quantity,
            note: it.note,
            contractQty: it.contractQty,
            finalQty: it.finalQty,
            forecastQty: it.forecastQty,
          })),
        }}
      />
    </div>
  );
}
