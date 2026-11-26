import { prisma } from "@/lib/prisma";
import { getPriceUser } from "@/lib/gia-doi";
import { canManageSites, contractKey, looseGroups, toSiteOpt } from "@/lib/project-site";
import SiteAdmin from "./SiteAdmin";

// DANH MỤC DỰ ÁN: Khu vực → Cụm → Dự án → Hợp đồng (theo BẢNG TT DỰ ÁN); mã dự án + tên chuẩn + tên gọi khác; gắn tên dự án cũ vào mã;
// xác nhận dự án người dùng đề nghị; gộp dự án trùng
export default async function ProjectSitesPage() {
  const u = await getPriceUser();
  if (!canManageSites(u)) return <p className="text-sm text-red-600">Chỉ quản trị hoặc QSTT được quản lý Danh mục dự án.</p>;
  const [rows, cc, ps, sp] = await Promise.all([
    prisma.projectSite.findMany({
      orderBy: [{ area: "asc" }, { cluster: "asc" }, { code: "asc" }, { name: "asc" }],
      include: {
        _count: { select: { projects: true, contracts: true, submissions: true, subProposals: true } },
        siteContracts: { orderBy: { orderIndex: "asc" }, select: { id: true, code: true, contractNo: true, noKey: true, title: true, category: true, company: true } },
      },
    }),
    prisma.costContract.findMany({ select: { contractNo: true } }),
    prisma.priceSubmission.findMany({ select: { contractNo: true } }),
    prisma.subProposal.findMany({ select: { cdtContract: true } }),
  ]);
  // hồ sơ trên phần mềm theo SỐ HĐ (để biết hợp đồng nào trong bảng đã có hợp đồng DT-CP / hồ sơ đội / thầu phụ)
  const use = new Map<string, { contract: number; price: number; sub: number }>();
  const bump = (no: string | null, k: "contract" | "price" | "sub") => {
    const key = contractKey(no);
    if (!key) return;
    const x = use.get(key) ?? { contract: 0, price: 0, sub: 0 };
    x[k]++;
    use.set(key, x);
  };
  cc.forEach((x) => bump(x.contractNo, "contract"));
  ps.forEach((x) => bump(x.contractNo, "price"));
  sp.forEach((x) => bump(x.cdtContract, "sub"));
  const sites = rows.map((r) => ({
    ...toSiteOpt(r),
    createdByName: r.createdByName,
    used: { dtcp: r._count.projects, contract: r._count.contracts, price: r._count.submissions, sub: r._count.subProposals },
    contracts: r.siteContracts.map(({ noKey, ...c }) => ({ ...c, use: (noKey && use.get(noKey)) || { contract: 0, price: 0, sub: 0 } })),
  }));
  const loose = await looseGroups(sites);
  return <SiteAdmin sites={sites} loose={loose} />;
}
