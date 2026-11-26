import { can, canSeeProject, getProcUser, visibleProjects } from "@/lib/proc";
import { getMaterialBudget, getRequestDefaults } from "@/lib/proc-budget";
import RequestEditor from "../RequestEditor";

export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const sp = await searchParams;
  const u = (await getProcUser())!;
  if (!can(u, "GS", "CHT")) return <p className="text-sm text-red-600">Chỉ giám sát / chỉ huy trưởng (BCH) được lập phiếu đề nghị.</p>;
  const projects = await visibleProjects(u);
  const projectId = sp.project && canSeeProject(u, sp.project) ? sp.project : projects.length === 1 ? projects[0].id : "";
  const [budget, defaults] = projectId ? await Promise.all([getMaterialBudget(projectId), getRequestDefaults(projectId)]) : [[], { contractNo: "", category: "", area: "", batchNo: 1 }];
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold text-slate-900">Lập phiếu đề nghị mua vật tư — Giấy đề xuất vật tư</h2>
      {projects.length === 0 && <p className="text-sm text-amber-700">Bạn chưa thuộc Ban Chỉ Huy dự án nào — nhờ quản trị thêm ở Phân quyền.</p>}
      <RequestEditor requestId={null} projects={projects} projectId={projectId} budget={budget} initial={{ title: "", neededDate: "", note: "", ...defaults, items: [] }} />
    </div>
  );
}
