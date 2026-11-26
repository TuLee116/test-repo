import Link from "next/link";
import { prisma } from "@/lib/prisma";
import SheetHeader from "./SheetHeader";
import { notFound } from "next/navigation";
import { boqDirectUnitPrice, computeDg0, subUnitPriceByBoq } from "@/lib/cost";
import { getCatalogForPicker, getProjectWithBoq } from "@/lib/project-data";
import NumberCell from "./NumberCell";
import ImportButton from "./ImportButton";
import UpdateBoqButton from "./UpdateBoqButton";
import TableResize from "@/app/(app)/TableResize";
import { computeBoqTree, headingClass, summaryKind } from "@/lib/boq-tree";
import ScrollTable from "./ScrollTable";
import { BoqAddRow, BoqAppendButtons, BoqTextField } from "./BoqEditors";

// Dg0 âm (báo giá CĐT thấp hơn trực tiếp phí): tô đỏ cả ô để cảnh báo
const DG0_NEG = "bg-red-600 font-bold text-white";
import BoqBulkBar from "./BoqBulkBar";
import NumCellSelection from "./NumCellSelection";
import WorkItemAssignCell from "./WorkItemAssignCell";
import type { ExistingBoqRow } from "@/lib/boq-diff";
import { createMatcher } from "@/lib/boq-match";
import { childlessHeadingIds, computeBoqAmounts, scopeWithLinkedHeadings } from "@/lib/boq-amounts";
import { getGridLinkValues } from "@/lib/grid-links";
import BoqLinkButton from "./BoqLinkButton";
import { cookies } from "next/headers";
import BoqImageCell, { type BoqImageRef } from "./BoqImageCell";
import BoqImageToggle from "./BoqImageToggle";
import { DomOutline } from "@/app/(app)/outline";

function formatMoney(n: number) {
  return Math.round(n).toLocaleString("vi-VN");
}

export default async function BoqSheetView({ projectId: id, sheetId }: { projectId: string; sheetId: string | null }) {
  const project = await getProjectWithBoq(id);
  if (!project) notFound();
  const sheet = sheetId ? await prisma.projectSheet.findUnique({ where: { id: sheetId } }) : null;
  if (sheetId && (!sheet || sheet.projectId !== id)) notFound();
  // chỉ các dòng của sheet này (sheetId null = sheet BOQ chính)
  const sheetItems = project.boqItems.filter((b) => (b.sheetId ?? null) === sheetId);
  const tableKey = sheetId ? `boq-${sheetId}` : "boq";

  const catalog = await getCatalogForPicker();

  // Rà soát mã định mức thường trực (không chỉ lúc nhập/cập nhật BOQ): dòng chưa gán → gợi ý mã gần
  // nhất; dòng đã gán mà lệch nội dung (khác loại công tác/cấu kiện/đường kính/mác, hoặc khớp đúng 1 mã
  // khác) → cảnh báo kèm lý do. Ai dùng cũng tự thấy và tự sửa trên giao diện.
  const matcher = createMatcher(catalog, await prisma.workItemAlias.findMany());
  const reviewRow = (b: { rawDescription: string; rawUnit: string; isHeading: boolean; workItemId: string | null }) =>
    b.isHeading ? null : matcher.review(b.rawDescription, b.rawUnit, b.workItemId, { rough: true });

  const subIdByBoq = new Map(project.subcontractorItems.filter((s) => s.boqItemId).map((s) => [s.boqItemId as string, s.id]));
  const subUnitByBoq = subUnitPriceByBoq(project.boqItems, project.subcontractorItems);
  // Liên kết giá: Trực tiếp phí lấy từ sheet bảng tự do; Báo giá CĐT theo % của đầu mục hoặc từ sheet bảng tự do
  const { values: gridValues, options: gridOptions, sheets: gridSheets } = await getGridLinkValues(id, project);
  const gridLabel = new Map(gridOptions.map((o) => [o.value, o.label]));
  const gridShort = new Map(gridOptions.map((o) => [o.value, o.short]));
  const directUnitById = new Map(project.boqItems.map((b) => [b.id, boqDirectUnitPrice(b, project, subUnitByBoq.get(b.id) ?? 0)]));
  const amounts = computeBoqAmounts(project.boqItems, (itemId) => directUnitById.get(itemId) ?? 0, gridValues);
  const rows = sheetItems.map((b) => {
    const directUnitPrice = directUnitById.get(b.id) ?? 0;
    const amt = amounts.get(b.id);
    const directTotal = amt?.directTotal ?? 0;
    const quotedTotal = amt ? amt.quotedTotal : null;
    const dg0 =
      b.isHeading && (b.directMode || b.quotedMode)
        ? directTotal > 0 && quotedTotal != null
          ? (quotedTotal - directTotal) / directTotal
          : null
        : computeDg0(directUnitPrice, b.quotedUnitPrice);
    return { boqItem: b, directUnitPrice, directTotal, dg0, quotedTotal };
  });
  let seq = 0;
  const tree = computeBoqTree(sheetItems);
  const childlessHeadings = childlessHeadingIds(sheetItems);
  const headingOptions = sheetItems
    .filter((b) => b.isHeading && !summaryKind(b.rawDescription))
    .map((b) => ({ id: b.id, label: `${"  ".repeat(tree.depthOf.get(b.id) ?? 0)}${b.stt ? b.stt + " " : ""}${b.rawDescription}`.slice(0, 90) }));
  const headingLabelById = new Map(sheetItems.filter((b) => b.isHeading).map((b) => [b.id, `${b.stt ? b.stt + " " : ""}${b.rawDescription}`.trim()]));
  // tổng cộng dồn tới từng dòng (dùng cho các dòng tổng cuối BOQ)
  const cum = new Map<string, { d: number; q: number }>();
  {
    let d = 0;
    let q = 0;
    for (const r of rows) {
      if (!r.boqItem.isHeading || amounts.has(r.boqItem.id)) {
        d += r.directTotal;
        q += r.quotedTotal ?? 0;
      }
      cum.set(r.boqItem.id, { d, q });
    }
  }
  // Subtotal từng đầu mục: cộng thành tiền các công tác nằm dưới nó (kể cả các đầu mục con lồng bên trong)
  const rowById = new Map(rows.map((r) => [r.boqItem.id, r]));
  const headingTotals = new Map<string, { d: number; q: number; count: number }>();
  // (đầu mục không có con đã liên kết giá được tính như 1 công tác của đầu mục cha)
  for (const [headingId, ids] of scopeWithLinkedHeadings(sheetItems)) {
    let d = 0;
    let q = 0;
    for (const itemId of ids) {
      const r = rowById.get(itemId);
      if (!r) continue;
      d += r.directTotal;
      q += r.quotedTotal ?? 0;
    }
    headingTotals.set(headingId, { d, q, count: ids.length });
  }
  for (const r of rows) {
    if (r.boqItem.isHeading && amounts.has(r.boqItem.id)) headingTotals.set(r.boqItem.id, { d: r.directTotal, q: r.quotedTotal ?? 0, count: 1 });
  }
  const sumDirect = rows.reduce((s, r) => s + r.directTotal, 0);
  const sumQuoted = rows.reduce((s, r) => s + (r.quotedTotal ?? 0), 0);

  const subByBoq = new Map(project.subcontractorItems.filter((s) => s.boqItemId).map((s) => [s.boqItemId as string, s]));
  const existingItems: ExistingBoqRow[] = sheetItems.map((b) => {
    const sub = subByBoq.get(b.id);
    return {
      id: b.id,
      rawDescription: b.rawDescription,
      rawUnit: b.rawUnit,
      stt: b.stt,
      quantity: b.quantity,
      isHeading: b.isHeading,
      workItemId: b.workItemId,
      workItemCode: b.workItem?.code ?? null,
      workItemName: b.workItem?.name ?? null,
      hasSubData: !!sub && (sub.unitPrice > 0 || sub.amount > 0 || sub.contractorName.trim() !== ""),
    };
  });

  const projectId = project.id;

  // Cột "Hình ảnh": mặc định hiện khi sheet đã có ảnh; người dùng tự bật / tắt (nhớ theo sheet)
  const imagesByBoq = new Map<string, BoqImageRef[]>();
  const sheetItemIds = new Set(sheetItems.map((b) => b.id));
  for (const im of await prisma.boqImage.findMany({ where: { projectId }, orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }], select: { id: true, boqItemId: true } })) {
    if (!sheetItemIds.has(im.boqItemId)) continue;
    const l = imagesByBoq.get(im.boqItemId) ?? [];
    l.push({ id: im.id });
    imagesByBoq.set(im.boqItemId, l);
  }
  const imageCount = [...imagesByBoq.values()].reduce((n, l) => n + l.length, 0);
  const imgCookie = `imgcol-${tableKey}`;
  const imgPref = (await cookies()).get(imgCookie)?.value;
  const showImages = imgPref ? imgPref === "1" : imageCount > 0;
  const imgCell = (boqItemId: string) =>
    showImages ? (
      <td className="border border-slate-200 px-1 py-0 align-middle">
        <BoqImageCell projectId={projectId} boqItemId={boqItemId} images={imagesByBoq.get(boqItemId) ?? []} />
      </td>
    ) : null;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        {sheet ? <SheetHeader projectId={id} sheetId={sheet.id} name={sheet.name} /> : <h2 className="font-medium text-slate-900">Bảng khối lượng (BOQ)</h2>}
        <div className="flex items-center gap-2">
          {rows.length === 0 && <BoqAppendButtons projectId={project.id} sheetId={sheetId} />}
          <BoqImageToggle cookieName={imgCookie} on={showImages} count={imageCount} />
          {rows.length > 0 && <UpdateBoqButton projectId={project.id} sheetId={sheetId} catalog={catalog} existingItems={existingItems} />}
          <ImportButton projectId={project.id} catalog={catalog} sheetId={sheetId} />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:max-w-md">
        <div className="rounded-md bg-slate-50 p-3">
          <div className="text-xs text-slate-500">Tổng Trực Tiếp Phí</div>
          <div className="text-base font-semibold text-slate-900">{formatMoney(sumDirect)} đ</div>
        </div>
        <div className="rounded-md bg-slate-50 p-3">
          <div className="text-xs text-slate-500">Tổng Giá Báo CĐT</div>
          <div className="text-base font-semibold text-slate-900">{formatMoney(sumQuoted)} đ</div>
        </div>
      </div>

      <div className="mt-4">
        <BoqBulkBar projectId={projectId} />
        <NumCellSelection projectId={projectId} />
        <div className="flex justify-end">
          <DomOutline tableId={`rz-${tableKey}`} storageKey={tableKey} />
        </div>
        <TableResize tableId={`rz-${tableKey}`} storageKey={tableKey} />
        <ScrollTable>
<table id={`rz-${tableKey}`} className="w-full min-w-[1200px] border-collapse text-[13px] leading-5">
          <thead className="bg-green-100 text-center text-slate-900">
            <tr>
              <th rowSpan={2} className="border border-slate-400 px-1 py-2 font-semibold">
                <input type="checkbox" data-boq-checkall title="Chọn / bỏ chọn tất cả" className="h-3.5 w-3.5 cursor-pointer" />
              </th>
              <th rowSpan={2} className="border border-slate-400 px-2 py-2 font-semibold">TT</th>
              {showImages && <th rowSpan={2} className="border border-slate-400 px-2 py-2 font-semibold">Hình ảnh</th>}
              <th rowSpan={2} className="border border-slate-400 px-3 py-2 font-semibold">Mô tả công việc (BOQ)</th>
              <th rowSpan={2} className="border border-slate-400 px-3 py-2 font-semibold">Mã định mức</th>
              <th rowSpan={2} className="border border-slate-400 px-2 py-2 font-semibold">ĐVT</th>
              <th rowSpan={2} className="border border-slate-400 px-2 py-2 font-semibold">Khối lượng</th>
              <th colSpan={2} className="border border-slate-400 px-3 py-1.5 font-semibold">Trực Tiếp Phí</th>
              <th rowSpan={2} className="border border-slate-400 px-2 py-2 font-semibold">Dg0</th>
              <th colSpan={2} className="border border-slate-400 px-3 py-1.5 font-semibold">Báo Giá CĐT</th>
              <th rowSpan={2} className="border border-slate-400 px-2 py-2 font-semibold">Ghi chú</th>
              <th rowSpan={2} className="border border-slate-400 px-2 py-2 font-semibold">Thêm</th>
            </tr>
            <tr>
              <th className="border border-slate-400 px-3 py-1.5 font-semibold">Đơn Giá</th>
              <th className="border border-slate-400 px-3 py-1.5 font-semibold">Thành Tiền</th>
              <th className="border border-slate-400 px-3 py-1.5 font-semibold">Đơn Giá</th>
              <th className="border border-slate-400 px-3 py-1.5 font-semibold">Thành Tiền</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ boqItem, directUnitPrice, directTotal, dg0, quotedTotal }) => {
              if (boqItem.isHeading) {
                const kind = summaryKind(boqItem.rawDescription);
                if (kind) {
                  const f = kind === "subtotal" ? 1 : kind === "vat" ? project.vatRate : 1 + project.vatRate;
                  const label = kind === "vat" ? `${boqItem.rawDescription} (${+(project.vatRate * 100).toFixed(2)}%)` : boqItem.rawDescription;
                  return (
                    <tr key={boqItem.id} data-ol-head={boqItem.id} data-ol-fixed="" className="bg-yellow-100 font-bold text-slate-900">
                      <td className="border border-slate-300 px-1 py-0 text-center">
                        <input type="checkbox" data-boq-check={boqItem.id} data-stt={boqItem.stt} className="h-3.5 w-3.5 cursor-pointer" />
                      </td>
                      <td className="border border-slate-300 px-1 py-0" />
                      {showImages && <td className="border border-slate-300 px-1 py-0" />}
                      <td className="border border-slate-300 px-2 py-0 text-center" colSpan={4}>{label}</td>
                      <td className="border border-slate-300 px-1 py-0" />
                      <td className="border border-slate-300 px-2 py-0 text-right">{formatMoney((cum.get(boqItem.id)?.d ?? 0) * f)}</td>
                      <td className="border border-slate-300 px-1 py-0" />
                      <td className="border border-slate-300 px-1 py-0" />
                      <td className="border border-slate-300 px-2 py-0 text-right">{formatMoney((cum.get(boqItem.id)?.q ?? 0) * f)}</td>
                      <td className="border border-slate-300 px-1 py-0" />
                      <td className="border border-slate-300 px-1 py-0 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <span className="inline-block w-6" />
                          <BoqAddRow projectId={projectId} afterId={boqItem.id} isHeading />
                        </div>
                      </td>
                    </tr>
                  );
                }
                const sub = headingTotals.get(boqItem.id) ?? { d: 0, q: 0, count: 0 };
                const linkable = childlessHeadings.has(boqItem.id);
                const isLinked = linkable && !!(boqItem.directMode || boqItem.quotedMode);
                const pctShown = boqItem.quotedMode === "PCT" ? boqItem.quotedPct : boqItem.directMode === "PCT" ? boqItem.directPct : null;
                const directPctLabel = `${+(boqItem.directPct ?? 0).toFixed(4)}% × ${headingLabelById.get(boqItem.directBaseId ?? "") ?? "(mất đầu mục cơ sở)"}`;
                const hasSub = sub.count > 0;
                return (
                  <tr key={boqItem.id} data-ol-head={boqItem.id} data-ol-level={tree.depthOf.get(boqItem.id) ?? 0} className={headingClass(tree.depthOf.get(boqItem.id) ?? 0)}>
                    <td className="border border-slate-300 px-1 py-0 text-center">
                      <input type="checkbox" data-boq-check={boqItem.id} data-depth={tree.depthOf.get(boqItem.id) ?? 0} data-stt={boqItem.stt} className="h-3.5 w-3.5 cursor-pointer" />
                    </td>
                    <td className="border border-slate-300 px-1 py-0 text-center font-bold">
                      <div className="flex items-center">
                        {/* thu gọn / mở nhóm như Group của Excel - xử lý ở DomOutline */}
                        <button type="button" data-ol-toggle={boqItem.id} title="Thu gọn nhóm này" className="mr-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-slate-400 bg-white text-[10px] font-normal leading-none text-slate-700 hover:bg-slate-100 print:hidden">
                          −
                        </button>
                        <BoqTextField projectId={projectId} boqItemId={boqItem.id} field="stt" value={boqItem.stt} placeholder="TT" className="text-center font-bold" />
                      </div>
                    </td>
                    {imgCell(boqItem.id)}
                    <td className="border border-slate-300 px-2 py-0" colSpan={isLinked ? 2 : 5} style={{ paddingLeft: 8 + (tree.depthOf.get(boqItem.id) ?? 0) * 16 }}>
                      <BoqTextField projectId={projectId} boqItemId={boqItem.id} field="rawDescription" value={boqItem.rawDescription} placeholder="Tên đầu mục" multiline className="font-bold" />
                    </td>
                    {isLinked && (
                      <>
                        <td className="border border-slate-300 px-1 py-0 text-center text-[13px] font-normal">{pctShown != null ? "%" : ""}</td>
                        <td className="border border-slate-300 px-2 py-0 text-right text-[13px] font-normal">{pctShown != null ? `${+pctShown.toFixed(4)}%` : ""}</td>
                        <td
                          className="border border-slate-300 px-1 py-0 text-right text-[11px] font-normal text-violet-700"
                          title={boqItem.directMode === "LINK" ? (gridLabel.get(boqItem.directLink ?? "") ?? "Nguồn liên kết không còn tồn tại") : boqItem.directMode === "PCT" ? directPctLabel : undefined}
                        >
                          {boqItem.directMode === "LINK" ? `🔗 ${gridShort.get(boqItem.directLink ?? "") ?? "(mất liên kết)"}` : boqItem.directMode === "PCT" ? directPctLabel : ""}
                        </td>
                      </>
                    )}
                    <td className="border border-slate-300 px-2 py-0 text-right" title="Subtotal: tổng thành tiền các công tác thuộc đầu mục này">
                      {hasSub ? formatMoney(sub.d) : ""}
                    </td>
                    <td className={`border border-slate-300 px-2 py-0 text-right text-[13px] ${amounts.has(boqItem.id) && dg0 != null && dg0 < 0 ? DG0_NEG : "font-normal text-blue-700"}`}>{amounts.has(boqItem.id) && dg0 != null ? `${(dg0 * 100).toFixed(1)}%` : ""}</td>
                    <td
                      className="border border-slate-300 px-1 py-0 text-right text-[11px] font-normal text-violet-700"
                      title={boqItem.quotedMode === "LINK" ? (gridLabel.get(boqItem.quotedLink ?? "") ?? "Nguồn liên kết không còn tồn tại") : undefined}
                    >
                      {boqItem.quotedMode === "LINK" ? `🔗 ${gridShort.get(boqItem.quotedLink ?? "") ?? "(mất liên kết)"}` : ""}
                    </td>
                    <td className="border border-slate-300 px-2 py-0 text-right" title="Subtotal: tổng thành tiền các công tác thuộc đầu mục này">
                      {hasSub ? formatMoney(sub.q) : ""}
                    </td>
                    <td className="border border-slate-300 px-1 py-0">
                      <BoqTextField projectId={projectId} boqItemId={boqItem.id} field="note" value={boqItem.note} multiline className="text-[12px] font-normal" />
                    </td>
                    <td className="border border-slate-300 px-1 py-0 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span className="inline-flex w-6 justify-center">
                        {linkable && (
                          <BoqLinkButton
                            projectId={projectId}
                            boqItemId={boqItem.id}
                            description={boqItem.rawDescription}
                            current={{
                              directMode: boqItem.directMode as "PCT" | "LINK" | null,
                              directPct: boqItem.directPct,
                              directBaseId: boqItem.directBaseId,
                              directLink: boqItem.directLink,
                              quotedMode: boqItem.quotedMode as "PCT" | "LINK" | null,
                              quotedPct: boqItem.quotedPct,
                              quotedBaseId: boqItem.quotedBaseId,
                              quotedLink: boqItem.quotedLink,
                            }}
                            headings={headingOptions.filter((h) => h.id !== boqItem.id)}
                            sheets={gridSheets}
                          />
                        )}
                        </span>
                        <BoqAddRow projectId={projectId} afterId={boqItem.id} isHeading depth={tree.depthOf.get(boqItem.id) ?? 0} />
                      </div>
                    </td>
                  </tr>
                );
              }
              seq++;
              // Nội dung thể hiện = nội dung BOQ mời thầu; tên định mức chỉ ghi mờ bên dưới để đối chiếu
              const displayName = boqItem.rawDescription || boqItem.workItem?.name || "(không có mô tả)";
              const displayUnit = boqItem.rawUnit || boqItem.workItem?.unit || "-";
              const isSub = boqItem.method === "SUB";
              const subItemId = subIdByBoq.get(boqItem.id);
              const priceHref = isSub && subItemId ? `/projects/${project.id}/thau-phu#sub-${subItemId}` : `/projects/${project.id}/chi-tiet#ctp-${boqItem.id}`;
              return (
                <tr key={boqItem.id} className="border-t border-slate-100">
                  <td className="border border-slate-300 px-1 py-0 text-center">
                    <input type="checkbox" data-boq-check={boqItem.id} data-stt={boqItem.stt} className="h-3.5 w-3.5 cursor-pointer" />
                  </td>
                  <td className="border border-slate-200 px-1 py-0 text-center text-slate-500">
                    <BoqTextField projectId={projectId} boqItemId={boqItem.id} field="stt" value={boqItem.stt} placeholder={String(seq)} className="text-center" />
                  </td>
                  {imgCell(boqItem.id)}
                  <td className="border border-slate-200 px-2 py-0">
                    <BoqTextField projectId={projectId} boqItemId={boqItem.id} field="rawDescription" value={boqItem.rawDescription} placeholder={displayName} multiline className="font-medium text-slate-800" />
                  </td>
                  <td className="border border-slate-200 px-2 py-0">
                    <WorkItemAssignCell currentId={boqItem.workItemId} currentCode={boqItem.workItem?.code ?? null} projectId={projectId} boqItemId={boqItem.id} defaultName={boqItem.rawDescription} defaultUnit={boqItem.rawUnit} review={reviewRow(boqItem)} />
                  </td>
                  <td className="border border-slate-200 px-1 py-0 text-slate-600">
                    <BoqTextField projectId={projectId} boqItemId={boqItem.id} field="rawUnit" value={boqItem.rawUnit} placeholder={displayUnit} className="text-center" />
                  </td>
                  <td className="border border-slate-200 px-2 py-0 text-right">
                    <NumberCell projectId={projectId} boqItemId={boqItem.id} field="quantity" defaultValue={Math.round(boqItem.quantity * 100) / 100} />
                  </td>
                  <td className="border border-slate-200 px-2 py-0 text-right text-slate-600">
                    <Link href={priceHref} title={isSub ? "Xem đơn giá ở sheet TH Thầu Phụ" : "Xem chiết tính đơn giá ở sheet CHI TIẾT"} className="text-blue-700 underline decoration-dotted underline-offset-2 hover:text-blue-900">
                      {formatMoney(directUnitPrice)}
                    </Link>
                  </td>
                  <td className="border border-slate-200 px-2 py-0 text-right font-medium text-slate-900">{formatMoney(directTotal)}</td>
                  <td className={`border border-slate-200 px-2 py-0 text-right ${dg0 != null && dg0 < 0 ? DG0_NEG : "text-blue-700"}`} title={dg0 != null && dg0 < 0 ? "Báo giá CĐT thấp hơn trực tiếp phí" : undefined}>
                    {dg0 != null ? `${(dg0 * 100).toFixed(1)}%` : "-"}
                  </td>
                  <td className="border border-slate-200 px-2 py-0 text-right">
                    <NumberCell projectId={projectId} boqItemId={boqItem.id} field="quoted" defaultValue={boqItem.quotedUnitPrice != null ? Math.round(boqItem.quotedUnitPrice) : null} placeholder="Nhập giá" />
                  </td>
                  <td className="border border-slate-200 px-2 py-0 text-right font-medium text-slate-900">
                    {quotedTotal != null ? formatMoney(quotedTotal) : "-"}
                  </td>
                  <td className="border border-slate-200 px-1 py-0">
                      <BoqTextField projectId={projectId} boqItemId={boqItem.id} field="note" value={boqItem.note} multiline className="text-[12px] font-normal" />
                    </td>
                    <td className="border border-slate-200 px-1 py-0 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <span className="inline-block w-6" />
                      <BoqAddRow projectId={projectId} afterId={boqItem.id} isHeading={false} />
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={showImages ? 14 : 13} className="px-3 py-8 text-center text-slate-400">
                  Chưa có dòng khối lượng nào. Bấm &quot;+ Thêm công tác&quot;, chọn công tác ở trên, hoặc &quot;Nhập từ Excel&quot;.
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
