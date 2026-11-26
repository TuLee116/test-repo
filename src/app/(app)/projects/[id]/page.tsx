import { notFound } from "next/navigation";
import { getProjectWithBoq } from "@/lib/project-data";
import { getDtcpData } from "@/lib/dtcp";
import Letterhead from "./Letterhead";
import DtcpTable from "./DtcpTable";
import ProgressField from "./ProgressField";

export default async function ProjectDtCpPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  const project = await getProjectWithBoq(id);
  if (!project) notFound();

  const { rows, columns, totalA, totalB, gridLinkOptions, linkPickerOptions, linkValues } = await getDtcpData(project);

  return (
    <section className="dtcp-sheet rounded-lg border border-slate-200 bg-white p-6">
      <Letterhead />

      <div className="mt-4 text-center font-bold text-slate-900">
        <h2 className="text-lg">BẢNG TỔNG HỢP DỰ TRÙ</h2>
        <h2 className="text-2xl">DOANH THU - CHI PHÍ</h2>
      </div>
      <div className="mt-3 space-y-0.5 text-sm text-slate-700">
        <p>
          <span className="font-medium">Dự án:</span> {project.name}
        </p>
        <p>
          <span className="font-medium">Gói thầu:</span> {project.packageName || "-"} &nbsp;|&nbsp;
          <span className="font-medium"> Tổng Thầu:</span> {project.investor || "-"}
        </p>
        <p>
          <span className="font-medium">Địa điểm:</span> {project.location || "-"} &nbsp;|&nbsp;
          <span className="font-medium"> Ngày lập:</span> {project.preparedDate.toLocaleDateString("vi-VN")}
        </p>
        <p>
          <span className="font-medium">Tiến độ:</span> <ProgressField projectId={id} value={project.progress} />
        </p>
      </div>

      <div className="mt-5">
        <DtcpTable
          projectId={id}
          rows={rows}
          columns={columns.map((c) => ({ id: c.id, title: c.title }))}
          totalA={totalA}
          totalB={totalB}
          vatRate={project.vatRate}
          extraLinkOptions={gridLinkOptions}
          linkOptions={linkPickerOptions}
          linkValues={linkValues}
        />
      </div>
    </section>
  );
}
