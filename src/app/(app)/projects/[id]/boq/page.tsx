import BoqSheetView from "../BoqSheetView";

export default async function ProjectBoqPage({ params }: PageProps<"/projects/[id]/boq">) {
  const { id } = await params;
  return <BoqSheetView projectId={id} sheetId={null} />;
}
