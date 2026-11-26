import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAccess, inAreas } from "@/lib/access";
import { DTCP_TPS, dtcpTodoOf, parseTp } from "@/lib/dtcp-approval";
import TabNav from "./TabNav";
import SheetFrame from "./SheetFrame";
import DtcpApprovalBar from "./DtcpApprovalBar";
import TaskWorkspace from "../../TaskWorkspace";
import { qsttUsers } from "@/lib/dtcp-qstt";
import { loadSites } from "@/lib/project-site";

const fmt = (d: Date | null) => (d ? d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }) : "");

export default async function ProjectLayout({ children, params }: LayoutProps<"/projects/[id]">) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true, siteId: true, packageName: true, area: true, contractNo: true, dtcpQsttId: true, dtcpQsttName: true, dtcpTpKey: true, dtcpStatus: true, dtcpTp: true, dtcpNote: true, dtcpSubmittedBy: true, dtcpSubmittedAt: true, dtcpApprovedBy: true, dtcpApprovedAt: true },
  });
  if (!project) notFound();
  // xem DT-CP: có quyền DT-CP + thuộc khu vực của mình
  const a = await getAccess();
  if (!a) redirect("/login");
  if (!a.isAdmin && (!a.apps.has("DTCP") || !a.dtcp.size || !inAreas(a, project.area))) redirect("/projects");
  const has = (c: string) => a.isAdmin || a.dtcp.has(c);

  // QSĐT sắp trình DT-CP: danh sách QSTT để chọn
  const qsttOptions = project.dtcpStatus === "DRAFT" && has("EDIT") ? await qsttUsers(project.area) : [];
  const sites = project.dtcpStatus === "DRAFT" && has("EDIT") ? await loadSites() : []; // DANH MỤC DỰ ÁN: chọn khi trình
  const [sheets, logs] = await Promise.all([
    prisma.projectSheet.findMany({ where: { projectId: id }, orderBy: { orderIndex: "asc" }, select: { id: true, name: true, kind: true } }),
    prisma.procLog.findMany({ where: { entity: "DTCP", entityId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  // TÁC VỤ của người đang xem → cửa sổ làm việc toàn màn hình (giống trình giá đội / thầu phụ); không có tác vụ thì xem bình thường
  const todo = dtcpTodoOf(project, a.dtcp, a.id);
  const task = project.dtcpStatus === "DRAFT" && has("EDIT") ? "QSĐT · Lập DT-CP" : todo ? `DT-CP · ${todo}` : "";

  const bar = (
    <DtcpApprovalBar
        sticky={!!task}
        projectId={project.id}
        status={project.dtcpStatus}
        tp={parseTp(project.dtcpTp)}
        note={project.dtcpNote}
        submitted={project.dtcpSubmittedBy ? `Trình bởi ${project.dtcpSubmittedBy} · ${fmt(project.dtcpSubmittedAt)}` : ""}
        approved={project.dtcpApprovedBy ? `${project.dtcpApprovedBy} · ${fmt(project.dtcpApprovedAt)}` : ""}
        contractNo={project.contractNo}
        sites={sites}
        siteId={project.siteId ?? ""}
        projectName={project.name}
        area={project.area}
        qsttOptions={qsttOptions}
        qsttId={project.dtcpQsttId}
        qsttName={project.dtcpQsttName}
        tpKey={project.dtcpTpKey}
        can={{ edit: has("EDIT"), qstt: has("QSTT") && (!project.dtcpQsttId || a.isAdmin || a.id === project.dtcpQsttId), ptg: has("PTG"), tp: DTCP_TPS.filter((t) => has(t.perm)).map((t) => t.key) }}
        logs={logs.map((l) => ({ at: fmt(l.createdAt), action: l.action, user: l.userName, note: l.note }))}
      />
  );

  const exportLink = (
    <a href={`/api/projects/${project.id}/export`} className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50">
      Xuất Excel (tất cả sheet)
    </a>
  );

  const content = (
    <div className="space-y-0">
      {!task && <div className="flex items-center justify-between rounded-t-lg border border-b-0 border-slate-200 bg-white p-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{project.name}</h1>
          <p className="text-sm text-slate-500">{project.packageName}</p>
        </div>
        <a
          href={`/api/projects/${project.id}/export`}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          Xuất Excel (tất cả sheet)
        </a>
      </div>}
      {!task && bar}
      <TabNav projectId={project.id} sheets={sheets} extra={task ? exportLink : undefined} />
      <div className={`rounded-b-lg border border-slate-200 bg-slate-50 ${task ? "p-2" : "p-4"}`}>
        <SheetFrame projectId={project.id}>{children}</SheetFrame>
      </div>
      {/* cửa sổ toàn màn hình: thanh Trình / Duyệt luôn hiện ở đáy */}
      {task && bar}
    </div>
  );

  if (!task) return content;
  return (
    <TaskWorkspace title={task} code={project.contractNo || project.name} sub={project.packageName} exitHref="/projects" layer="z-[45]">
      {content}
    </TaskWorkspace>
  );
}
