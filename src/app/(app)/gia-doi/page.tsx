import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { canPrice, canSeePrice, getPriceUser, ownAreaWhere } from "@/lib/gia-doi";
import { Empty, Section } from "../mua-vat-tu/ui";
import MyWork, { loadPriceRows, priceTable, priceValueOf, type PriceRow } from "./MyWork";
import UploadForm from "./UploadForm";
import OldPriceImport from "./OldPriceImport";
import BulkDelete from "./BulkDelete";
import TongHopExport from "./TongHopExport";
import { AREAS } from "@/lib/perms";
import { matchQuery } from "@/lib/search-match";
import { NoSiteFilter } from "../du-an/SiteBits";
import SummaryTable from "./SummaryTable";
import { dtcpTotals } from "@/lib/dtcp-summary";
import { buildSumRows } from "@/lib/summary-rows";
import { canManageSites, loadContractInfo } from "@/lib/project-site";
import SearchBox from "./SearchBox";

// Trang Đệ trình giá đội: VIỆC CỦA TÔI (trên cùng) → QSTT tải file mới → tất cả hồ sơ
export default async function GiaDoiListPage({ searchParams }: { searchParams: Promise<{ q?: string; nosite?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const noSite = sp.nosite === "1"; // lọc: chỉ hồ sơ CHƯA gắn mã dự án
  const u = (await getPriceUser())!;
  if (!canSeePrice(u)) redirect("/gia-doi/thau-phu");
  const subs = await loadPriceRows(u);
  type S = PriceRow;
  const valueOf = priceValueOf;
  // TÌM HỒ SƠ nhiều khoá: mã hồ sơ, số hợp đồng, Trưởng phòng duyệt, người trình (QSTT), dự án / hạng mục / đội
  const found = q ? subs.filter((s) => matchQuery([s.code, s.contractNo, s.contract?.contractNo, s.reviewedByName, s.createdByName, s.projectName, s.contract?.name, s.site?.code, s.itemName, s.crewName, s.fileName], q)) : [];

  // BẢNG TỔNG HỢP: Khu vực → Cụm dự án → Dự án → Hợp đồng (giá trị HĐ, giá trị đội theo DT-CP, đã duyệt, %); bấm dòng hợp đồng → các đợt
  const when = (x: S) => (x.reviewedAt ?? x.submittedAt ?? x.createdAt).getTime();
  // lọc "chưa gắn mã dự án" chỉ áp cho bảng Tất cả hồ sơ
  const noSiteSubs = subs.filter((s) => !s.site);
  const treeSubs = noSite ? noSiteSubs : subs;
  const [dtcp, cinfo] = await Promise.all([dtcpTotals(treeSubs.map((s) => s.contractId ?? "")), loadContractInfo()]);
  const { rows: sumRows, members } = buildSumRows(
    treeSubs.map((s) => ({
      s,
      area: s.contract?.area || s.site?.area || "",
      site: s.site,
      projectName: s.projectName || s.contract?.name || "",
      contract: s.contractId && s.contract ? { id: s.contractId, contractNo: s.contract.contractNo, appendixNo: s.contract.appendixNo, packageName: s.contract.packageName } : null,
      typedNo: s.contractNo || "",
      approved: s.status === "APPROVED",
      waiting: s.status === "DRAFT" || s.status === "SUBMITTED",
      value: s.status === "APPROVED" ? valueOf(s, true) : 0,
      at: when(s),
    })),
    dtcp,
    "nc",
    cinfo,
  );
  const details = Object.fromEntries(
    [...members].map(([k, its], i) => {
      const rows = its.map((x) => x.s).sort((a, b) => when(b) - when(a)); // đợt mới nhất trên cùng
      const form = u.isAdmin ? `del-${i}` : "";
      return [
        k,
        <>
          {u.isAdmin && <BulkDelete formId={form} />}
          {priceTable(rows, { inContract: !!rows[0].contractId, delForm: form })}
        </>,
      ];
    }),
  );

  // lựa chọn lọc cho form xuất Excel: chỉ dự án / hợp đồng có hồ sơ ĐÃ DUYỆT
  const projOf = (s: S) => (s.contract?.name || s.projectName || "(chưa có tên công trình)").trim();
  const approvedSubs = subs.filter((s) => s.status === "APPROVED");
  const exportProjects = [...new Set(approvedSubs.map(projOf))].sort((a, b) => a.localeCompare(b, "vi", { numeric: true }));
  const exportContracts = [...new Map(approvedSubs.filter((s) => s.contractId && s.contract).map((s) => [s.contractId!, { value: s.contractId!, label: `HĐ ${s.contract!.contractNo || "(chưa có số)"}${s.contract!.packageName ? ` — ${s.contract!.packageName}` : ""}`, project: projOf(s) }])).values()].sort((a, b) => a.label.localeCompare(b.label, "vi", { numeric: true }));

  return (
    <div className="space-y-4">
      <SearchBox action="/gia-doi" q={q} count={found.length} hint="Mã hồ sơ, số hợp đồng, tên Trưởng phòng duyệt, QSTT trình… (nhiều từ cách nhau bằng dấu cách)" />
      {q && (
        <Section title={`Kết quả tìm "${q}" — ${found.length} hồ sơ`}>{found.length ? priceTable(found) : <Empty>Không có hồ sơ nào khớp.</Empty>}</Section>
      )}
      <TongHopExport areas={u.areas ?? AREAS} projects={exportProjects} contracts={exportContracts} />
      {canPrice(u, "QSTT") && <UploadForm />}
      {canPrice(u, "QSTT") && (
        <div className="flex flex-wrap items-center gap-3">
          <OldPriceImport contracts={await prisma.costContract.findMany({ where: ownAreaWhere(u), orderBy: { name: "asc" }, select: { id: true, name: true, packageName: true, contractNo: true } })} />
          <span className="text-xs text-slate-500">Gói thầu cũ: nhập các đợt đã duyệt trước đây để sổ giá có lũy kế, sẵn sàng so cho đợt đề xuất tiếp theo.</span>
        </div>
      )}
      {/* VIỆC CỦA TÔI dùng chung giá đội + thầu phụ, chia theo vai trò (MyWork.tsx) */}
      <MyWork pu={u} mode="price" price={subs} />

      <NoSiteFilter href="/gia-doi" on={noSite} total={noSiteSubs.length} approved={noSiteSubs.filter((s) => s.status === "APPROVED").length} manage={canManageSites(u)} />
      <Section title={`Bảng tổng hợp đội thi công — theo khu vực / cụm / dự án / hợp đồng (${sumRows.length} hợp đồng · ${treeSubs.length} hồ sơ${noSite ? " CHƯA GẮN MÃ DỰ ÁN" : ""})`}>
        {!treeSubs.length ? (
          <Empty>{noSite ? "Mọi hồ sơ đều đã gắn mã dự án 👍" : "Chưa có hồ sơ nào."}</Empty>
        ) : (
          <SummaryTable rows={sumRows} details={details} noun="Đội" fileName="Tong-hop-doi-thi-cong" />
        )}
      </Section>
    </div>
  );
}
