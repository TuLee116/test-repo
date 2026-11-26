import { notFound } from "next/navigation";
import { getProjectWithBoq } from "@/lib/project-data";
import { loadSheet } from "@/lib/tonghop";
import { loadEquipCatalog } from "@/lib/equip";
import { prisma } from "@/lib/prisma";
import TongHopBoard from "../TongHopBoard";
import { LinkBarProvider } from "../LinkBar";

export default async function Page({ params }: PageProps<"/projects/[id]/thiet-bi">) {
  const { id } = await params;
  const project = await getProjectWithBoq(id);
  if (!project) notFound();
  const [{ rows, groups }, items, calcs] = await Promise.all([
    loadSheet(project, "TB"),
    loadEquipCatalog(),
    prisma.equipCalc.findMany({ where: { projectId: id }, orderBy: { orderIndex: "asc" } }),
  ]);
  return (
    <LinkBarProvider options={project.formulaCtx.options} values={project.formulaCtx.sources}>
      <TongHopBoard
        projectId={id}
        kind="TB"
        rows={rows}
        groups={groups}
        equip={{ items, calcs: calcs.map((c) => ({ id: c.id, kind: c.kind, name: c.name, params: c.params, updatedAt: c.updatedAt.toISOString() })) }}
      />
    </LinkBarProvider>
  );
}
