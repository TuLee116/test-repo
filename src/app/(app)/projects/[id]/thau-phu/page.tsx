import { notFound } from "next/navigation";
import { getProjectWithBoq, VT_QTY_GROUP } from "@/lib/project-data";
import { loadSubSheet } from "@/lib/thauphu";
import ThauPhuBoard from "../ThauPhuBoard";
import { LinkBarProvider } from "../LinkBar";

export default async function ProjectThauPhuPage({ params }: PageProps<"/projects/[id]/thau-phu">) {
  const { id } = await params;
  const project = await getProjectWithBoq(id);
  if (!project) notFound();
  const sheet = await loadSubSheet(project);
  return (
    <LinkBarProvider options={project.formulaCtx.options.filter((o) => o.group !== VT_QTY_GROUP)} values={project.formulaCtx.sources}>
      <ThauPhuBoard projectId={id} sheet={sheet} />
    </LinkBarProvider>
  );
}
