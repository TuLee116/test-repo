import { notFound } from "next/navigation";
import { getProjectWithBoq } from "@/lib/project-data";
import { loadSheet } from "@/lib/tonghop";
import TongHopBoard from "../TongHopBoard";
import { LinkBarProvider } from "../LinkBar";
import LaborModeToggle from "./LaborModeToggle";

export default async function Page({ params }: PageProps<"/projects/[id]/nhan-cong">) {
  const { id } = await params;
  const project = await getProjectWithBoq(id);
  if (!project) notFound();
  const { rows, groups } = await loadSheet(project, "NC");
  return (
    <LinkBarProvider options={project.formulaCtx.options} values={project.formulaCtx.sources}>
      <LaborModeToggle projectId={id} on={project.laborByWork} />
      <TongHopBoard projectId={id} kind="NC" rows={rows} groups={groups} />
    </LinkBarProvider>
  );
}
