import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtDateTime } from "@/lib/proc";
import { asSub, canPrice, canReviewCategory, canSeeSub, categoryLabel, getPriceUser, inPriceAreas } from "@/lib/gia-doi";
import { adminDeleteSubAction } from "@/lib/admin-delete-actions";
import { listCellNotes } from "@/lib/cell-notes";
import { buildSubEmlAction, returnSubToQsdtAction, deleteSubAction, ntNextPartAction, ptgReconsiderSubAction, ptgViewSubAction, qsdtEditSubAction, recallSubAction, reviseSubAction } from "@/lib/thau-phu-actions";
import { BRANCH_LABEL, parseExtras, parseVatRows, parseJson, SUB_STATUS, type Bid, type Bidder, type Term } from "@/lib/thau-phu-calc";
import { hdtpOptions, ntContext, subChain, subRefs } from "@/lib/thau-phu";
import ActionButton from "../../../mua-vat-tu/ActionButton";
import { Badge, LogList, Section } from "../../../mua-vat-tu/ui";
import MailPanel from "../../[id]/MailPanel";
import SubSheet from "./SubSheet";
import TaskWorkspace from "../../../TaskWorkspace";
import HdForm from "./HdForm";
import { AREAS } from "@/lib/perms";
import { loadSites } from "@/lib/project-site";
import { loadLedger } from "@/lib/hop-dong";
import DtcpDrawer, { type DtcpRow } from "../../[id]/DtcpDrawer";

export default async function SubProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ dc?: string }> }) {
  const { id } = await params;
  const { dc } = await searchParams;
  const u = asSub((await getPriceUser())!);
  if (!canSeeSub(u)) redirect("/gia-doi");
  const p = await prisma.subProposal.findUnique({ where: { id }, include: { lines: { orderBy: { orderIndex: "asc" } } }, omit: { fileData: true } });
  if (!p) notFound();
  if (u.areas) {
    const c = p.contractId ? await prisma.costContract.findUnique({ where: { id: p.contractId }, select: { area: true } }) : null;
    if (!inPriceAreas(u, c?.area || p.area)) redirect("/gia-doi/thau-phu");
  }
  // QSĐT người trình mở xem kết quả duyệt / không duyệt → tắt thông báo trên chuông
  if ((p.status === "APPROVED" || p.status === "REJECTED") && p.createdById === u.id && !p.makerSeenAt) {
    await prisma.subProposal.update({ where: { id }, data: { makerSeenAt: new Date() } });
  }
  // QSTT mở hồ sơ mà QSĐT đã bổ sung theo yêu cầu TP → đã nắm thông tin, tắt thông báo
  if (p.infoNotice && canPrice(u, "QSTT")) {
    await prisma.subProposal.update({ where: { id }, data: { infoNotice: false } });
  }
  // phụ lục: HĐ thầu phụ gốc + các phụ lục trước (lũy kế PLĐC) và danh sách HĐ thầu phụ để chọn
  const [chain, hdtpOpts] = await Promise.all([subChain(p), hdtpOptions(p)]);
  // NỘI THẤT: ảnh từng dòng + giá các phần việc đã duyệt ở hồ sơ nội thất khác của cùng hợp đồng / dự án
  const [ntImgs, ntCtx] = p.isNt ? await Promise.all([prisma.subLineImage.findMany({ where: { proposalId: id }, orderBy: { orderIndex: "asc" }, select: { id: true, lineId: true } }), ntContext(p)]) : [[], { refAppr: {}, extra: {} }];
  const ntImages: Record<string, string[]> = {};
  for (const im of ntImgs) (ntImages[im.lineId] ??= []).push(im.id);
  const [logs, contracts, refs, parent, child, sites] = await Promise.all([
    prisma.procLog.findMany({ where: { entity: "TPH", entityId: id }, orderBy: { createdAt: "asc" } }),
    prisma.costContract.findMany({ where: u.areas ? { area: { in: [...u.areas, ""] } } : {}, orderBy: { name: "asc" }, select: { id: true, name: true, siteId: true, packageName: true, contractNo: true, appendixNo: true, area: true } }),
    p.contractId ? subRefs(p.contractId, id) : Promise.resolve([]),
    p.parentId ? prisma.subProposal.findUnique({ where: { id: p.parentId }, select: { id: true, code: true, revision: true } }) : Promise.resolve(null),
    prisma.subProposal.findFirst({ where: { parentId: id }, select: { id: true, code: true, revision: true } }),
    // DANH MỤC DỰ ÁN (chọn dự án theo mã, không gõ tự do)
    loadSites(),
  ]);
  // bảng TH Thầu Phụ của DT-CP gắn với hồ sơ — nút "Xem DT-CP" mở ngăn bên phải để dò, đối chiếu (như trình giá đội)
  const ledger = p.contractId ? await loadLedger(p.contractId, "TP") : null;
  const b1Of = new Map(refs.map((r) => [r.key, r.base1]));
  const dtcpRows: DtcpRow[] | null = ledger ? ledger.rows.map((r) => ({ level: r.level, stt: r.stt, name: r.name, unit: r.unit, qty: r.qty, price: r.price, amount: r.amount, base1: r.level === "ITEM" ? (b1Of.get(r.key) ?? null) : null })) : null;
  const contractTitle = ledger ? [ledger.contract.name, ledger.contract.packageName, ledger.contract.contractNo && `HĐ ${ledger.contract.contractNo}`, ledger.contract.appendixNo].filter(Boolean).join(" — ") : "";
  const isQs = canPrice(u, "QSTT"); // ② QSTT kiểm tra, trình, lên HĐ, mail
  const isMaker = canPrice(u, "QSTT", "QSDT"); // ① QSĐT lập hồ sơ (QSTT cũng sửa được trước khi trình)
  const isPtg = canPrice(u, "PTG");
  // ĐIỀU CHỈNH GIÁ SAU DUYỆT: nhánh A → Trưởng phòng; nhánh B → Phó Tổng; chưa lên HĐ/PLHĐ, chưa trình lại
  const adjRole = p.status === "APPROVED" && !p.hdNo.trim() && !child ? (p.branch === "B" ? (isPtg ? "ptg" : "") : canReviewCategory(u, p.category) ? "tp" : "") : "";
  const adjust = !!adjRole && dc === "1";
  const mode = (p.status === "DRAFT" && isMaker) || (p.status === "NEED_INFO" && isMaker) || (p.status === "QS_CHECK" && isQs) ? "qs" : p.status === "SUBMITTED" && canReviewCategory(u, p.category) ? "tp" : p.status === "PTG_PENDING" && isPtg ? "ptg" : adjust ? (adjRole as "tp" | "ptg") : "view";
  const effective = p.status === "APPROVED" && isPast(p.effectiveAt);
  const [mailTo, mailCc] = p.mailTo.includes("|") ? p.mailTo.split("|") : [p.mailTo, ""];
  const bidders = parseJson<Bidder[]>(p.bidders, []);
  const dt = (d: Date | null) => (d ? fmtDateTime(d) : "");
  // TÁC VỤ của người đang xem → cửa sổ làm việc toàn màn hình; xong tác vụ thì về màn hình chính
  const mailTask = (p.status === "APPROVED" || p.status === "REJECTED") && isQs && !p.mailSentAt && !child;
  const task =
    mode === "qs"
      ? p.status === "DRAFT"
        ? "QSĐT · Lập hồ sơ trình giá thầu phụ"
        : p.status === "NEED_INFO"
          ? "QSĐT · Bổ sung hồ sơ theo yêu cầu Trưởng phòng"
          : "QSTT · Kiểm tra & trình giá thầu phụ"
      : mode === "tp"
        ? `${categoryLabel(p.category)} · ${adjust ? "Điều chỉnh giá thầu phụ sau duyệt" : "Duyệt giá thầu phụ"}`
        : mode === "ptg"
          ? `Phó Tổng · ${adjust ? "Điều chỉnh giá thầu phụ sau duyệt" : "Phê duyệt giá thầu phụ"}`
          : mailTask
            ? "QSTT · Gửi mail kết quả giá thầu phụ"
            : "";
  const history = (
    <Section title="Lịch sử xử lý">
      <LogList logs={logs} />
    </Section>
  );

  const content = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {!task && (
          <Link href="/gia-doi/thau-phu" className="text-sm text-slate-500 hover:underline">
            ← Trình giá thầu phụ
          </Link>
        )}
        <span className="text-sm text-slate-600">
          <b>{p.code}</b> · file <i>{p.fileName}</i> · tải lên {fmtDate(p.createdAt)} bởi {p.createdByName}
        </span>
        <Badge map={SUB_STATUS} status={p.status} />
        {p.category && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">{categoryLabel(p.category)}</span>}
        {p.branch && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.branch === "A" ? "bg-emerald-100 text-emerald-800" : "bg-orange-100 text-orange-800"}`}>Nhánh {p.branch}</span>}
        <span className="flex-1" />
        {p.status === "SUBMITTED" && isQs && (
          <ActionButton action={recallSubAction.bind(null, id)} confirm="Rút hồ sơ về để sửa?">
            Rút lại
          </ActionButton>
        )}
        {/* SỬA ĐỀ XUẤT: QSĐT lập hồ sơ, đã trình mà chưa duyệt → rút về bước QSĐT đang lập để sửa (QSTT đang kiểm tra thì QSTT tự sửa được, không cần nút) */}
        {(["SUBMITTED", "PTG_PENDING"].includes(p.status) || (p.status === "QS_CHECK" && !isQs)) && canPrice(u, "QSDT") && (!p.createdById || p.createdById === u.id) && (
          <ActionButton
            variant="primary"
            action={qsdtEditSubAction.bind(null, id)}
            confirm={`Rút hồ sơ về để SỬA ĐỀ XUẤT?\nHồ sơ ${p.status === "QS_CHECK" ? "đang chờ QSTT kiểm tra" : p.status === "SUBMITTED" ? "đang chờ Trưởng phòng duyệt" : "đang chờ Phó Tổng phê duyệt"} sẽ quay về bước QSĐT đang lập. Sửa xong bấm chuyển QSTT kiểm tra lại; QSTT trình lại thì Trưởng phòng / Phó Tổng duyệt lại từ đầu.`}
          >
            ✎ Sửa đề xuất
          </ActionButton>
        )}
        {p.status === "REJECTED" && isMaker && !child && (
          <ActionButton variant="primary" action={reviseSubAction.bind(null, id)} confirm="Tạo hồ sơ TRÌNH LẠI (bổ sung, sửa)? QSĐT chọn lại lần trình / nhánh trên hồ sơ mới." goto="/gia-doi/thau-phu/{id}">
            ↻ Trình lại
          </ActionButton>
        )}
        {/* NỘI THẤT: trình phần việc khác của cùng các sản phẩm (VD đã trình khung bàn → trình mặt đá) */}
        {p.isNt && isMaker && p.lines.some((l) => l.level === "SP") && (
          <ActionButton
            action={ntNextPartAction.bind(null, id)}
            confirm={"Tạo hồ sơ MỚI để trình PHẦN VIỆC KHÁC của cùng các sản phẩm?\nHồ sơ mới chép danh sách sản phẩm, phần việc, ảnh; phần việc đang trình ở hồ sơ này thành dòng tham khảo (hồ sơ này duyệt xong thì tự lấy giá duyệt).\nỞ hồ sơ mới: chọn các dòng phần việc trình lần này (menu ▾ ở ô STT → \"Phần việc trình lần này\"), nhập thầu phụ và giá."}
            goto="/gia-doi/thau-phu/{id}"
          >
            ＋ Trình phần việc khác
          </ActionButton>
        )}
        {p.status === "APPROVED" && p.branch === "A" && !p.ptgAt && isPtg && (
          <>
            <ActionButton variant="primary" action={ptgViewSubAction.bind(null, id)} confirm="Xác nhận đã xem — giá có hiệu lực ngay?">
              👁 Đã xem (Phó Tổng)
            </ActionButton>
            {!p.hdNo && (
              <ActionButton action={ptgReconsiderSubAction.bind(null, id)} prompt="Lý do xem lại (chuyển sang Phó Tổng phê duyệt):">
                Xem lại → chuyển nhánh B
              </ActionButton>
            )}
          </>
        )}
        {adjRole && !adjust && (
          <Link href={`/gia-doi/thau-phu/${id}?dc=1`} className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700">
            ✎ Điều chỉnh giá sau duyệt
          </Link>
        )}
        {u.isAdmin && !(p.status === "DRAFT" && isMaker) && (
          <ActionButton variant="danger" action={adminDeleteSubAction.bind(null, id)} confirm={`[Quản trị] Xoá hẳn hồ sơ ${p.code}? Giá thầu phụ đã ghi vào sổ giá từ hồ sơ này cũng bị gỡ. Không khôi phục được.`} goto="/gia-doi/thau-phu">
            🗑 Xoá hồ sơ (quản trị)
          </ActionButton>
        )}
        {p.status === "DRAFT" && isMaker && (
          <ActionButton variant="danger" action={deleteSubAction.bind(null, id)} confirm="Xoá hồ sơ này (chưa trình)?" goto="/gia-doi/thau-phu">
            Xoá
          </ActionButton>
        )}
        <a href={`/gia-doi/thau-phu/${id}/excel`} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
          ⬇ Tải Excel
        </a>
      </div>

      {p.infoRequest && (
        <div className={`rounded border px-3 py-2 text-sm ${p.status === "NEED_INFO" ? "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-900" : "border-slate-200 bg-slate-50 text-slate-800"}`}>
          <p>
            <b>Trưởng phòng yêu cầu QSĐT bổ sung:</b> <span className="whitespace-pre-line">{p.infoRequest}</span>
          </p>
          {p.infoReply && (
            <p className="mt-1">
              <b>QSĐT đã bổ sung:</b> <span className="whitespace-pre-line">{p.infoReply}</span>
            </p>
          )}
          {p.status !== "NEED_INFO" && !p.infoReply && <p className="mt-1 text-xs text-slate-500">QSĐT đã cập nhật hồ sơ theo yêu cầu (không ghi chú thêm).</p>}
        </div>
      )}

      {(parent || child) && (
        <div className="rounded border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
          {parent && (
            <>
              Hồ sơ <b>trình lại lần {p.revision}</b> của{" "}
              <Link href={`/gia-doi/thau-phu/${parent.id}`} className="font-medium underline">
                {parent.code}
              </Link>
              .{" "}
            </>
          )}
          {child && (
            <>
              Đã trình lại ở{" "}
              <Link href={`/gia-doi/thau-phu/${child.id}`} className="font-medium underline">
                {child.code} (lần {child.revision})
              </Link>{" "}
              — hồ sơ này chỉ còn là lịch sử.
            </>
          )}
        </div>
      )}

      {/* tiến trình duyệt */}
      {p.status !== "DRAFT" && p.status !== "QS_CHECK" && p.status !== "NEED_INFO" && (
        <div className="grid gap-2 text-sm sm:grid-cols-4">
          <Step title="② QSTT trình" ok={!!p.submittedAt} who={p.createdByName} at={dt(p.submittedAt)} />
          <Step title={`③ Trưởng phòng (${categoryLabel(p.category)})`} ok={!!p.tpAt && p.status !== "SUBMITTED"} who={p.tpByName} at={dt(p.tpAt)} wait={p.status === "SUBMITTED"} bad={p.status === "REJECTED" && !p.ptgAt} note={p.tpNote} />
          <Step
            title={p.branch === "A" ? "④ Phó Tổng xem để nắm" : "④ Phó Tổng phê duyệt"}
            ok={!!p.ptgAt && p.status !== "REJECTED"}
            who={p.ptgByName}
            at={dt(p.ptgAt)}
            wait={p.status === "PTG_PENDING" || (p.status === "APPROVED" && p.branch === "A" && !p.ptgAt)}
            bad={p.status === "REJECTED" && !!p.ptgAt}
            note={p.ptgNote}
          />
          <Step title="Hiệu lực giá" ok={!!effective} at={p.effectiveAt ? `${effective ? "từ" : "sẽ hiệu lực"} ${dt(p.effectiveAt)}` : ""} wait={p.status === "APPROVED" && !effective} />
        </div>
      )}
      {p.branch && <p className="text-xs text-slate-500">{BRANCH_LABEL[p.branch]} — {p.branchReason}</p>}

      <SubSheet
        dtcpPanel={p.contractId && dtcpRows ? <DtcpDrawer rows={dtcpRows} title={contractTitle} fullHref={`/gia-doi/hop-dong/${p.contractId}?tab=TP`} heading="Bảng tổng hợp thầu phụ của DT-CP" sheet="TH Thầu Phụ" /> : null}
        notes={await listCellNotes("TPH", id, u.id, u.isAdmin)}
        key={`${p.status}-${p.updatedAt.getTime()}`}
        id={id}
        mode={mode}
        adjust={adjust}
        head={{
          area: p.area,
          revision: p.revision,
          branch: p.branch,
          proposalType: p.proposalType,
          plKind: p.plKind,
          priceMode: p.priceMode || "TONG",
          isMep: p.isMep,
          isNt: p.isNt,
          awards: parseJson<{ award?: { key: string; pct: number }[] }>(p.colMap, {}).award ?? [], // LỰA CHỌN PHÊ DUYỆT: % khối lượng giao từng thầu phụ
          mepTemp: p.mepTemp,
          oneQty: p.oneQty,
          awardForm: p.awardForm,
          vtValue: p.vtValue,
          otherValue: p.otherValue,
          signedValue: p.signedValue,
          tbValue: p.tbValue,
          hdtpId: p.hdtpId ?? "",
          hdtpNo: p.hdtpNo,
          siteId: p.siteId ?? "",
          projectName: p.projectName,
          projectCode: p.projectCode,
          cdtContract: p.cdtContract,
          itemName: p.itemName,
          selectedBidder: p.selectedBidder,
          subName: p.subName,
          qsNote: p.qsNote,
          prelim: parseJson<Record<string, number>>(p.prelim, {}),
          vat: parseJson<Record<string, number>>(p.vat, {}),
          terms: parseJson<Term[]>(p.terms, []),
          extras: parseExtras(p.extraRows),
          vatRows: parseVatRows(p.vatRows),
          totalFormulas: parseJson<Record<string, string>>(p.totalFormulas, {}), // công thức ở các dòng từ TỔNG CỘNG trở xuống
        }}
        lines={p.lines.map((l) => ({
          id: l.id, level: l.level, stt: l.stt, workName: l.workName, content: l.content, code: l.code, origin: l.origin, noMgmt: l.noMgmt, unit: l.unit, dims: l.dims, material: l.material, dimL: l.dimL, dimW: l.dimW, dimH: l.dimH,
          cdtQty: l.cdtQty, cdtPrice: l.cdtPrice, baseQty: l.baseQty, basePrice: l.basePrice, bids: parseJson<Record<string, Bid>>(l.bids, {}),
          propQty: l.propQty, propPrice: l.propPrice, note: l.note, lineKey: l.lineKey, qsNote: l.qsNote, tpPrice: l.tpPrice, tpOk: l.tpOk, tpNote: l.tpNote,
          added: l.sourceRow === 0, baseManual: l.baseManual, baseNote: l.baseNote, hdQty: l.hdQty, hdPrice: l.hdPrice, cdtVt: l.cdtVt, cdtNc: l.cdtNc, cdtKh: l.cdtKh, baseVt: l.baseVt, baseNc: l.baseNc, baseTb: l.baseTb, propVt: l.propVt, propNc: l.propNc, propTb: l.propTb, cdtHdQty: l.cdtHdQty, cdtHdPrice: l.cdtHdPrice, baseHdQty: l.baseHdQty, baseHdPrice: l.baseHdPrice,
          formulas: parseJson<Record<string, string>>(l.formulas, {}),
        }))}
        bidders={bidders}
        ntImages={ntImages}
        nt={ntCtx}
        contracts={contracts.map((c) => ({ id: c.id, name: c.name, siteId: c.siteId, area: c.area, contractNo: c.contractNo, label: [c.contractNo ? `HĐ ${c.contractNo}` : "HĐ (chưa có số)", c.appendixNo, c.packageName, c.name].filter(Boolean).join(" — ") }))}
        sites={sites}
        areas={u.areas ?? AREAS}
        contractId={p.contractId}
        refs={refs}
        revision={p.revision}
        category={p.category}
        branch={p.branch}
        branchReason={p.branchReason}
        canSubmit={isQs}
        returnSlot={
          p.status === "QS_CHECK" && isQs ? (
            <ActionButton action={returnSubToQsdtAction.bind(null, id)} prompt="Lý do trả lại QSĐT bổ sung:">
              ↩ Trả lại QSĐT
            </ActionButton>
          ) : null
        }
        canHandOff={p.status === "DRAFT"}
        headEdit={mode !== "qs" && (u.isAdmin || (p.status === "SUBMITTED" && canReviewCategory(u, p.category)))}
        needInfo={p.status === "NEED_INFO" ? p.infoRequest : ""}
        chain={chain}
        hdtpOptions={hdtpOpts}
        scope={parseJson<string[][]>(p.scope, [])}
        reviewNote={mode === "ptg" ? p.ptgNote : p.tpNote}
      />

      {p.status === "APPROVED" && isQs && <HdForm id={id} hdNo={p.hdNo} hdAt={p.hdAt ? p.hdAt.toISOString().slice(0, 10) : ""} />}
      {p.status === "APPROVED" && isQs && !p.hdNo.trim() && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          ⚠ Hồ sơ đã duyệt — nhập <b>SỐ HĐ / PLHĐ</b> thầu phụ ở khung &quot;Lên HĐ / PLHĐ gửi thầu phụ&quot; trước khi soạn mail gửi thầu phụ. Số HĐ này cũng để QSĐT chọn khi trình phụ lục sau này.
        </div>
      )}
      {(p.status === "APPROVED" || p.status === "REJECTED") && isQs && (
        <MailPanel build={buildSubEmlAction.bind(null, id)} attachLabel="file Excel kết quả duyệt" initTo={mailTo} initCc={mailCc} sentAt={p.mailSentAt ? fmtDateTime(p.mailSentAt) : ""} />
      )}

      {!task && history}
    </div>
  );

  if (!task) return content;
  return (
    <TaskWorkspace title={task} code={p.code} sub={[p.projectName, p.itemName].filter(Boolean).join(" · ")} exitHref="/gia-doi/thau-phu" history={history}>
      {content}
    </TaskWorkspace>
  );
}

// đã tới giờ hiệu lực chưa (ngoài component: Date.now không gọi trong lúc render)
function isPast(d: Date | null) {
  return !!d && d.getTime() <= Date.now();
}

function Step({ title, ok, who, at, wait, bad, note }: { title: string; ok: boolean; who?: string; at?: string; wait?: boolean; bad?: boolean; note?: string }) {
  return (
    <div className={`rounded border px-3 py-2 ${bad ? "border-red-200 bg-red-50" : ok ? "border-emerald-200 bg-emerald-50" : wait ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <p className="font-medium text-slate-800">{title}</p>
      <p className={`text-xs ${bad ? "text-red-700" : ok ? "text-emerald-700" : wait ? "text-amber-700" : "text-slate-400"}`}>{bad ? "✕ Không duyệt — trả về" : ok ? "✓ Xong" : wait ? "⏳ Đang chờ" : "—"}</p>
      {(who || at) && (
        <p className="text-xs text-slate-600">
          {who} {at}
        </p>
      )}
      {note && <p className="text-xs italic text-slate-500">“{note}”</p>}
    </div>
  );
}
