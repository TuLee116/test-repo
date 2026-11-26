import { canDtcp } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import CatalogTable from "./CatalogTable";

export default async function CatalogPage() {
  const isAdmin = await canDtcp("NORM_REVIEW");

  const workItems = await prisma.workItem.findMany({
    where: { active: true },
    include: { resources: { include: { resource: true } } },
    orderBy: [{ section: "asc" }, { subsection: "asc" }, { name: "asc" }],
  });

  const catOrder: Record<string, number> = { VT: 0, NC: 1, TB: 2 };
  const rows = workItems.map((wi) => ({
    id: wi.id,
    code: wi.code,
    name: wi.name,
    unit: wi.unit,
    section: wi.section,
    subsection: wi.subsection,
    lines: [...wi.resources]
      .sort((x, y) => catOrder[x.category] - catOrder[y.category])
      .map((l) => ({
        id: l.id,
        category: l.category as "VT" | "NC" | "TB",
        code: l.resource.code,
        name: l.resource.name,
        unit: l.resource.unit,
        quantity: l.quantity,
        formula: l.quantityFormula,
      })),
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <section>
        <h1 className="text-xl font-semibold text-slate-900">Định Mức</h1>
        <p className="mt-1 text-sm text-slate-500">
          {workItems.length} công tác — bấm vào từng công tác để xem định mức hao phí (vật tư, nhân công, máy thi công). Đơn giá thực tế nhập riêng cho từng dự án.
        </p>
        <div className="mt-4">
          <CatalogTable rows={rows} isAdmin={isAdmin} />
        </div>
      </section>
    </div>
  );
}
