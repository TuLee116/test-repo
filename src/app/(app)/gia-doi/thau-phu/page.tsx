import { asSub, canExportSub, canPrice, canSeeSub, getPriceUser } from "@/lib/gia-doi";
import { AREAS } from "@/lib/perms";
import { redirect } from "next/navigation";
import { Empty, Section } from "../../mua-vat-tu/ui";
import MyWork, { loadSubRows, subTable, subValueOf, type SubRow } from "../MyWork";
import SubImportWizard from "./SubImportWizard";
import ThauPhuExport from "./ThauPhuExport";
import { matchQuery } from "@/lib/search-match";
import SearchBox from "../SearchBox";
import { NoSiteFilter } from "../../du-an/SiteBits";
import SummaryTable from "../SummaryTable";
import { dtcpTotals } from "@/lib/dtcp-summary";
import { buildSumRows } from "@/lib/summary-rows";
import { canManageSites, loadContractInfo } from "@/lib/project-site";

// TRÌNH GIÁ THẦU PHỤ: Việc của tôi (trên cùng) → QSTT tải file đề xuất ký HĐ thầu phụ → tất cả hồ sơ
export default async function SubListPage({ searchParams }: { searchParams: Promise<{ q?: string; nosite?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const noSite = sp.nosite === "1"; // lọc: chỉ hồ sơ CHƯA gắn mã dự án
  const pu = (await getPriceUser())!;
  const u = asSub(pu);
  if (!canSeeSub(u)) redirect("/gia-doi");
  const ps = await loadSubRows(u);
  type P = SubRow;
  // TÌM HỒ SƠ nhiều khoá: mã hồ sơ, số hợp đồng (CĐT / HĐ thầu phụ), Trưởng phòng / Phó Tổng duyệt, QSĐT/QSTT trình, dự án, thầu phụ
  const found = q ? ps.filter((p) => matchQuery([p.code, p.cdtContract, p.contract?.contractNo, p.hdNo, p.tpByName, p.ptgByName, p.createdByName, p.projectName, p.contract?.name, p.site?.code, p.itemName, p.subName, p.fileName], q)) : [];

  // BẢNG TỔNG HỢP: Khu vực → Cụm dự án → Dự án → Hợp đồng (giá trị HĐ, thầu phụ theo DT-CP, đã duyệt, %); bấm dòng hợp đồng → các hồ sơ
  // lọc "chưa gắn mã dự án" chỉ áp cho bảng Tất cả hồ sơ
  const noSitePs = ps.filter((p) => !p.site);
  const treePs = noSite ? noSitePs : ps;
  const [dtcp, cinfo] = await Promise.all([dtcpTotals(treePs.map((p) => p.contract?.id ?? "")), loadContractInfo()]);
  const { rows: sumRows, members } = buildSumRows(
    treePs.map((p) => ({
      p,
      area: p.area || p.contract?.area || p.site?.area || "",
      site: p.site,
      projectName: p.projectName || p.contract?.name || "",
      contract: p.contract,
      typedNo: p.cdtContract || "",
      approved: p.status === "APPROVED",
      waiting: p.status !== "APPROVED" && p.status !== "REJECTED",
      value: p.status === "APPROVED" ? subValueOf(p) : 0, // sau VAT — cùng gốc với DT-CP
      at: p.createdAt.getTime(),
    })),
    dtcp,
    "tp",
    cinfo,
  );
  const details = Object.fromEntries([...members].map(([k, its]) => [k, subTable(its.map((x) => x.p))]));

  // lựa chọn lọc cho form xuất Excel: chỉ dự án / hợp đồng có hồ sơ ĐÃ DUYỆT
  const projOf = (p: P) => ((p.contract?.name || p.projectName || "").trim() || "(chưa có tên dự án)");
  const approvedPs = ps.filter((p) => p.status === "APPROVED");
  const exportProjects = [...new Set(approvedPs.map(projOf))].sort((a, b) => a.localeCompare(b, "vi", { numeric: true }));
  const ctMap = new Map<string, { value: string; label: string; project: string }>();
  for (const p of approvedPs) {
    const typed = (p.cdtContract || "").trim();
    if (p.contract) ctMap.set(`c:${p.contract.id}`, { value: `c:${p.contract.id}`, label: `HĐ ${p.contract.contractNo || "(chưa có số)"}`, project: projOf(p) });
    else if (typed) ctMap.set(`t:${typed}`, { value: `t:${typed}`, label: `HĐ ${typed} (chưa có DT-CP)`, project: projOf(p) });
  }
  const exportContracts = [...ctMap.values()].sort((a, b) => a.label.localeCompare(b.label, "vi", { numeric: true }));

  return (
    <div className="space-y-4">
      <SearchBox action="/gia-doi/thau-phu" q={q} count={found.length} hint="Mã hồ sơ, số hợp đồng, tên Trưởng phòng duyệt, QSĐT/QSTT trình… (nhiều từ cách nhau bằng dấu cách)" />
      {q && <Section title={`Kết quả tìm "${q}" — ${found.length} hồ sơ`}>{found.length ? subTable(found) : <Empty>Không có hồ sơ nào khớp.</Empty>}</Section>}
      {canExportSub(u) && <ThauPhuExport areas={u.areas ?? AREAS} projects={exportProjects} contracts={exportContracts} />}
      {canPrice(u, "QSTT", "QSDT") && (
        <SubImportWizard
          title="Tải file BẢNG ĐỀ XUẤT KÝ HỢP ĐỒNG THẦU PHỤ"
          hint="Chọn file Excel → chọn sheet (nhiều sheet được, mỗi sheet 1 hồ sơ) → chọn cột: nội dung công việc, giá chủ đầu tư, giá cơ sở, giá từng thầu phụ, giá đề xuất duyệt."
        />
      )}
      {/* VIỆC CỦA TÔI dùng chung giá đội + thầu phụ, chia theo vai trò (../MyWork.tsx) */}
      <MyWork pu={pu} mode="sub" sub={ps} />
      <NoSiteFilter href="/gia-doi/thau-phu" on={noSite} total={noSitePs.length} approved={noSitePs.filter((p) => p.status === "APPROVED").length} manage={canManageSites(pu)} />
      <Section title={`Bảng tổng hợp thầu phụ — theo khu vực / cụm / dự án / hợp đồng (${noSite ? `${treePs.length} hồ sơ CHƯA GẮN MÃ DỰ ÁN` : `${ps.length} hồ sơ`})`}>
        {!treePs.length ? (
          <Empty>{noSite ? "Mọi hồ sơ đều đã gắn mã dự án 👍" : "Chưa có hồ sơ nào."}</Empty>
        ) : (
          <SummaryTable rows={sumRows} details={details} noun="Thầu phụ" fileName="Tong-hop-thau-phu" />
        )}
      </Section>
    </div>
  );
}
