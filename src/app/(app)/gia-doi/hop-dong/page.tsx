import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { fmtDate } from "@/lib/proc";
import { getPriceUser } from "@/lib/gia-doi";
import { canManageContracts, controlVersion, parseVersions } from "@/lib/hop-dong";
import { Empty, Section, td, th } from "../../mua-vat-tu/ui";
import { FromProject, ImportButton } from "./ContractButtons";
import { canManageSites, contractKey, loadContractCodes, loadSites } from "@/lib/project-site";
import { ContractCode, NoSiteFilter, SiteTag } from "../../du-an/SiteBits";

// Danh sách hợp đồng (mỗi hợp đồng = 1 DT-CP) dùng để kiểm soát giá đội / thầu phụ
export default async function ContractsPage({ searchParams }: { searchParams: Promise<{ import?: string; nosite?: string }> }) {
  const sp = await searchParams;
  const cmap = await loadContractCodes(); // MÃ HỢP ĐỒNG theo BẢNG TT DỰ ÁN (tra theo số HĐ)
  const u = (await getPriceUser())!;
  const can = canManageContracts(u);
  const [contracts, projects] = await Promise.all([
    prisma.costContract.findMany({
      where: u.areas ? { area: { in: [...u.areas, ""] } } : {},
      orderBy: { updatedAt: "desc" },
      include: { site: { select: { code: true, name: true, status: true } }, _count: { select: { approvals: true, submissions: true } }, lines: { where: { kind: "NC", level: "ITEM" }, select: { id: true } } },
    }),
    can ? prisma.project.findMany({ where: u.areas ? { area: { in: [...u.areas, ""] } } : {}, orderBy: { name: "asc" }, select: { id: true, name: true, packageName: true } }) : Promise.resolve([]),
  ]);
  // lọc: chỉ hợp đồng CHƯA gắn mã dự án
  const shown = sp.nosite === "1" ? contracts.filter((c) => !c.site) : contracts;
  return (
    <div className="space-y-4">
      {can && (
        <section className="space-y-3 rounded-lg border border-sky-200 bg-sky-50/40 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1">
              <p className="font-medium text-slate-900">Thêm hợp đồng</p>
              <p className="text-xs text-slate-500">Mỗi hợp đồng = 1 DT-CP. Hợp đồng cũ: nhập file DT-CP Excel (chọn sheet Nhân Công, Thầu Phụ...). Hợp đồng mới: lấy từ DT-CP lập trên phần mềm.</p>
            </div>
            <ImportButton label="📥 Nhập DT-CP Excel (hợp đồng cũ)" autoOpen={sp.import === "1"} sites={await loadSites()} parents={contracts.filter((c) => !c.appendixOfId).map((c) => ({ id: c.id, name: c.name, area: c.area, contractNo: c.contractNo, packageName: c.packageName }))} />
          </div>
          <FromProject projects={projects.map((p) => ({ id: p.id, label: p.packageName ? `${p.name} — ${p.packageName}` : p.name }))} />
        </section>
      )}
      {(() => {
        const n = contracts.filter((c) => !c.site).length;
        return <NoSiteFilter href="/gia-doi/hop-dong" on={sp.nosite === "1"} total={n} approved={0} manage={canManageSites(u)} noun="hợp đồng" hint="Hợp đồng chưa gắn mã: bấm tên hợp đồng → ô “Công trình / Dự án (Danh mục dự án)” → chọn dự án → Lưu thông tin. Hồ sơ giá đội / thầu phụ của hợp đồng tự theo mã này." />;
      })()}
      <Section title={sp.nosite === "1" ? `Hợp đồng CHƯA GẮN MÃ DỰ ÁN (${shown.length} / ${contracts.length})` : `Hợp đồng (${contracts.length})`}>
        {shown.length === 0 ? (
          <Empty>{sp.nosite === "1" ? "Mọi hợp đồng đều đã gắn mã dự án 👍" : "Chưa có hợp đồng nào."}</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Khu vực</th>
                <th className={th}>Dự án / Gói thầu</th>
                <th className={th}>Số HĐ</th>
                <th className={th}>Nguồn</th>
                <th className={th}>Thời điểm kiểm soát</th>
                <th className={`${th} text-right`}>Dòng nhân công</th>
                <th className={`${th} text-right`}>Giá đã duyệt</th>
                <th className={`${th} text-right`}>Hồ sơ trình</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const v = controlVersion(c);
                const vl = parseVersions(c.versions).find((x) => x.n === v)?.label;
                return (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className={td}>{c.area ? `KV ${c.area}` : <span className="text-amber-700">chưa chọn</span>}</td>
                    <td className={td}>
                      <Link href={`/gia-doi/hop-dong/${c.id}`} className="font-medium text-sky-700 hover:underline">
                        {c.name}
                      </Link>
                      <SiteTag site={c.site} />
                      {c.packageName && <span className="block text-xs text-slate-500">{c.packageName}</span>}
                    </td>
                    <td className={td}>{c.contractNo}{c.appendixNo ? ` — ${c.appendixNo}` : ""}<ContractCode code={cmap.get(contractKey(c.contractNo))} /></td>
                    <td className={`${td} text-xs`}>
                      {c.source === "APP" ? "DT-CP phần mềm" : <>Excel: {c.fileName}</>}
                      <span className="block text-slate-400">cập nhật {fmtDate(c.importedAt)}</span>
                    </td>
                    <td className={`${td} text-xs`}>{vl ?? "Đơn giá duy nhất"}</td>
                    <td className={`${td} text-right`}>{c.lines.length}</td>
                    <td className={`${td} text-right`}>{c._count.approvals}</td>
                    <td className={`${td} text-right`}>{c._count.submissions}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
