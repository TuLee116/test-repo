import { prisma } from "@/lib/prisma";
import { can, fmtDate, getProcUser } from "@/lib/proc";
import { pendingRequestItems } from "@/lib/proc-tasks";
import OrderCreator from "./OrderCreator";

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const sp = await searchParams;
  const u = (await getProcUser())!;
  if (!can(u, "CBVT")) return <p className="text-sm text-red-600">Chỉ cán bộ vật tư được lên đơn hàng.</p>;
  if (!sp.project) return <p className="text-sm text-slate-500">Chọn dự án từ danh sách &quot;chờ lên đơn hàng&quot;.</p>;
  const project = await prisma.project.findUnique({ where: { id: sp.project }, select: { name: true, packageName: true, location: true } });
  const items = await pendingRequestItems(u, sp.project);
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold text-slate-900">
        Lên đơn hàng — {project?.name}
        {project?.packageName && ` — ${project.packageName}`}
      </h2>
      <OrderCreator
        projectId={sp.project}
        defaultPlace={project?.location ?? ""}
        items={items.map((it) => ({
          id: it.id,
          reqCode: it.request.code,
          reqTitle: it.request.title,
          neededDate: fmtDate(it.request.neededDate),
          name: it.name,
          spec: it.spec,
          unit: it.unit,
          quantity: it.quantity,
          ordered: it.ordered,
          remaining: it.remaining,
          note: it.note,
        }))}
      />
    </div>
  );
}
