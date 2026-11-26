import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updateProjectInfoAction } from "@/lib/actions";
import { PACKAGE_TYPES } from "@/lib/package-types";
import ContractFields from "../../ContractFields";

export default async function ProjectInfoPage({ params }: PageProps<"/projects/[id]/info">) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id }, include: { contract: true } });
  if (!project) notFound();
  // hợp đồng có thể chuyển sang: các hợp đồng đã gom + các dự án chưa gom (trừ chính dự án này và hợp đồng đang thuộc)
  const others = await prisma.project.findMany({ where: { id: { not: id } }, include: { contract: true }, orderBy: { updatedAt: "desc" } });
  const seen = new Set<string>(project.contractId ? [project.contractId] : []);
  const contractOptions: { value: string; label: string }[] = [];
  for (const o of others) {
    if (o.contractId) {
      if (seen.has(o.contractId)) continue;
      seen.add(o.contractId);
      contractOptions.push({ value: `c:${o.contractId}`, label: `${o.contract?.name ?? o.name} (${others.filter((x) => x.contractId === o.contractId).length} DT-CP)` });
    } else contractOptions.push({ value: `p:${o.id}`, label: `${o.name} (1 DT-CP)` });
  }
  const contractCount = project.contractId ? await prisma.project.count({ where: { contractId: project.contractId } }) : 1;

  const updateInfo = async (formData: FormData) => {
    "use server";
    await updateProjectInfoAction(project.id, formData);
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="font-medium text-slate-900">Thông tin dự án</h2>
      <form action={updateInfo} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Tên dự án" name="name" defaultValue={project.name} />
        <Field label="Tên gói thầu" name="packageName" defaultValue={project.packageName} />
        <Field label="Số hợp đồng" name="contractNo" defaultValue={project.contractNo} />
        <Field label="Tổng Thầu" name="investor" defaultValue={project.investor} />
        <Field label="Địa điểm xây dựng" name="location" defaultValue={project.location} />
        <div>
          <label className="block text-sm font-medium text-slate-700">Loại gói thầu</label>
          <select name="packageType" defaultValue={project.packageType} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none">
            {PACKAGE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Khu vực</label>
          <select name="area" defaultValue={project.area} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none">
            <option value="">— Chưa chọn —</option>
            {["1", "2", "3", "4", "5"].map((a) => (
              <option key={a} value={a}>
                Khu vực {a}
              </option>
            ))}
          </select>
        </div>
        <ContractFields options={contractOptions} current={{ name: project.contract?.name ?? "", count: contractCount }} />
        <Field
          label="Thuế suất GTGT (%)"
          name="vatRate"
          type="number"
          step="0.01"
          defaultValue={(project.vatRate * 100).toString()}
        />
        <div className="sm:col-span-2 lg:col-span-3">
          <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
            Lưu thông tin dự án
          </button>
        </div>
      </form>
    </section>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  step,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  type?: string;
  step?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      <input
        name={name}
        type={type}
        step={step}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
      />
    </div>
  );
}
