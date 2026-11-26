import { notFound } from "next/navigation";
import { getProjectWithBoq, VT_QTY_GROUP } from "@/lib/project-data";
import { loadSheet } from "@/lib/tonghop";
import TongHopBoard from "../TongHopBoard";
import { LinkBarProvider } from "../LinkBar";

export default async function Page({ params }: PageProps<"/projects/[id]/vat-tu">) {
  const { id } = await params;
  const project = await getProjectWithBoq(id);
  if (!project) notFound();
  const { rows, groups } = await loadSheet(project, "VT");
  return (
    <LinkBarProvider options={project.formulaCtx.options.filter((o) => o.group !== VT_QTY_GROUP)} values={project.formulaCtx.sources}>
      <TongHopBoard projectId={id} kind="VT" rows={rows} groups={groups} />
    </LinkBarProvider>
  );
}
