import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import GridEditor from "./GridEditor";
import { syncGridStt } from "@/lib/grid-stt-sync";
import { effectiveAutoStt } from "@/lib/grid-auto-stt";
import { parseMerges } from "@/lib/grid-merge";
import SheetHeader from "./SheetHeader";
import { getProjectWithBoq } from "@/lib/project-data";
import { getGridSources } from "@/lib/sheet-links";

export default async function GridSheetView({ projectId, sheetId }: { projectId: string; sheetId: string }) {
  const first = await prisma.projectSheet.findUnique({ where: { id: sheetId } });
  if (!first || first.projectId !== projectId || first.kind !== "GRID") notFound();
  // bảng đang bật tự đánh số STT: đưa cột STT về đúng trước khi hiển thị (VD dữ liệu gõ trước khi có tính năng)
  await syncGridStt(sheetId);
  const sheet = (await prisma.projectSheet.findUnique({ where: { id: sheetId }, include: { cells: true, metas: true } }))!;
  const cells: Record<string, string> = {};
  const styles: Record<string, string> = {};
  for (const c of sheet.cells) {
    cells[`${c.row}:${c.col}`] = c.value;
    if (c.style) styles[`${c.row}:${c.col}`] = c.style;
  }
  const headings: Record<number, { id: string; title: string; showInDtcp: boolean; stt: string | null; level: number }> = {};
  for (const m of sheet.metas) headings[m.row] = { id: m.id, title: m.title, showInDtcp: m.showInDtcp, stt: m.stt, level: m.level };
  // nguồn liên kết cho hàm LINK("khoá") trong công thức: BOQ, TH Vật Tư / Nhân Công / Thiết Bị / Thầu Phụ...
  const project = await getProjectWithBoq(projectId);
  const sources = project ? await getGridSources(project) : { values: {}, options: [] };
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <SheetHeader projectId={projectId} sheetId={sheet.id} name={sheet.name} />
      <GridEditor
        projectId={projectId}
        sheetId={sheet.id}
        colTitles={JSON.parse(sheet.colTitles) as string[]}
        rowCount={sheet.rowCount}
        amountCol={sheet.amountCol}
        linkCol={sheet.linkCol}
        cells={cells}
        styles={styles}
        merges={parseMerges(sheet.merges)}
        headerRows={JSON.parse(sheet.headerRows) as string[][]}
        autoStt={effectiveAutoStt(sheet.autoStt, (JSON.parse(sheet.colTitles) as string[])[0], (JSON.parse(sheet.colTitles) as string[]).length)}
        headings={headings}
        linkValues={sources.values}
        linkOptions={sources.options}
      />
    </section>
  );
}
