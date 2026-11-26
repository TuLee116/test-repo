import { NextResponse } from "next/server";
import { fixXlsx } from "@/lib/excel-fix";
import { getProjectWithBoq } from "@/lib/project-data";
import { buildProjectWorkbook } from "@/lib/excel-export";

// Xuất toàn bộ dự án ra Excel: mọi sheet, công thức và liên kết giữa các sheet là công thức Excel thật (xem excel-export.ts)
export async function GET(_req: Request, { params }: RouteContext<"/api/projects/[id]/export">) {
  const { id } = await params;

  const project = await getProjectWithBoq(id);
  if (!project) return NextResponse.json({ error: "Không tìm thấy dự án" }, { status: 404 });

  const wb = await buildProjectWorkbook(project);
  const buffer = await fixXlsx(await wb.xlsx.writeBuffer());
  const filename = encodeURIComponent(`DT-CP_${project.name}.xlsx`);

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
