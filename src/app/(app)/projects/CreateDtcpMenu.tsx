import { prisma } from "@/lib/prisma";
import { createProjectAction } from "@/lib/actions";
import { PACKAGE_TYPES } from "@/lib/package-types";
import CreateDtcpButton from "./CreateDtcpButton";
import ContractFields from "./ContractFields";
import ProjectPicker, { type ExistingProject } from "./ProjectPicker";

// Nút "Tạo DT-CP" trên thanh menu đầu trang (dùng ở mọi trang): nạp danh sách dự án / hợp đồng cho biểu mẫu
export default async function CreateDtcpMenu() {
  const projects = await prisma.project.findMany({
    select: { id: true, name: true, packageName: true, investor: true, location: true, contractId: true, contract: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
  });
  const contractOptions = (() => {
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    for (const p of projects) {
      if (p.contractId) {
        if (seen.has(p.contractId)) continue;
        seen.add(p.contractId);
        const n = projects.filter((x) => x.contractId === p.contractId).length;
        out.push({ value: `c:${p.contractId}`, label: `${p.contract?.name ?? p.name} (${n} DT-CP)` });
      } else out.push({ value: `p:${p.id}`, label: `${p.name} (1 DT-CP)` });
    }
    return out;
  })();

  // Dự án đang có (1 dự án nhiều gói thầu): gom theo tên dự án, lấy Tổng Thầu / địa điểm của gói mới nhất
  const existingProjects: ExistingProject[] = [];
  for (const p of projects) {
    const norm = (x: string) => x.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
    const key = norm(p.name);
    const ex = existingProjects.find((x) => norm(x.name) === key);
    if (ex) ex.packages.push(p.packageName);
    else existingProjects.push({ name: p.name.trim(), investor: p.investor, location: p.location, packages: [p.packageName] });
  }
  existingProjects.sort((a, b) => a.name.localeCompare(b.name, "vi"));

  return (
    <CreateDtcpButton>
        <form action={createProjectAction} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ProjectPicker projects={existingProjects} />
          <div>
            <label className="block text-sm font-medium text-slate-700">Loại gói thầu</label>
            <select name="packageType" defaultValue="THO" className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none">
              {PACKAGE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Khu vực</label>
            <select name="area" defaultValue="" className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none">
              <option value="">— Chưa chọn —</option>
              {["1", "2", "3", "4", "5"].map((a) => (
                <option key={a} value={a}>
                  Khu vực {a}
                </option>
              ))}
            </select>
          </div>
          <ContractFields options={contractOptions} />
          <div className="sm:col-span-2 lg:col-span-4">
            <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
              Tạo DT-CP
            </button>
          </div>
        </form>
    </CreateDtcpButton>
  );
}
