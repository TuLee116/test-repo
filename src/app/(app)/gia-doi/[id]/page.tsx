import Link from "next/link";
import { listCellNotes } from "@/lib/cell-notes";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtDateTime } from "@/lib/proc";
import { canPrice, canReviewCategory, canSeePrice, categoryLabel, getPriceUser, inSubmissionScope, KIND_LABEL, PRICE_STATUS, savedTotals } from "@/lib/gia-doi";

const safeJson = (s: string): Record<string, string> => {
  try {
    const o = JSON.parse(s || "{}");
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
};
import { deleteImportedPriceAction } from "@/lib/gia-doi-import";
import { adminDeletePricesAction } from "@/lib/admin-delete-actions";
import { buildPriceEmlAction, deletePriceAction, recallPriceAction, revisePriceAction } from "@/lib/gia-doi-actions";
import { dtcpRefs, loadLedger } from "@/lib/hop-dong";
import DtcpDrawer, { type DtcpRow } from "./DtcpDrawer";
import ActionButton from "../../mua-vat-tu/ActionButton";
import { Badge, LogList, Section } from "../../mua-vat-tu/ui";
import PriceSheet from "./PriceSheet";
import { loadSites } from "@/lib/project-site";
import MailPanel from "./MailPanel";
import TaskWorkspace from "../../TaskWorkspace";

export default async function PriceSubmissionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ dc?: string }> }) {
  const { id } = await params;
  const { dc } = await searchParams;
  const u = (await getPriceUser())!;
  if (!canSeePrice(u)) redirect("/gia-doi/thau-phu");
  const s = await prisma.priceSubmission.findUnique({ where: { id }, include: { lines: { orderBy: { orderIndex: "asc" } } }, omit: { fileData: true } });
  if (!s) notFound();
  if (u.areas) {
    const c = s.contractId ? await prisma.costContract.findUnique({ where: { id: s.contractId }, select: { area: true } }) : null;
    if (!inSubmissionScope(u, s, c?.area)) redirect("/gia-doi"); // ngoài khu vực được giao (hoặc hồ sơ nháp của người khác)
  }
  const logs = await prisma.procLog.findMany({ where: { entity: "GIA", entityId: id }, orderBy: { createdAt: "asc" } });
  const isQs = canPrice(u, "QSTT");
  const canAdjust = s.status === "APPROVED" && canReviewCategory(u, s.category); // Trưởng phòng điều chỉnh giá sau duyệt (chưa trình lại thì mới được)
  const adjust = canAdjust && dc === "1";
  const mode = s.status === "DRAFT" && isQs ? "qs" : (s.status === "SUBMITTED" || adjust) && canReviewCategory(u, s.category) ? "tp" : "view";
  const reviewed = s.status === "APPROVED" || s.status === "REJECTED";
  const [mailTo, mailCc] = s.mailTo.includes("|") ? s.mailTo.split("|") : [s.mailTo, ""];
  const [contracts, refs, parent, child, sites] = await Promise.all([
    prisma.costContract.findMany({ where: u.areas ? { area: { in: [...u.areas, ""] } } : {}, orderBy: { name: "asc" }, select: { id: true, name: true, siteId: true, packageName: true, contractNo: true, appendixNo: true } }),
    s.contractId ? dtcpRefs(s.contractId, id) : Promise.resolve([]),
    s.parentId ? prisma.priceSubmission.findUnique({ where: { id: s.parentId }, select: { id: true, code: true, revision: true } }) : Promise.resolve(null),
    prisma.priceSubmission.findFirst({ where: { parentId: id }, select: { id: true, code: true, revision: true } }),
    loadSites(), // DANH MỤC DỰ ÁN
  ]);

  // Trưởng phòng đang duyệt: nạp bảng TH Nhân Công của DT-CP gắn với hồ sơ để mở ở nút "Xem DT-CP"
  const ledger = mode === "tp" && s.contractId ? await loadLedger(s.contractId, "NC") : null;
  const dtcpRows: DtcpRow[] | null = ledger ? ledger.rows.map((r) => ({ level: r.level, stt: r.stt, name: r.name, unit: r.unit, qty: r.qty, price: r.price, amount: r.amount })) : null;
  const contractTitle = ledger ? [ledger.contract.name, ledger.contract.packageName, ledger.contract.contractNo && `HĐ ${ledger.contract.contractNo}`, ledger.contract.appendixNo].filter(Boolean).join(" — ") : "";

  // TÁC VỤ của người đang xem → mở cửa sổ làm việc toàn màn hình; xong tác vụ thì về màn hình chính
  const mailTask = reviewed && isQs && !s.mailSentAt && !child;
  const task = mode === "qs" ? "QSTT · Kiểm tra & trình giá đội" : mode === "tp" ? `${categoryLabel(s.category)} · ${adjust ? "Điều chỉnh giá sau duyệt" : "Duyệt giá đội"}` : mailTask ? "QSTT · Gửi mail kết quả duyệt giá đội" : "";
  const history = (
    <Section title="Lịch sử xử lý">
      <LogList logs={logs} />
    </Section>
  );

  const content = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {!task && (
          <Link href="/gia-doi" className="text-sm text-slate-500 hover:underline">
            ← Hồ sơ đề xuất
          </Link>
        )}
        <span className="text-sm text-slate-600">
          <b>{s.code}</b> · {KIND_LABEL[s.kind]} · file <i>{s.fileName}</i> · tải lên {fmtDate(s.createdAt)} bởi {s.createdByName}
        </span>
        <Badge map={PRICE_STATUS} status={s.status} />
        {s.imported && <span className="ml-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700 ring-1 ring-emerald-200">hồ sơ cũ</span>}
        {s.category && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">{categoryLabel(s.category)}</span>}
        <span className="flex-1" />
        {s.status === "SUBMITTED" && isQs && (
          <ActionButton action={recallPriceAction.bind(null, id)} confirm="Rút hồ sơ về để sửa (Trưởng phòng chưa duyệt)?">
            Rút lại
          </ActionButton>
        )}
        {reviewed && isQs && !child && (
          <ActionButton variant="primary" action={revisePriceAction.bind(null, id)} confirm={`Tạo hồ sơ TRÌNH LẠI lần ${s.revision + 1} từ hồ sơ này (đổi đội / đơn giá...)? Hồ sơ hiện tại giữ nguyên làm lịch sử.`} goto="/gia-doi/{id}">
            ↻ Trình lại (lần {s.revision + 1})
          </ActionButton>
        )}
        {canAdjust && !adjust && !child && (
          <Link href={`/gia-doi/${id}?dc=1`} className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700">
            ✎ Điều chỉnh giá sau duyệt
          </Link>
        )}
        {s.status === "DRAFT" && isQs && (
          <ActionButton variant="danger" action={deletePriceAction.bind(null, id)} confirm="Xoá hồ sơ này (chưa trình)?" goto="/gia-doi">
            Xoá
          </ActionButton>
        )}
        {s.imported && isQs && (
          <ActionButton variant="danger" action={deleteImportedPriceAction.bind(null, id)} confirm="Xoá hồ sơ cũ nhập nhầm? Các giá đã ghi vào sổ giá hợp đồng từ hồ sơ này cũng bị gỡ." goto="/gia-doi">
            Xoá (gỡ khỏi sổ giá)
          </ActionButton>
        )}
        {u.isAdmin && !(s.status === "DRAFT" && isQs) && !(s.imported && isQs) && (
          <ActionButton variant="danger" action={adminDeletePricesAction.bind(null, [id])} confirm={`[Quản trị] Xoá hẳn hồ sơ ${s.code} (${s.status === "APPROVED" ? "đã duyệt" : s.status === "SUBMITTED" ? "đang trình" : s.status === "REJECTED" ? "không duyệt" : "chưa trình"})? Giá đã ghi vào sổ giá từ hồ sơ này cũng bị gỡ. Không khôi phục được.`} goto="/gia-doi">
            🗑 Xoá hồ sơ (quản trị)
          </ActionButton>
        )}
        <a href={`/gia-doi/${id}/excel`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
          ⬇ Tải Excel
        </a>
        <a href={`/gia-doi/${id}/pdf`} target="_blank" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
          📄 PDF
        </a>
      </div>

      {(parent || child) && (
        <div className="rounded border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
          {parent && (
            <>
              Đây là hồ sơ <b>trình lại lần {s.revision}</b> của{" "}
              <Link href={`/gia-doi/${parent.id}`} className="font-medium underline">
                {parent.code} (lần {parent.revision})
              </Link>
              .{" "}
            </>
          )}
          {child && (
            <>
              Hồ sơ này đã được trình lại ở{" "}
              <Link href={`/gia-doi/${child.id}`} className="font-medium underline">
                {child.code} (lần {child.revision})
              </Link>{" "}
              — chỉ còn là lịch sử.
            </>
          )}
        </div>
      )}
      {s.status === "SUBMITTED" && mode !== "tp" && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Đã trình <b>{categoryLabel(s.category)}</b> ngày {fmtDate(s.submittedAt)} — đang chờ Trưởng phòng duyệt.
        </div>
      )}
      {s.dtcpLater && !s.contractId && s.status !== "DRAFT" && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          ⏳ Hồ sơ đang <b>chưa có DT-CP</b>
          {s.status === "APPROVED" ? " — đơn giá đã duyệt vẫn phát hành cho công trường, nhưng việc CHƯA HOÀN THÀNH" : ""}. QSTT bổ sung bằng cách chọn hợp đồng ở dòng <b>HỢP ĐỒNG (DT-CP)</b> trong bảng bên dưới
          {s.status === "APPROVED" ? " (giá đã duyệt sẽ ghi vào sổ giá của hợp đồng)" : ""}.
        </div>
      )}
      {reviewed && (
        <div className={`rounded border px-3 py-2 text-sm ${s.status === "APPROVED" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-800"}`}>
          {s.reviewedByName} ({categoryLabel(s.category)}) đã <b>{s.status === "APPROVED" ? "DUYỆT" : "KHÔNG DUYỆT"}</b> lúc {s.reviewedAt ? fmtDateTime(s.reviewedAt) : ""} và trả hồ sơ về QSTT
          {s.tpNote && ` — "${s.tpNote}"`}.
        </div>
      )}

      <PriceSheet
        notes={await listCellNotes("GD", id, u.id, u.isAdmin)}
        key={`${s.status}-${s.updatedAt.getTime()}`}
        id={id}
        kind={s.kind}
        mode={mode}
        adjust={adjust && !child}
        head={{
          siteId: s.siteId ?? "",
          projectName: s.projectName,
          contractNo: s.contractNo,
          projectCode: s.projectCode,
          itemName: s.itemName,
          quoteStatus: s.quoteStatus,
          batch: s.batch,
          batchDate: s.batchDate,
          qsNote: s.qsNote,
          tpNote: s.tpNote,
          category: s.category,
          crewName: s.crewName,
        }}
        sites={sites}
        contracts={contracts.map((c) => ({ id: c.id, siteId: c.siteId, label: [c.name, c.packageName, c.contractNo && `HĐ ${c.contractNo}`, c.appendixNo].filter(Boolean).join(" — ") }))}
        contractId={s.contractId}
        dtcpLater={s.dtcpLater}
        status={s.status}
        canFillLater={isQs && s.dtcpLater && !s.contractId}
        headEdit={mode !== "qs" && (u.isAdmin || (s.status === "SUBMITTED" && canReviewCategory(u, s.category)))}
        total={{ formulas: safeJson(s.totalFormulas), amounts: savedTotals(s.totalAmounts) }}
        refs={refs}
        revision={s.revision}
        dtcpPanel={mode === "tp" && s.contractId && dtcpRows ? <DtcpDrawer rows={dtcpRows} title={contractTitle} fullHref={`/gia-doi/hop-dong/${s.contractId}?tab=NC`} /> : null}
        lines={s.lines.map((l) => ({
          id: l.id, level: l.level, stt: l.stt, content: l.content, unit: l.unit, qty: l.qty, cdtPrice: l.cdtPrice, cdtAmount: l.cdtAmount,
          basePrice: l.basePrice, baseAmount: l.baseAmount, baseNote: l.baseNote, siteOpinion: l.siteOpinion, sitePrice: l.sitePrice, siteAmount: l.siteAmount,
          siteNote: l.siteNote, ptOpinion: l.ptOpinion, ptPrice: l.ptPrice, ptAmount: l.ptAmount, ptNote: l.ptNote, qsNote: l.qsNote, tpPrice: l.tpPrice, apprAmount: l.tpAmount, tpOk: l.tpOk, tpNote: l.tpNote, lineKey: l.lineKey, overReason: l.overReason,
          added: l.sourceRow === 0,
          formulas: (() => {
            try {
              return JSON.parse(l.formulas || "{}") as Record<string, string>;
            } catch {
              return {};
            }
          })(),
        }))}
      />

      {reviewed && isQs && <MailPanel build={buildPriceEmlAction.bind(null, id)} pdfHref={`/gia-doi/${id}/pdf`} initTo={mailTo} initCc={mailCc} sentAt={s.mailSentAt ? fmtDateTime(s.mailSentAt) : ""} />}

      {!task && history}
    </div>
  );

  if (!task) return content;
  return (
    <TaskWorkspace title={task} code={s.code} sub={[s.projectName, s.itemName].filter(Boolean).join(" · ")} exitHref="/gia-doi" history={history}>
      {content}
    </TaskWorkspace>
  );
}
