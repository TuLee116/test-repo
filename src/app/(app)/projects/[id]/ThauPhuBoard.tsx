"use client";

import { useState, useTransition } from "react";
import {
  addSubManualAction,
  addVtGroupAction,
  deleteVtGroupAction,
  renameVtGroupAction,
  setSubContractorBulkAction,
  setSubcontractorNameShowInDtcpAction,
  updateSubItemAction,
  setFieldFormulaAction,
} from "@/lib/actions";
import type { ContractorGroup, SubGroup, SubHeadingRow, SubItemRow, SubSheet } from "@/lib/thauphu-shared";
import QuoteImport from "./QuoteImport";
import ScrollToHash from "./ScrollToHash";
import NumInput from "@/app/(app)/NumInput";
import EnterDown from "@/app/(app)/EnterDown";
import { pasteSheetColumn } from "./paste-sheet";
import { FormulaNum } from "./LinkBar";
import TableResize from "@/app/(app)/TableResize";
import BulkDeleteBar from "./BulkDeleteBar";
import QuotedPctButton from "./QuotedPctButton";
import { collapseToLevel, OutlineBar, OutlineToggle, outlineHidden, useOutline } from "@/app/(app)/outline";
import DtcpToggleButton, { ToggleButton } from "./DtcpToggleButton";
import { headingClass } from "@/lib/boq-tree";
import ScrollTable from "./ScrollTable";
import { confirmNear } from "@/app/(app)/confirm-near";
import { setSubVatAction, setSubPrelimAction } from "@/lib/actions";
import { fmtQty } from "@/lib/fmt-qty";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"];
const fmt = (n: number) => (n ? Math.round(n).toLocaleString("vi-VN") : "");
const cell = "border border-slate-200 px-1.5 py-1";
const inputCls = "w-full rounded border border-slate-300 px-1 py-0.5 text-right";
const ghost = "w-full rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-slate-300 focus:border-blue-400 focus:bg-white";

type Field = "name" | "unit" | "quantity" | "unitPrice" | "contractorName" | "note";

function common(values: string[]): string {
  if (values.length === 0) return "";
  return values.every((v) => v === values[0]) ? values[0] : "";
}

function EditCell({ projectId, item, field, kind }: { projectId: string; item: SubItemRow; field: Field; kind: "text" | "num" | "ghost" }) {
  const [, start] = useTransition();
  const cur = field === "name" ? item.name : field === "unit" ? item.unit : field === "quantity" ? item.qty : field === "unitPrice" ? item.unitPrice : field === "contractorName" ? item.contractorName : item.note;
  if (kind === "num") {
    return (
      <FormulaNum
        value={cur as number}
        decimals
        qty={field === "quantity"}
        money={field === "unitPrice"}
        formula={field === "quantity" ? item.qtyFormula : item.unitPriceFormula}
        err={field === "quantity" ? item.qtyErr : item.unitPriceErr}
        onFormula={(f) => start(() => void setFieldFormulaAction(projectId, "sub", item.id, field === "quantity" ? "quantity" : "unitPrice", f))}
        onCommit={(v) => start(() => void updateSubItemAction(projectId, item.id, { [field]: v ?? 0 }))}
        onMultiPaste={(lines) => pasteSheetColumn(projectId, field === "quantity" ? "quantity" : "unitPrice", lines, start)}
        className={inputCls}
      />
    );
  }
  // chữ dài tự xuống dòng (ô cao theo nội dung), không bị che mất chữ; Enter = lưu
  return (
    <textarea
      key={String(cur)}
      defaultValue={String(cur)}
      rows={1}
      onBlur={(e) => {
        const val = e.currentTarget.value.replace(/\s*\n\s*/g, " ");
        if (val === cur) return;
        start(() => void updateSubItemAction(projectId, item.id, { [field]: val }));
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.currentTarget.blur();
      }}
      className={`${ghost} ${field === "unit" ? "text-center" : ""} field-sizing-content block resize-none leading-tight`}
    />
  );
}

// Ô VAT % của 1 dòng thầu phụ, hoặc của cả đầu mục (bulk: áp cho mọi dòng bên dưới; các dòng khác nhau thì ô để trống)
function VatCell({ projectId, itemIds, ratePct, bulk }: { projectId: string; itemIds: string[]; ratePct: number | null; bulk?: boolean }) {
  const [, start] = useTransition();
  if (itemIds.length === 0) return null;
  return (
    <NumInput
      value={ratePct}
      decimals
      allowEmpty
      suffix="%"
      placeholder={bulk ? "VAT cả mục" : "0"}
      title={bulk ? "Nhập VAT % để áp cho tất cả dòng trong đầu mục này (vẫn sửa riêng từng dòng được)" : "Thuế suất VAT của thầu phụ"}
      onCommit={(v) => v !== ratePct && start(async () => {
        const r = await setSubVatAction(projectId, itemIds, v ?? 0);
        if (!r.ok) window.alert(r.error);
      })}
      className={bulk ? "w-full rounded border border-slate-400 bg-yellow-50 px-1 py-0.5 text-right text-xs font-normal" : inputCls}
    />
  );
}

// Ô % Prelim của 1 dòng thầu phụ, hoặc của cả đầu mục (bulk). Thành tiền = SL × đơn giá × (1 + %)
function PrelimCell({ projectId, itemIds, pct, bulk }: { projectId: string; itemIds: string[]; pct: number | null; bulk?: boolean }) {
  const [, start] = useTransition();
  if (itemIds.length === 0) return null;
  return (
    <NumInput
      value={pct}
      decimals
      allowEmpty
      suffix="%"
      placeholder={bulk ? "% cả mục" : "0"}
      title={bulk ? "Nhập % Prelim để áp cho tất cả dòng trong đầu mục này (vẫn sửa riêng từng dòng được)" : "% Prelim: thành tiền = SL × đơn giá × (1 + %)"}
      onCommit={(v) => v !== pct && start(async () => {
        const r = await setSubPrelimAction(projectId, itemIds, v ?? 0);
        if (!r.ok) window.alert(r.error);
      })}
      className={bulk ? "w-full rounded border border-slate-400 bg-yellow-50 px-1 py-0.5 text-right text-xs font-normal" : inputCls}
    />
  );
}

// Ô nhập tên thầu phụ ở dòng đầu mục: áp cho toàn bộ dòng bên dưới (vẫn sửa riêng từng dòng được)
function BulkContractor({ projectId, itemIds, value }: { projectId: string; itemIds: string[]; value: string }) {
  const [, start] = useTransition();
  return (
    <input
      key={value}
      defaultValue={value}
      disabled={itemIds.length === 0}
      placeholder="Thầu phụ cả mục…"
      title="Nhập tên thầu phụ để áp cho tất cả công tác trong đầu mục này (vẫn sửa riêng từng dòng được)"
      onBlur={(e) => e.currentTarget.value !== value && start(() => void setSubContractorBulkAction(projectId, itemIds, e.currentTarget.value))}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className="w-full rounded border border-slate-400 bg-yellow-50 px-1 py-0.5 text-xs font-normal"
    />
  );
}

export default function ThauPhuBoard({ projectId, sheet }: { projectId: string; sheet: SubSheet }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [, start] = useTransition();
  // thu gọn / mở rộng nhóm (đầu mục BOQ nhiều cấp + đầu mục lớn của phần bổ sung) giống Group của Excel
  const outline = useOutline(`tp-${projectId}`);
  // Cấp 1: "CÔNG TÁC CHÍNH" (công tác BOQ giao thầu phụ, các đầu mục A, B, C... của BOQ nằm trong) và cùng cấp với nó là
  // các đầu mục lớn tự thêm (VD Chi phí Prelim, Biện pháp thi công) - giống cách DT-CP thể hiện mục Thầu phụ
  const MAIN = "main";
  const boqHidden = outlineHidden(
    [{ headingId: MAIN, level: 0 }, ...sheet.boqRows.map((r) => (r.type === "heading" ? { headingId: r.id, level: r.depth + 1 } : {}))],
    outline.collapsed
  ).slice(1);
  const outlineHeads = [
    ...(sheet.boqRows.length ? [{ id: MAIN, level: 0 }] : []),
    ...sheet.boqRows.filter((r): r is SubHeadingRow => r.type === "heading").map((h) => ({ id: h.id, level: h.depth + 1 })),
    ...sheet.groups.map((g) => ({ id: `g:${g.id}`, level: 0 })),
  ];
  const boqTotal = sheet.boqRows.reduce((sum, r) => sum + (r.type === "item" ? r.amount : 0), 0);
  const boqFee = sheet.boqRows.reduce((sum, r) => sum + (r.type === "item" ? r.mgmtFee ?? 0 : 0), 0);
  const boqTotalVat = sheet.boqRows.reduce((sum, r) => sum + (r.type === "item" ? r.amountVat : 0), 0);
  const outlineLevels = outlineHeads.reduce((m, h) => Math.max(m, h.level + 1), 0);

  const allItems: SubItemRow[] = [
    ...sheet.boqRows.filter((r): r is SubItemRow => r.type === "item"),
    ...sheet.looseItems,
    ...sheet.groups.flatMap((g) => g.items),
  ];
  const itemById = new Map(allItems.map((i) => [i.id, i]));
  // Chi phí quản lý VT/TB (khai báo theo nhà thầu): cột riêng, chỉ hiện khi có. Cột "Thành tiền (trước VAT)" = SL × đơn giá
  // (amount đã gồm phí → trừ ra để hiện), thành tiền sau VAT = (thành tiền + phí) × (1 + VAT).
  const showFee = allItems.some((i) => !!i.mgmtFee);
  const N_COLS = showFee ? 12 : 11;
  const feeOf = (ids: string[]) => ids.reduce((s, id) => s + (itemById.get(id)?.mgmtFee ?? 0), 0);
  const feeCell = (v: number) => (showFee ? <td className={`${cell} text-right text-violet-700`}>{v ? fmt(v) : ""}</td> : null);
  // VAT % chung của các dòng (khác nhau → null)
  const commonVat = (ids: string[]): number | null => {
    const v = ids.map((i) => +(((itemById.get(i)?.vatRate ?? 0) * 100).toFixed(4)));
    return v.length && v.every((x) => x === v[0]) ? v[0] : null;
  };

  // % Prelim chung của các dòng (khác nhau → null)
  const commonPrelim = (ids: string[]): number | null => {
    const v = ids.map((i) => +((itemById.get(i)?.prelimPct ?? 0).toFixed(4)));
    return v.length && v.every((x) => x === v[0]) ? v[0] : null;
  };

  const renderItem = (it: SubItemRow, no: string, depth: number) => (
    <tr key={it.id} id={`sub-${it.id}`} className="scroll-mt-24 hover:bg-slate-50">
      <td className={`${cell} text-center text-slate-500`}>
        {it.linked ? (
          no
        ) : (
          <label className="flex items-center justify-center gap-1">
            <input type="checkbox" data-bulk="sub" value={it.id} className="h-3.5 w-3.5 cursor-pointer " />
            {no}
          </label>
        )}
      </td>
      <td className={cell} style={{ paddingLeft: 6 + depth * 14 }}>
        {it.linked ? (
          <div className="leading-tight text-slate-800">
            {it.name}
            <span className="ml-1 rounded bg-sky-100 px-1 text-[9px] text-sky-700">từ CHI TIẾT</span>
          </div>
        ) : (
          <EnterDown col="tp-name"><EditCell projectId={projectId} item={it} field="name" kind="ghost" /></EnterDown>
        )}
      </td>
      <td className={`${cell} text-center text-slate-600`}>{it.linked ? it.unit : <EnterDown col="tp-unit"><EditCell projectId={projectId} item={it} field="unit" kind="ghost" /></EnterDown>}</td>
      <td className={`${cell} text-right text-slate-700`}>{it.linked && !it.qtyEditable ? fmtQty(it.qty) : <EnterDown col="tp-quantity" pasteKey={`sub:${it.id}`} pasteField="quantity" projectId={projectId}><EditCell projectId={projectId} item={it} field="quantity" kind="num" /></EnterDown>}</td>
      <td className={cell}>
        <EnterDown col="tp-unitPrice" pasteKey={`sub:${it.id}`} pasteField="unitPrice" projectId={projectId}><EditCell projectId={projectId} item={it} field="unitPrice" kind="num" /></EnterDown>
        {it.quotedPct != null && (
          <div className="mt-0.5 text-right text-[10px] leading-none text-violet-700" title="Đơn giá đang tạm tính theo % giá báo CĐT — gõ / dán giá thầu phụ duyệt đè lên là nhãn tự mất">
            tạm tính {+it.quotedPct.toFixed(2)}% giá CĐT
          </div>
        )}
      </td>
      <td className={cell}>
        <EnterDown col="tp-prelim" pasteKey={`sub:${it.id}`} pasteField="prelim" projectId={projectId}><PrelimCell projectId={projectId} itemIds={[it.id]} pct={+it.prelimPct.toFixed(4)} /></EnterDown>
      </td>
      <td className={`${cell} text-right font-medium text-slate-900`}>{fmt(it.amount - (it.mgmtFee ?? 0))}</td>
      {feeCell(it.mgmtFee ?? 0)}
      <td className={cell}>
        <EnterDown col="tp-vat" pasteKey={`sub:${it.id}`} pasteField="vat" projectId={projectId}><VatCell projectId={projectId} itemIds={[it.id]} ratePct={+(it.vatRate * 100).toFixed(4)} /></EnterDown>
      </td>
      <td className={`${cell} text-right font-medium text-slate-900`}>{fmt(it.amountVat)}</td>
      <td className={cell}>
        <EnterDown col="tp-contractorName"><EditCell projectId={projectId} item={it} field="contractorName" kind="ghost" /></EnterDown>
      </td>
      <td className={cell}>
        <div className="flex items-center gap-1">
          <EnterDown col="tp-note"><EditCell projectId={projectId} item={it} field="note" kind="ghost" /></EnterDown>
        </div>
      </td>
    </tr>
  );

  const renderHeading = (h: SubHeadingRow) => (
    <tr key={`h-${h.id}`} className={headingClass(h.depth)}>
      <td className={`${cell} text-center`}>{h.stt}</td>
      <td className={`${cell} text-slate-900`} colSpan={4} style={{ paddingLeft: 6 + (h.depth + 1) * 14 }}>
        <OutlineToggle open={!outline.collapsed.has(h.id)} onClick={() => outline.toggle(h.id)} />
        {h.text}
      </td>
      <td className={cell}><PrelimCell projectId={projectId} itemIds={h.itemIds} pct={commonPrelim(h.itemIds)} bulk /></td>
      <td className={`${cell} text-right`}>{fmt(h.total - feeOf(h.itemIds))}</td>
      {feeCell(feeOf(h.itemIds))}
      <td className={cell}><VatCell projectId={projectId} itemIds={h.itemIds} ratePct={commonVat(h.itemIds)} bulk /></td>
      <td className={`${cell} text-right`}>{fmt(h.totalVat)}</td>
      <td className={cell}>
        <BulkContractor projectId={projectId} itemIds={h.itemIds} value={common(h.itemIds.map((i) => itemById.get(i)?.contractorName ?? ""))} />
      </td>
      <td className={`${cell} text-left`}>
        <QuotedPctButton projectId={projectId} itemIds={h.itemIds} title={`Tạm tính đơn giá thầu phụ các dòng thuộc "${h.text}" theo % giá đang báo CĐT`} />
      </td>
    </tr>
  );

  const renderGroup = (g: SubGroup, gi: number) => (
    <GroupBlock key={g.id} no={ROMAN[gi + (sheet.boqRows.length ? 1 : 0)] ?? String(gi + 2)} group={g} projectId={projectId} contractor={common(g.items.map((i) => i.contractorName))} open={!outline.collapsed.has(`g:${g.id}`)} onToggle={() => outline.toggle(`g:${g.id}`)} vat={commonVat(g.itemIds)} prelim={commonPrelim(g.itemIds)} showFee={showFee}>
      {g.items.length === 0 && (
        <tr>
          <td className={`${cell} py-2 text-center text-slate-400`} colSpan={N_COLS}>
            (Bấm &quot;+ công tác&quot; ở đầu mục để thêm)
          </td>
        </tr>
      )}
      {g.items.map((it, i) => renderItem(it, String(i + 1), 0))}
    </GroupBlock>
  );

  const hasBoq = sheet.boqRows.length > 0;
  const hasExtra = sheet.looseItems.length > 0 || sheet.groups.length > 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <ScrollToHash />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium text-slate-900">TH Thầu Phụ</h2>
        <div className="flex flex-wrap items-center gap-2">
          <QuoteImport
            projectId={projectId}
            targets={allItems.map((i) => ({ id: i.id, stt: i.stt, name: i.name, unit: i.unit, qty: i.qty, linked: i.linked, contractor: i.contractorName.trim(), price: i.unitPrice }))}
          />
          {adding ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newName.trim()) return;
                start(() => void addVtGroupAction(projectId, "B", newName, "TP"));
                setNewName("");
                setAdding(false);
              }}
            >
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="VD: KẾT CẤU, CHỐNG THẤM, MEP..." className="w-56 rounded border border-slate-300 px-2 py-1 text-xs" />
              <button className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white">Thêm</button>
              <button type="button" onClick={() => setAdding(false)} className="px-1 text-xs text-slate-500">
                Huỷ
              </button>
            </form>
          ) : (
            <button onClick={() => setAdding(true)} className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800">
              + Bổ Sung Đầu Mục Lớn
            </button>
          )}
          <button onClick={() => start(() => void addSubManualAction(projectId, null))} className="rounded border border-slate-400 px-3 py-1 text-xs font-medium hover:bg-slate-50">
            + Bổ sung công tác
          </button>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        Công tác chọn &quot;Thầu phụ&quot; ở sheet CHI TIẾT tự xuất hiện ở đây theo đúng đầu mục lớn/nhỏ của BOQ; chỉ cần nhập đơn giá và tên thầu phụ. Dùng &quot;Nhập báo giá từ Excel&quot; để điền đơn giá nhanh từ file báo giá của thầu phụ. Nút &quot;Thể hiện qua DT-CP&quot; ở đầu mục lớn tự bổ sung: bật để đầu mục hiện thành 1 dòng riêng bên sheet DT-CP, tắt để gộp chung vào dòng &quot;chưa phân nhóm&quot;.
      </p>

      {sheet.contractorGroups.length > 0 && (
        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2">
          <p className="mb-1.5 text-[11px] font-medium text-slate-600">
            Theo tên thầu phụ (phần công tác theo CHI TIẾT) — bật để nhà thầu đó hiện thành 1 dòng riêng bên sheet DT-CP, tắt để gộp chung vào &quot;chưa gán thầu phụ&quot;:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {sheet.contractorGroups.map((cg) => (
              <ContractorChip key={cg.name} projectId={projectId} cg={cg} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-2">
        <BulkDeleteBar projectId={projectId} kind="sub" noun="dòng bổ sung" />
        <div className="mb-1 flex items-center justify-end gap-3">
          <OutlineBar levels={outlineLevels} onLevel={(lv) => outline.setAll(collapseToLevel(outlineHeads, lv))} onExpandAll={() => outline.setAll([])} />
          <QuotedPctButton
            projectId={projectId}
            itemIds={sheet.boqRows.filter((r): r is SubItemRow => r.type === "item").map((r) => r.id)}
            label="Tạm tính giá thầu phụ theo % giá báo CĐT (cả sheet)"
          />
        </div>
        <TableResize tableId="rz-tp" storageKey="tp" />
      </div>
      <ScrollTable>
<table id="rz-tp" className="w-full table-fixed border-collapse text-xs">
        <colgroup>
          <col className="w-12" />
          <col />
          <col className="w-14" />
          <col className="w-24" />
          <col className="w-28" />
          <col className="w-20" />
          <col className="w-32" />
          {showFee && <col className="w-28" />}
          <col className="w-20" />
          <col className="w-32" />
          <col className="w-40" />
          <col className="w-52" />
        </colgroup>
        <thead className="bg-green-100 text-center text-slate-900">
          <tr>
            {["TT", "Hạng mục / Nội dung", "ĐVT", "SL", "Đơn Giá (trước VAT)", "% Prelim", "Thành Tiền (trước VAT)", ...(showFee ? ["Phí QL VT/TB"] : []), "VAT %", "Thành Tiền sau VAT", "Tên Thầu Phụ", "Ghi Chú"].map((t) => (
              <th key={t} className={`${cell} font-medium`}>
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hasBoq && (
            <tr className="bg-blue-100 font-bold text-red-700">
              <td className={`${cell} text-center`}>I</td>
              <td className={cell} colSpan={4}>
                <OutlineToggle open={!outline.collapsed.has(MAIN)} onClick={() => outline.toggle(MAIN)} />
                CÔNG TÁC CHÍNH <span className="text-[10px] font-normal text-slate-500">(công tác BOQ giao thầu phụ)</span>
              </td>
              <td className={cell} />
              <td className={`${cell} text-right`}>{fmt(boqTotal - boqFee)}</td>
              {feeCell(boqFee)}
              <td className={cell} />
              <td className={`${cell} text-right`}>{fmt(boqTotalVat)}</td>
              <td className={cell} colSpan={2} />
            </tr>
          )}
          {sheet.boqRows.map((r, i) => (boqHidden[i] ? null : r.type === "heading" ? renderHeading(r) : renderItem(r, r.stt, r.depth + 1)))}
          {sheet.groups.map((g, gi) => renderGroup(g, gi))}
          {sheet.looseItems.length > 0 && (
            <tr className="bg-slate-100 font-semibold text-slate-700">
              <td className={cell} />
              <td className={cell} colSpan={4}>
                Công tác bổ sung chưa thuộc đầu mục nào
              </td>
              <td className={cell} />
              <td className={`${cell} text-right`}>{fmt(sheet.looseItems.reduce((s, i) => s + i.amount - (i.mgmtFee ?? 0), 0))}</td>
              {feeCell(feeOf(sheet.looseItems.map((i) => i.id)))}
              <td className={cell} />
              <td className={`${cell} text-right`}>{fmt(sheet.looseItems.reduce((s, i) => s + i.amountVat, 0))}</td>
              <td className={cell} colSpan={2} />
            </tr>
          )}
          {sheet.looseItems.map((it, i) => renderItem(it, String(i + 1), 0))}
          {!hasBoq && !hasExtra && (
            <tr>
              <td className={`${cell} py-6 text-center text-slate-400`} colSpan={N_COLS}>
                Chưa có công tác thầu phụ. Chọn &quot;Thầu phụ&quot; ở sheet CHI TIẾT (từng công tác hoặc cả đầu mục), hoặc bấm &quot;+ Bổ sung công tác&quot;.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="bg-slate-100 font-semibold text-slate-900">
            <td className={cell} colSpan={5}>
              Tổng cộng
            </td>
            <td className={cell} />
            <td className={`${cell} text-right`}>{fmt(sheet.total - feeOf(allItems.map((i) => i.id)))}</td>
            {feeCell(feeOf(allItems.map((i) => i.id)))}
            <td className={cell} />
            <td className={`${cell} text-right`}>{fmt(sheet.totalVat)}</td>
            <td className={cell} colSpan={2} />
          </tr>
        </tfoot>
      </table>
</ScrollTable>
    </div>
  );
}

function GroupBlock({
  no,
  group,
  projectId,
  contractor,
  open,
  onToggle,
  vat,
  prelim,
  showFee,
  children,
}: {
  vat: number | null;
  prelim: number | null;
  showFee: boolean;
  no: string;
  group: SubGroup;
  projectId: string;
  contractor: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const [, start] = useTransition();
  return (
    <>
      <tr className="bg-blue-100 font-bold text-red-700">
        <td className={`${cell} text-center`}>{no}</td>
        <td className={cell} colSpan={4}>
          <div className="flex items-center gap-1">
            <OutlineToggle open={open} onClick={onToggle} />
            <input
              key={group.name}
              defaultValue={group.name}
              onBlur={(e) => e.currentTarget.value !== group.name && start(() => void renameVtGroupAction(projectId, group.id, e.currentTarget.value))}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              className="w-full rounded border border-transparent bg-transparent px-1 font-semibold uppercase hover:border-slate-300 focus:border-blue-400 focus:bg-white"
            />
            <button
              title="Thêm công tác vào đầu mục này"
              onClick={() => start(() => void addSubManualAction(projectId, group.id))}
              className="shrink-0 rounded bg-slate-900 px-1.5 text-[10px] font-medium text-white"
            >
              + công tác
            </button>
          </div>
        </td>
        <td className={cell}>
          <PrelimCell projectId={projectId} itemIds={group.itemIds} pct={prelim} bulk />
        </td>
        <td className={`${cell} text-right`}>{fmt(group.total)}</td>
        {showFee && <td className={cell} />}
        <td className={cell}>
          <VatCell projectId={projectId} itemIds={group.itemIds} ratePct={vat} bulk />
        </td>
        <td className={`${cell} text-right`}>{fmt(group.totalVat)}</td>
        <td className={cell}>
          <BulkContractor projectId={projectId} itemIds={group.itemIds} value={contractor} />
        </td>
        <td className={`${cell} text-center`}>
          <div className="flex items-center justify-center gap-1">
            <DtcpToggleButton projectId={projectId} groupId={group.id} on={group.showInDtcp} />
            <button
              title="Xoá đầu mục (các dòng bên trong quay về mục bổ sung chung)"
              onClick={async () => await confirmNear(`⚠ Bạn có chắc chắn muốn XOÁ đầu mục lớn "${group.name}" không?\n\nCác dòng bên trong sẽ không bị mất, chỉ quay về phần bổ sung chung.`) && start(() => void deleteVtGroupAction(projectId, group.id))}
              className="rounded px-1.5 text-base leading-none text-red-500 hover:bg-red-100"
            >
              ×
            </button>
          </div>
        </td>
      </tr>
      {open && children}
    </>
  );
}

function ContractorChip({ projectId, cg }: { projectId: string; cg: ContractorGroup }) {
  return (
    <div className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2 py-1 text-[11px]">
      <span className="font-medium text-slate-800">{cg.name}</span>
      <span className="text-slate-500">{fmt(cg.total)}</span>
      <ToggleButton
        on={cg.showInDtcp}
        onToggle={(next) => void setSubcontractorNameShowInDtcpAction(projectId, cg.name, next)}
        title='Bật: nhà thầu phụ này hiện thành 1 dòng riêng ở sheet DT-CP (dưới "Thầu phụ theo CHI TIẾT"). Tắt: gộp chung vào "chưa gán thầu phụ".'
      />
    </div>
  );
}
