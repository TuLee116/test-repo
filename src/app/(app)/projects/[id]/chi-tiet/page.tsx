import { Fragment } from "react";
import { fmtNorm } from "@/lib/fmt-norm";
import { fmtQty } from "@/lib/fmt-qty";
import AddResourceLine from "../AddResourceLine";
import { unitMismatch } from "@/lib/unit-convert";
import SubPortionEditor from "../SubPortionEditor";
import HeadingSubDialog from "../HeadingSubDialog";
import { parseCoveredLines, scopeLabel, type LineExtra } from "@/lib/sub-portions";
import Link from "next/link";
import ResourceSwapCell from "../ResourceSwapCell";
import LineUserActions from "../LineUserActions";
import LineCategorySelect from "../LineCategorySelect";
import MgmtPctInput from "../MgmtPctInput";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { canDtcp } from "@/lib/access";
import { getAllResources, getCatalogForPicker, getProjectWithBoq } from "@/lib/project-data";
import { getGridSources } from "@/lib/sheet-links";
import {
  addWorkItemResourceLineAction,
} from "@/lib/actions";
import WorkItemAssignCell from "../WorkItemAssignCell";
import MethodSelect from "../MethodSelect";
import ExtraRateInput from "../ExtraRateInput";
import ScrollTable from "../ScrollTable";
import ScrollToHash from "../ScrollToHash";
import NewNormModal from "../NewNormModal";
import { ColResizer, ColWidthsInit, ResetColsButton } from "../ColResize";
import MethodBulkSelect from "../MethodBulkSelect";
import { computeBoqTree, headingClass, summaryKind } from "@/lib/boq-tree";
import { prisma } from "@/lib/prisma";
import { createEvaluator, formatCellValue } from "@/lib/grid-formula";
import { boqDirectUnitPrice, subUnitPriceByBoq } from "@/lib/cost";
import BulkDeleteBar from "../BulkDeleteBar";
import { LineQtyInput, LineTotalQtyInput } from "../LineNumInputs";
import { createMatcher } from "@/lib/boq-match";

function formatMoney(n: number) {
  return n ? Math.round(n).toLocaleString("vi-VN") : "";
}
const formatQty = fmtQty;
const pctText = (r: number) => `${(r * 100).toFixed(2).replace(".", ",")}%`;

const CAT_ORDER: Record<string, number> = { VT: 0, NC: 1, TB: 2 };
const TOTAL_COLS = 23;

const th = "border border-slate-400 px-1.5 font-semibold whitespace-nowrap";
const td = "border border-slate-200 px-1.5 py-0.5 whitespace-nowrap";
const tdWrap = "border border-slate-200 px-1.5 py-0.5";

export default async function ProjectChiTietPage({ params }: PageProps<"/projects/[id]/chi-tiet">) {
  const { id } = await params;
  const session = await auth();
  const isAdmin = await canDtcp("NORM_REVIEW");
  const canNorm = await canDtcp("NORM", "EDIT"); // QSĐT (lập DT-CP) / người có quyền sửa định mức
  const canLines = isAdmin || canNorm; // sửa định mức, xoá, đổi mục chi phí, thêm dòng hao phí — chỉ riêng DUYỆT định mức là của người duyệt

  const project = await getProjectWithBoq(id);
  if (!project) notFound();
  // dòng hao phí người dùng (không phải admin) tự thêm còn chờ duyệt → họ xoá được; dòng đang có đề nghị xoá
  const pendingChanges = await prisma.catalogChange.findMany({ where: { reviewed: false, kind: { in: ["LINES", "REMOVE", "NORM"] } }, select: { kind: true, userId: true, lineIds: true, workItemId: true } });
  // định mức do chính người dùng tạo (chưa duyệt): mọi dòng hao phí trong đó đều là của họ → xoá / sửa ngay, không cần đề nghị
  const ownNormIds = new Set(pendingChanges.filter((c) => c.kind === "NORM" && c.userId === session?.user.id).map((c) => c.workItemId));
  const ownPendingLines = new Set(pendingChanges.filter((c) => c.kind === "LINES" && c.userId === session?.user.id).flatMap((c) => c.lineIds.split(",").filter(Boolean)));
  const isOwnLine = (l: { id: string; workItemId: string }) => ownPendingLines.has(l.id) || ownNormIds.has(l.workItemId);
  const removalPendingLines = new Set(pendingChanges.filter((c) => c.kind === "REMOVE").flatMap((c) => c.lineIds.split(",").filter(Boolean)));
  // số dòng BOQ (mọi dự án) đang dùng từng định mức - báo trước khi đổi mục chi phí của 1 dòng hao phí dùng chung
  const workItemIds = [...new Set(project.boqItems.map((b) => b.workItemId).filter((x): x is string => !!x))];
  const usage = await prisma.boqItem.groupBy({ by: ["workItemId"], where: { workItemId: { in: workItemIds } }, _count: { _all: true } });
  const usageByWorkItem = new Map(usage.map((u) => [u.workItemId as string, u._count._all]));
  // tỷ lệ chi phí quản lý VT / TB TMN cấp theo nhà thầu (khai báo ở hộp giao thầu phụ hoặc sheet TH Thầu Phụ)
  const mgmtRates = new Map((await prisma.subcontractorNameToggle.findMany({ where: { projectId: id } })).map((t) => [t.name.trim(), { vt: t.mgmtVtPct, tb: t.mgmtTbPct }]));

  const resources = await getAllResources();
  // Rà soát định mức không còn hợp nội dung (xem giải thích ở BoqSheetView.tsx) - cùng 1 cơ chế, hiện
  // cả ở đây vì CHI TIẾT là nơi chính để xem/sửa mã định mức.
  const matcher = createMatcher(
    await getCatalogForPicker(),
    await prisma.workItemAlias.findMany()
  );
  const reviewRow = (b: { rawDescription: string; rawUnit: string; isHeading: boolean; workItemId: string | null }) =>
    b.isHeading ? null : matcher.review(b.rawDescription, b.rawUnit, b.workItemId, { rough: true });
  const { ncKhacRate, tbRate, mmtbRate } = project;
  const tree = computeBoqTree(project.boqItems);
  // dòng tiêu đề khi chuyển sang các dòng thuộc sheet bổ sung (Prelim, BPTC...)
  const sheetRows = await prisma.projectSheet.findMany({ where: { projectId: project.id, kind: "BOQ" }, select: { id: true, name: true } });
  const sheetName = new Map(sheetRows.map((s) => [s.id, s.name]));
  const firstOfSheet = new Map<string, string>();
  {
    const seen = new Set<string>();
    for (const b of project.boqItems) {
      if (b.sheetId && !seen.has(b.sheetId)) {
        seen.add(b.sheetId);
        firstOfSheet.set(b.id, sheetName.get(b.sheetId) ?? "Sheet bổ sung");
      }
    }
  }
  // Bảng tự do được đưa vào CHI TIẾT: thành tiền nằm ở cột chi phí đã chọn
  const LINK_POS: Record<string, number> = { vt: 0, nc: 1, nck: 2, tp: 3, tb: 4, mmtb: 5 };
  const gridSheets = await prisma.projectSheet.findMany({
    where: { projectId: project.id, kind: "GRID", linkCol: { not: null }, amountCol: { not: null } },
    orderBy: { orderIndex: "asc" },
    include: { cells: true, metas: true },
  });
  const gridSources = gridSheets.length ? (await getGridSources(project)).values : undefined;
  const gridSections = gridSheets.map((g) => {
    const raw = new Map(g.cells.map((c) => [`${c.row}:${c.col}`, c.value]));
    const cols = (JSON.parse(g.colTitles) as string[]).length;
    const ev = createEvaluator((r, c) => raw.get(`${r}:${c}`) ?? "", g.rowCount, cols, gridSources);
    const headingAt = new Map(g.metas.map((m) => [m.row, m.title]));
    const descCol = g.amountCol === 0 ? 1 : 0;
    const pos = LINK_POS[g.linkCol as string] ?? 3;
    const amountOf = (r: number) => {
      const v = ev.valueOf(r, g.amountCol as number);
      return typeof v === "number" ? v : 0;
    };
    const amountCells = (v: number, bold: boolean) =>
      [0, 1, 2, 3, 4, 5, 6].map((i) => (
        <td key={i} className={`${td} text-right ${bold ? "font-bold" : ""}`}>
          {i === pos || i === 6 ? formatMoney(v) : ""}
        </td>
      ));
    const out: React.ReactNode[] = [
      <tr key={`gb-${g.id}`} className="bg-slate-800 text-white">
        <td className={td} />
        <td className={`${tdWrap} font-bold`} colSpan={TOTAL_COLS - 1}>
          SHEET BỔ SUNG (bảng tự do): {g.name}
        </td>
      </tr>,
    ];
    let seq = 0;
    let total = 0;
    for (let r = 0; r < g.rowCount; r++) {
      if (headingAt.has(r)) {
        let sub = 0;
        for (let k = r + 1; k < g.rowCount && !headingAt.has(k); k++) sub += amountOf(k);
        out.push(
          <tr key={`gh-${g.id}-${r}`} className={headingClass(1)}>
            <td className={td} />
            <td className={`${tdWrap}`} colSpan={13}>{headingAt.get(r)}</td>
            {amountCells(sub, true)}
            <td className={td} />
            <td className={td} />
          </tr>
        );
        seq = 0;
        continue;
      }
      const desc = formatCellValue(ev.valueOf(r, descCol));
      const amt = amountOf(r);
      if (!desc && amt === 0) continue;
      seq++;
      total += amt;
      out.push(
        <tr key={`gr-${g.id}-${r}`} className="hover:bg-slate-50">
          <td className={`${td} text-center text-slate-500`}>{seq}</td>
          <td className={td} />
          <td className={tdWrap}>{desc}</td>
          {Array.from({ length: 11 }, (_, i) => <td key={i} className={td} />)}
          {amountCells(amt, false)}
          <td className={td} />
          <td className={td} />
        </tr>
      );
    }
    out.push(
      <tr key={`gt-${g.id}`} className="bg-yellow-100 font-bold text-slate-900">
        <td className={td} />
        <td className={`${tdWrap} text-center`} colSpan={13}>Tổng sheet &quot;{g.name}&quot;</td>
        {amountCells(total, true)}
        <td className={td} />
        <td className={td} />
      </tr>
    );
    return out;
  });
  const banner = (bid: string) => {
    const nm = firstOfSheet.get(bid);
    return nm ? (
      <tr key={`bn-${bid}`} className="bg-slate-800 text-white">
        <td className={td} />
        <td className={`${tdWrap} font-bold`} colSpan={TOTAL_COLS - 1}>SHEET BỔ SUNG: {nm}</td>
      </tr>
    ) : null;
  };
  const methodOf = new Map(project.boqItems.map((x) => [x.id, x.method]));
  const subUnitMap = subUnitPriceByBoq(project.boqItems, project.subcontractorItems);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="font-medium text-slate-900">CHI TIẾT chiết tính</h2>
      <p className="mt-1 text-xs text-slate-500">
        Hao hụt vật tư nhập 1 lần ở sheet TH Vật Tư. Nhập tỷ lệ Nhân công khác / Thiết bị / MMTB + Vật tư phụ ở dòng vàng trên cùng — áp dụng cho toàn bộ công tác.
        {" Bạn sửa được định mức hao phí, thêm / xoá / đổi mục chi phí dòng hao phí (người duyệt định mức sẽ kiểm tra lại ở mục Duyệt định mức). Chọn nhầm mã định mức thì bấm vào ô mã → ✕ Bỏ mã này, chọn lại."}
      </p>

      <ScrollToHash />
      <ColWidthsInit tableId="ct-table" />
      {canLines && <BulkDeleteBar projectId={project.id} kind="ct-lines" noun="dòng hao phí" />}
      <div className="mt-1 flex justify-end">
        <ResetColsButton />
      </div>
      <div className="mt-3">
        <ScrollTable>
        <table id="ct-table" className="w-max min-w-full border-separate border-spacing-0 text-[11px] leading-tight">
          <colgroup>
            {Array.from({ length: TOTAL_COLS }, (_, i) => (
              <col key={i} data-i={i} />
            ))}
          </colgroup>
          <thead className="text-center text-slate-900 [&>tr>*]:sticky [&>tr>*]:z-20 [&>tr>*]:h-7 [&>tr>*]:align-middle [&>tr:nth-child(1)>*]:top-0 [&>tr:nth-child(2)>*]:top-[28px] [&>tr:nth-child(3)>*]:top-[56px] [&>tr:nth-child(-n+2)>*]:bg-green-100 [&>tr:nth-child(3)>*]:bg-yellow-100">
            <tr>
              <th rowSpan={2} className={th}>TT<ColResizer index={0} /></th>
              <th rowSpan={2} className={`${th} !px-0.5`}>Mã ĐM<ColResizer index={1} /></th>
              <th rowSpan={2} className={th}>DIỄN GIẢI<ColResizer index={2} /></th>
              <th rowSpan={2} className={th}>Đơn vị<ColResizer index={3} /></th>
              <th rowSpan={2} className={th}>Khối lượng<ColResizer index={4} /></th>
              <th rowSpan={2} className={`${th} !px-0.5`}>Định mức<ColResizer index={5} /></th>
              <th rowSpan={2} className={th}>Hao hụt<ColResizer index={6} /></th>
              <th rowSpan={2} className={th}>Tổng KL<ColResizer index={7} /></th>
              <th colSpan={6} className={th}>ĐƠN GIÁ</th>
              <th colSpan={7} className={th}>THÀNH TIỀN (VND)</th>
              <th rowSpan={2} className={th} title="Đơn giá của công tác, sheet BOQ lấy đơn giá từ cột này">Đơn giá TTP<ColResizer index={21} /></th>
              <th rowSpan={2} className={th}>Hình thức / Ghi chú<ColResizer index={22} /></th>
            </tr>
            <tr>
              {["Vật tư", "Nhân công", "Nhân công khác", "Thầu phụ", "Thiết bị", "MMTB + VT phụ"].map((t, i) => (
                <th key={`d${t}`} className={th}>
                  {t}
                  <ColResizer index={8 + i} />
                </th>
              ))}
              {["Vật tư", "Nhân công", "Nhân công khác", "Thầu phụ", "Thiết bị", "MMTB + VT phụ", "Tổng cộng"].map((t, i) => (
                <th key={`t${t}`} className={th}>
                  {t}
                  <ColResizer index={14 + i} />
                </th>
              ))}
            </tr>
            <tr className="text-[11px] font-medium">
              <td colSpan={8} className="border border-slate-400 px-2 text-right">
                Tỷ lệ áp dụng chung cho tất cả công tác ▸
              </td>
              <td className="border border-slate-400" />
              <td className="border border-slate-400" />
              <td className="border border-slate-400 !px-0.5">
                <ExtraRateInput projectId={project.id} kind="ncKhacRate" ratePercent={ncKhacRate * 100} /><div className="text-center text-[9px] font-normal text-slate-500">×NC</div>
                
              </td>
              <td className="border border-slate-400" />
              <td className="border border-slate-400 !px-0.5">
                <ExtraRateInput projectId={project.id} kind="tbRate" ratePercent={tbRate * 100} /><div className="text-center text-[9px] font-normal text-slate-500">×NC</div>
                
              </td>
              <td className="border border-slate-400 !px-0.5">
                <ExtraRateInput projectId={project.id} kind="mmtbRate" ratePercent={mmtbRate * 100} /><div className="text-center text-[9px] font-normal text-slate-500">×dòng</div>
                
              </td>
              <td colSpan={9} className="border border-slate-400" />
            </tr>
          </thead>
          <tbody>
            {(() => { let seq = 0; const running = { vt: 0, nc: 0, nck: 0, tp: 0, tb: 0, mmtb: 0 }; return project.boqItems.map((b) => {
              if (b.isHeading) {
                // 3 dòng tổng (trước thuế / VAT / sau thuế): tính tổng cho 7 cột Thành tiền
                const kind = summaryKind(b.rawDescription);
                if (kind) {
                  const f = kind === "subtotal" ? 1 : kind === "vat" ? project.vatRate : 1 + project.vatRate;
                  const vals = [running.vt, running.nc, running.nck, running.tp, running.tb, running.mmtb].map((v) => v * f);
                  const all = vals.reduce((s, v) => s + v, 0);
                  // Tên chuẩn cho 3 dòng tổng; thuế suất theo khai báo của dự án (BOQ của CĐT có thể ghi khác)
                  const vatPct = +(project.vatRate * 100).toFixed(2);
                  const label = kind === "subtotal" ? "TỔNG CỘNG TRƯỚC THUẾ" : kind === "vat" ? `THUẾ VAT ${vatPct}%` : "TỔNG CỘNG SAU THUẾ";
                  return (
                    <tr key={b.id} className="bg-yellow-100 font-bold text-slate-900">
                      <td className={td} />
                      <td className={`${tdWrap} text-center`} colSpan={13}>{label}</td>
                      {[...vals, all].map((v, i) => (
                        <td key={i} className={`${td} text-right`}>{formatMoney(v)}</td>
                      ))}
                      <td className={td} />
                      <td className={td} />
                    </tr>
                  );
                }
                return (
                  <Fragment key={b.id}>
                    {banner(b.id)}
                  <tr className={headingClass(tree.depthOf.get(b.id) ?? 0)}>
                    <td className={`${td} text-center font-bold`}>{b.stt}</td>
                    <td className={`${tdWrap} font-bold text-slate-900`} colSpan={TOTAL_COLS - 2} style={{ paddingLeft: 6 + (tree.depthOf.get(b.id) ?? 0) * 14 }}>
                      {b.rawDescription}
                      {(() => {
                        const leafIds = (tree.scope.get(b.id) ?? []).filter((x) => methodOf.get(x) === "DETAIL" && project.boqItems.find((y) => y.id === x)?.workItemId);
                        if (leafIds.length === 0) return null;
                        const mine = project.subcontractorItems.filter((s) => s.fromHeadingId === b.id && s.assignId);
                        const byAssign = new Map<string, typeof mine>();
                        for (const s of mine) byAssign.set(s.assignId as string, [...(byAssign.get(s.assignId as string) ?? []), s]);
                        const givenOf = (id: string) => {
                          const it = project.boqItems.find((y) => y.id === id);
                          const q = project.subcontractorItems.filter((s) => s.boqItemId === id && !s.followBoq).reduce((a, s) => a + s.quantity, 0);
                          return it && it.quantity > 0 ? (q / it.quantity) * 100 : 0;
                        };
                        return (
                          <HeadingSubDialog
                            projectId={project.id}
                            headingId={b.id}
                            headingText={`${b.stt} ${b.rawDescription}`.trim()}
                            items={leafIds.map((id) => {
                              const it = project.boqItems.find((y) => y.id === id)!;
                              return { id, stt: it.stt, name: it.rawDescription || it.workItem?.name || "", qty: it.quantity, unit: it.rawUnit || it.workItem?.unit || "", givenPct: givenOf(id) };
                            })}
                            assigns={[...byAssign.entries()].map(([assignId, list]) => ({
                              assignId,
                              contractorName: list[0].contractorName,
                              percent: list[0].percent ?? 0,
                              coverVT: list[0].coverVT,
                              coverTB: list[0].coverTB,
                              coverNC: list[0].coverNC,
                              itemIds: list.map((x) => x.boqItemId as string),
                            }))}
                            rates={Object.fromEntries(mgmtRates)}
                          />
                        );
                      })()}
                    </td>
                    <td className={`${td} text-center`}>
                      <MethodBulkSelect
                        projectId={project.id}
                        headingText={b.rawDescription}
                        ids={tree.scope.get(b.id) ?? []}
                        subCount={(tree.scope.get(b.id) ?? []).filter((x) => methodOf.get(x) === "SUB").length}
                      />
                    </td>
                  </tr>
                  </Fragment>
                );
              }
              seq++;
              const itemIdx = seq - 1;
              const isSub = b.method === "SUB";
              const subs = project.subcontractorItems.filter((s) => s.boqItemId === b.id);
              const sub = subs[0];
              const lines = [...(b.workItem?.resources ?? [])].sort(
                (x, y) => CAT_ORDER[x.category] - CAT_ORDER[y.category]
              );

              // hệ số quy đổi ĐVT BOQ ↔ ĐVT định mức (VD BOQ tấn, định mức kg → ×1000): hiện thẳng trong cột Định mức
              const unitF = project.unitFactors.get(b.id) ?? 1;
              // Tính từng dòng hao phí + cộng dồn lên dòng công tác
              const calc = lines.map((line) => {
                const qty0 = line.quantity * b.quantity;
                const totalQty = qty0 * (1 + (line.wastageRate || 0));
                const amt = totalQty * line.resource.unitPrice;
                const nck = line.category === "NC" ? amt * ncKhacRate : 0;
                const tbk = line.category === "NC" ? amt * tbRate : 0;
                const mmtb = (amt + nck + tbk) * mmtbRate;
                return { line, qty0, totalQty, amt, nck, tbk, mmtb, total: amt + nck + tbk + mmtb };
              });
              const sum = {
                vt: calc.filter((c) => c.line.category === "VT").reduce((s, c) => s + c.amt, 0),
                nc: calc.filter((c) => c.line.category === "NC").reduce((s, c) => s + c.amt, 0),
                nck: calc.reduce((s, c) => s + c.nck, 0),
                tp: subs.reduce((s, x) => s + x.amount, 0),
                tb: calc.filter((c) => c.line.category === "TB").reduce((s, c) => s + c.amt, 0) + calc.reduce((s, c) => s + c.tbk, 0),
                mmtb: calc.reduce((s, c) => s + c.mmtb, 0),
              };
              const itemTotal = sum.vt + sum.nc + sum.nck + sum.tp + sum.tb + sum.mmtb;
              running.vt += sum.vt;
              running.nc += sum.nc;
              running.nck += sum.nck;
              running.tp += sum.tp;
              running.tb += sum.tb;
              running.mmtb += sum.mmtb;

              return (
                <Fragment key={b.id}>
                  {banner(b.id)}
                  <tr id={`ct-${b.id}`} className={`scroll-mt-[96px] ${isSub ? "bg-orange-50" : "bg-cyan-50"}`}>
                    <td className={`${td} text-center font-semibold`}>{b.stt || itemIdx + 1}</td>
                    <td className={`${td} !px-0.5 text-[9px]`}>
                      <WorkItemAssignCell compact currentId={b.workItemId} currentCode={b.workItem?.code ?? null} projectId={project.id} boqItemId={b.id} defaultName={b.rawDescription} defaultUnit={b.rawUnit} review={reviewRow(b)} />
                    </td>
                    <td className={`${tdWrap} max-w-[280px] font-semibold text-slate-900`}>{b.rawDescription || b.workItem?.name || "(không có mô tả)"}
                      {b.workItem && project.unitFactors.has(b.id) && (
                        <div className="text-[10px] font-medium text-emerald-700" title="BOQ của chủ đầu tư và định mức dùng đơn vị khác nhau nên hao phí đã được quy đổi tự động">
                          ĐVT BOQ: {b.rawUnit} · ĐVT định mức: {b.workItem.unit} → quy đổi ×{+(project.unitFactors.get(b.id) as number).toPrecision(6)}
                        </div>
                      )}
                      {b.workItem && unitMismatch(b.rawUnit, b.workItem.unit) && (
                        <div className="text-[10px] font-semibold text-red-600" title="Hai đơn vị khác nhau và phần mềm không tự quy đổi được — kiểm tra lại mã định mức hoặc khối lượng">
                          ⚠ ĐVT BOQ ({b.rawUnit}) khác ĐVT định mức ({b.workItem.unit}) — chưa quy đổi được
                        </div>
                      )}
                      {b.workItem && b.workItem.name !== b.rawDescription && b.rawDescription && (
                        <div className="text-[10px] font-normal text-slate-400">Định mức: {b.workItem.name}</div>
                      )}
                    </td>
                    <td className={`${td} text-center font-semibold`}>{b.rawUnit || b.workItem?.unit}</td>
                    <td className={`${td} text-center font-semibold`}>{formatQty(b.quantity)}</td>
                    <td className={td} />
                    <td className={td} />
                    <td className={td} />
                    <td className={td} />
                    <td className={td} />
                    <td className={td} />
                    <td className={`${td} text-right font-medium text-orange-700`}>{isSub ? formatMoney(sub?.unitPrice ?? 0) : ""}</td>
                    <td className={td} />
                    <td className={td} />
                    <td className={`${td} text-right font-semibold`}>{formatMoney(sum.vt)}</td>
                    <td className={`${td} text-right font-semibold`}>{formatMoney(sum.nc)}</td>
                    <td className={`${td} text-right font-semibold`}>{formatMoney(sum.nck)}</td>
                    <td className={`${td} text-right font-semibold`}>{formatMoney(sum.tp)}</td>
                    <td className={`${td} text-right font-semibold`}>{formatMoney(sum.tb)}</td>
                    <td className={`${td} text-right font-semibold`}>{formatMoney(sum.mmtb)}</td>
                    <td className={`${td} text-right font-bold text-slate-900`}>{formatMoney(itemTotal)}</td>
                    <td
                      id={`ctp-${b.id}`}
                      title="Đơn giá của công tác (khớp với cột Trực Tiếp Phí ở tab BOQ)"
                      className={`${td} scroll-mt-[96px] text-right font-semibold text-blue-700`}
                    >
                      {formatMoney(boqDirectUnitPrice(b, project, subUnitMap.get(b.id) ?? 0))}
                    </td>
                    <td className={`${td} text-center`}>
                      <MethodSelect projectId={project.id} boqItemId={b.id} method={b.method} hasSubPrice={(sub?.unitPrice ?? 0) > 0} />
                    </td>
                  </tr>

                  {!isSub && b.workItem && (
                    <tr>
                      <td className="border border-slate-200 px-1 py-0.5" colSpan={TOTAL_COLS}>
                        <SubPortionEditor
                          projectId={project.id}
                          boqItemId={b.id}
                          boqQty={b.quantity}
                          unit={b.rawUnit || b.workItem.unit}
                          portions={subs.map((x) => ({ id: x.id, quantity: x.quantity, coverVT: x.coverVT, coverTB: x.coverTB, coverNC: x.coverNC, coveredLines: x.coveredLines, contractorName: x.contractorName, unitPrice: x.unitPrice, amount: x.amount, note: x.note }))}
                          lines={lines.map((l) => ({ id: l.id, name: l.resource.name, category: l.category }))}
                        />
                      </td>
                    </tr>
                  )}

                  {isSub && (
                    <tr>
                      <td className="border border-slate-200 px-2 py-0.5 text-orange-700" colSpan={TOTAL_COLS}>
                        Công tác giao thầu phụ — nhập nhà thầu và đơn giá ở sheet <b>TH Thầu Phụ</b>; đơn giá tự hiện ở cột Thầu phụ phía trên.
                      </td>
                    </tr>
                  )}

                  {!isSub && !b.workItem && (
                    <tr>
                      <td className="border border-slate-200 px-2 py-0.5 text-slate-400" colSpan={TOTAL_COLS}>
                        Chưa có định mức - chọn Mã ĐM ở dòng trên (hoặc tại tab BOQ) để tự động điền hao phí, hoặc chuyển sang &quot;Thầu phụ&quot;.
                        <NewNormModal projectId={project.id} boqItemId={b.id} defaultName={b.rawDescription} defaultUnit={b.rawUnit} />
                      </td>
                    </tr>
                  )}

                  {!isSub && calc.length > 0 && (
                    <tr>
                      <td className="border border-slate-200 px-2 py-0.5" />
                      <td className="border border-slate-200 px-2 py-0.5" />
                      <td className="border border-slate-200 px-2 py-0.5 text-xs font-semibold italic underline" colSpan={TOTAL_COLS - 2}>
                        Trực tiếp phí
                      </td>
                    </tr>
                  )}

                  {!isSub &&
                    calc.map(({ line, totalQty, amt, nck, tbk, mmtb, total }) => {
                      const isNC = line.category === "NC";
                      const isVT = line.category === "VT";
                      const price = formatMoney(line.resource.unitPrice);
                      return (
                        <tr key={line.id} className="italic hover:bg-slate-50">
                          <td className={`${td} text-center not-italic`}>{canLines ? <input type="checkbox" data-bulk="ct-lines" value={line.id} className="h-3.5 w-3.5 cursor-pointer" /> : <LineUserActions lineId={line.id} name={line.resource.name} own={isOwnLine(line)} removalPending={removalPendingLines.has(line.id)} />}</td>
                          <td className={`${td} !px-0.5 text-[9px] text-slate-400 not-italic`}>
                            <div className="max-w-[52px] truncate" title={line.resource.code}>
                              {line.resource.code}
                            </div>
                          </td>
                          <td className={`${tdWrap} max-w-[280px] text-slate-700`}>
                            {line.resource.name}
                            {((line as LineExtra).ownFactor ?? 1) < 1 && <span className="ml-1 rounded bg-orange-100 px-1 text-[9px] font-medium not-italic text-orange-700">mình tự làm {Math.round(((line as LineExtra).ownFactor ?? 1) * 100)}%</span>}
                            <ResourceSwapCell
                              projectId={project.id}
                              boqItemId={b.id}
                              lineId={line.id}
                              category={line.category as "VT" | "NC" | "TB"}
                              currentId={line.resource.id}
                              swapped={project.lineSwaps.has(`${b.id}:${line.id}`)}
                              options={project.projectResources.filter((r) => r.sourceType === line.category).map((r) => ({ id: r.id, name: r.name, unit: r.unit, unitPrice: r.unitPrice }))}
                              sameNormCount={project.boqItems.filter((x) => x.workItemId === b.workItemId).length}
                            />
                            {canLines && (
                              <LineCategorySelect lineId={line.id} category={line.category as "VT" | "NC" | "TB"} name={line.resource.name} sharedCount={usageByWorkItem.get(b.workItemId ?? "") ?? 1} />
                            )}
                          </td>
                          <td className={`${td} text-center text-slate-500`}>{line.resource.unit}</td>
                          <td className={`${td} text-center text-slate-500`}>{formatQty(b.quantity)}</td>
                          <td className={`${td} text-center`}>
                            {canLines ? (
                              <LineQtyInput sharedCount={usageByWorkItem.get(b.workItemId ?? "") ?? 1} lineId={line.id} value={(line as LineExtra).baseQuantity ?? line.quantity} formula={line.quantityFormula} factor={unitF} />
                            ) : (
                              <span title={unitF !== 1 ? `Định mức gốc ${fmtNorm((line as LineExtra).baseQuantity ?? line.quantity)} × quy đổi ĐVT ${+unitF.toPrecision(6)}` : undefined}>
                                {fmtNorm(((line as LineExtra).baseQuantity ?? line.quantity) * unitF)}
                              </span>
                            )}
                          </td>
                          <td className={`${td} text-center`}>
                            {isVT ? (
                              <span title="Nhập ở sheet TH Vật Tư" className="text-blue-700">
                                {(line.wastageRate * 100).toFixed(1).replace(".", ",")}%
                              </span>
                            ) : null /* nhân công / máy thi công không có hao hụt */}
                          </td>
                          <td className={`${td} text-center text-slate-600`}>
                            <LineTotalQtyInput projectId={project.id} boqItemId={b.id} lineId={line.id} boqQty={b.quantity} value={totalQty} overridden={project.qtyOverride.has(`${b.id}:${line.id}`)} formula={project.qtyOverride.get(`${b.id}:${line.id}`)?.formula ?? ""} />
                          </td>
                          {/* ĐƠN GIÁ: VT, NC, NC khác, Thầu phụ, TB, MMTB */}
                          <td className={`${td} text-right`}>{isVT ? price : ""}</td>
                          <td className={`${td} text-right`}>{isNC ? price : ""}</td>
                          <td className={`${td} text-right text-slate-500`}>{isNC && ncKhacRate ? pctText(ncKhacRate) : ""}</td>
                          <td className={td} />
                          <td className={`${td} text-right`}>
                            {line.category === "TB" ? price : isNC && tbRate ? <span className="text-slate-500">{pctText(tbRate)}</span> : ""}
                          </td>
                          <td className={`${td} text-right text-slate-500`}>{mmtbRate ? pctText(mmtbRate) : ""}</td>
                          {/* THÀNH TIỀN */}
                          <td className={`${td} text-right`}>{isVT ? formatMoney(amt) : ""}</td>
                          <td className={`${td} text-right`}>{isNC ? formatMoney(amt) : ""}</td>
                          <td className={`${td} text-right`}>{formatMoney(nck)}</td>
                          <td className={td} />
                          <td className={`${td} text-right`}>{line.category === "TB" ? formatMoney(amt) : formatMoney(tbk)}</td>
                          <td className={`${td} text-right`}>{formatMoney(mmtb)}</td>
                          <td className={`${td} text-right font-medium text-slate-900`}>{formatMoney(total)}</td>
                          <td className={td} />
                          <td className={td} />
                        </tr>
                      );
                    })}

                  {/* Phần khối lượng / phần việc giao thầu phụ của công tác chiết tính: đơn giá + thành tiền ở cột Thầu phụ */}
                  {!isSub &&
                    subs.map((x) => {
                      const covered = parseCoveredLines(x.coveredLines);
                      const scope = covered
                        ? covered.length
                          ? lines.filter((l) => covered.includes(l.id)).map((l) => l.resource.name).join(", ")
                          : "phần việc riêng ngoài định mức"
                        : scopeLabel(x);
                      const mg = project.subMgmt.get(x.id);
                      const own = x.amount - (mg?.fee ?? 0); // giá trị phần giao = SL × đơn giá (amount đã cộng phí quản lý)
                      return (
                        <Fragment key={`tp-${x.id}`}>
                        <tr className="bg-orange-50/60 italic">
                          <td className={td} />
                          <td className={`${td} !px-0.5 text-[9px] font-semibold text-orange-700 not-italic`}>Thầu phụ</td>
                          <td className={`${tdWrap} max-w-[280px] text-slate-700`}>
                            <Link href={`/projects/${project.id}/thau-phu#sub-${x.id}`} className="text-orange-800 underline decoration-dotted underline-offset-2" title="Sửa đơn giá / nhà thầu ở sheet TH Thầu Phụ">
                              {x.note.trim() || `Giao thầu phụ (${scope})`}
                            </Link>
                            {x.contractorName.trim() && <span className="ml-1 text-[10px] not-italic text-slate-500">— {x.contractorName}</span>}
                          </td>
                          <td className={`${td} text-center text-slate-500`}>{b.rawUnit || b.workItem?.unit}</td>
                          <td className={`${td} text-center text-slate-500`}>{formatQty(x.quantity)}</td>
                          <td className={td} />
                          <td className={td} />
                          <td className={`${td} text-center text-slate-600`}>{formatQty(x.quantity)}</td>
                          {/* ĐƠN GIÁ: VT, NC, NC khác, Thầu phụ, TB, MMTB */}
                          <td className={td} />
                          <td className={td} />
                          <td className={td} />
                          <td className={`${td} text-right`}>{x.unitPrice ? formatMoney(x.unitPrice) : <span className="text-amber-600">chưa nhập</span>}</td>
                          <td className={td} />
                          <td className={td} />
                          {/* THÀNH TIỀN */}
                          <td className={td} />
                          <td className={td} />
                          <td className={td} />
                          <td className={`${td} text-right`}>{formatMoney(own)}</td>
                          <td className={td} />
                          <td className={td} />
                          <td className={`${td} text-right font-medium text-slate-900`}>{formatMoney(own)}</td>
                          <td className={td} />
                          <td className={td} />
                        </tr>
                        {/* Chi phí quản lý vật tư / thiết bị TMN cấp cho thầu phụ: 2 dòng, % × giá trị TMN cấp (phần thầu phụ không bao,
                            trên khối lượng giao) → cột Thầu phụ. % sửa được ngay tại dòng (riêng công tác này) hoặc theo mặc định nhà thầu */}
                        {mg &&
                          ([
                            { kind: "vt" as const, label: "Quản lý vật tư TMN cấp", code: "QL VT", base: mg.vtBase, pct: mg.vtPct, own: mg.vtOwn },
                            { kind: "tb" as const, label: "Quản lý thiết bị TMN cấp", code: "QL TB", base: mg.tbBase, pct: mg.tbPct, own: mg.tbOwn },
                          ]).filter((q) => q.base > 0).map((q) => (
                          <tr key={q.kind} className="bg-violet-50/70 italic">
                            <td className={td} />
                            <td className={`${td} !px-0.5 text-[9px] font-semibold text-violet-700 not-italic`}>{q.code}</td>
                            <td className={`${tdWrap} max-w-[280px] text-violet-900`}>
                              {q.label}
                              <span className="ml-1 text-[10px] not-italic text-violet-700">= % × giá trị {q.kind === "vt" ? "vật tư" : "thiết bị"} cấp {formatMoney(q.base)}</span>
                            </td>
                            <td className={`${td} text-center text-slate-500`}>%</td>
                            <td className={td} />
                            <td className={`${td} text-center`}>
                              <MgmtPctInput projectId={project.id} subId={x.id} kind={q.kind} pct={q.pct} own={q.own} />
                            </td>
                            <td className={td} />
                            <td className={td} />
                            {/* ĐƠN GIÁ: cột Thầu phụ = giá trị TMN cấp (cơ sở tính %) */}
                            <td className={td} />
                            <td className={td} />
                            <td className={td} />
                            <td className={`${td} text-right text-slate-600`}>{formatMoney(q.base)}</td>
                            <td className={td} />
                            <td className={td} />
                            {/* THÀNH TIỀN */}
                            <td className={td} />
                            <td className={td} />
                            <td className={td} />
                            <td className={`${td} text-right text-violet-800`}>{formatMoney((q.base * q.pct) / 100)}</td>
                            <td className={td} />
                            <td className={td} />
                            <td className={`${td} text-right font-medium text-slate-900`}>{formatMoney((q.base * q.pct) / 100)}</td>
                            <td className={td} />
                            <td className={td} />
                          </tr>
                        ))}
                        </Fragment>
                      );
                    })}

                  {!isSub && b.workItem && (
                    <tr>
                      <td className="border border-slate-200 bg-slate-50/60 px-2 py-1.5" colSpan={TOTAL_COLS}>
                        <AddResourceLine workItemId={b.workItem.id} projectId={project.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            }); })()}
            {gridSections}
            {project.boqItems.length === 0 && (
              <tr>
                <td colSpan={TOTAL_COLS} className="px-3 py-8 text-center text-slate-400">
                  Chưa có dòng BOQ nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </ScrollTable>
      </div>
    </section>
  );
}
