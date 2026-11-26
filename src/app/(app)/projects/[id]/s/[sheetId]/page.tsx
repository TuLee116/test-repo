import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import BoqSheetView from "../../BoqSheetView";
import GridSheetView from "../../GridSheetView";

export default async function CustomSheetPage({ params }: { params: Promise<{ id: string; sheetId: string }> }) {
  const { id, sheetId } = await params;
  const sheet = await prisma.projectSheet.findUnique({ where: { id: sheetId }, select: { id: true, projectId: true, kind: true } });
  if (!sheet || sheet.projectId !== id) notFound();
  if (sheet.kind === "GRID") return <GridSheetView projectId={id} sheetId={sheetId} />;
  return <BoqSheetView projectId={id} sheetId={sheetId} />;
}
