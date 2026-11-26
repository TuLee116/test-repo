"use client";

import { useState, useTransition } from "react";
import NumInput from "@/app/(app)/NumInput";
import TableResize from "@/app/(app)/TableResize";
import BulkDeleteBar from "./BulkDeleteBar";
import ScrollTable from "./ScrollTable";
import type { DtcpRow } from "@/lib/dtcp";
import { DTCP_HEAD_ROW, dtcpExtraColLetter, dtcpLayout } from "@/lib/dtcp-layout";
import { linkKeysOf, type GridSourceOption } from "@/lib/grid-sources-shared";
import LinkPicker from "./LinkPicker";
import {
  addDtcpColumnAction,
  addDtcpLineAction,
  deleteDtcpColumnAction,
  moveDtcpLineAction,
  renameDtcpColumnAction,
  setDtcpCellAction,
  setDtcpFormulaAction,
  resetDtcpAutoLineAction,
  updateDtcpLineAction,
  updateVatRateAction,
} from "@/lib/actions";
import { confirmNear } from "@/app/(app)/confirm-near";

type Column = { id: string; title: string };

const fmt = (n: number) => (n ? Math.round(n).toLocaleString("vi-VN") : "");
const pct = (n: number, base: number) => (base && n ? `${((n / base) * 100).toFixed(1).replace(".", ",")}%` : "");
// Dòng do hệ thống tự đồng bộ từ đầu mục lớn ở sheet TH Vật Tư/Nhân Công/Thiết Bị/Thầu Phụ (đã bật
// "Thể hiện qua DT-CP"): không cho đổi liên kết thủ công nữa để tránh tách khỏi cơ chế đồng bộ.
const isAutoSynced = (linkSource: string) => /^(vt|nt|tb|tp)[gu]:|^tpc:|^gridh:/.test(linkSource);

type Active = { addr: string; formula: string; value: number; err: string; typing: string | null } | null;

// Ô tiền: gõ số, hoặc gõ công thức bắt đầu bằng = (VD =D20*5%, =LINK("vl")*2%) — công thức được lưu lại và tính lại khi dữ liệu nguồn đổi
function MoneyInput({
  value,
  onSave,
  onFormula,
  formula = "",
  err = "",
  addr,
  setActive,
  disabled,
}: {
  value: number;
  onSave: (v: number) => void;
  onFormula: (f: string) => void;
  formula?: string;
  err?: string;
  addr: string;
  setActive: React.Dispatch<React.SetStateAction<Active>>;
  disabled?: boolean;
}) {
  return (
    <NumInput
      value={value}
      disabled={disabled}
      allowFormula
      formula={formula}
      formulaAddr={addr}
      onCommitFormula={onFormula}
      onCommit={(v) => onSave(v ?? 0)}
      onActiveChange={(on) => setActive((a) => (on ? { addr, formula, value, err, typing: null } : a && a.addr === addr ? null : a))}
      onTyping={(t) => setActive((a) => (a && a.addr === addr ? { ...a, typing: t } : a))}
      title={err ? `Lỗi công thức: ${err}` : formula ? `${addr}: ${formula}` : addr}
      className={`w-full rounded border bg-transparent px-1 py-0.5 text-right hover:border-slate-300 focus:border-blue-400 focus:bg-white ${err ? "border-red-400 text-red-600" : formula ? "border-transparent text-blue-800" : "border-transparent"}`}
    />
  );
}

export default function DtcpTable({
  projectId,
  rows,
  columns,
  totalA,
  totalB,
  vatRate,
  extraLinkOptions = [],
  linkOptions = [],
  linkValues = {},
}: {
  projectId: string;
  rows: DtcpRow[];
  columns: Column[];
  totalA: number;
  totalB: number;
  vatRate: number;
  extraLinkOptions?: { value: string; label: string }[];
  linkOptions?: GridSourceOption[]; // nguồn chọn cho công thức LINK("khoá")
  linkValues?: Record<string, number>;
}) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>) => start(() => void fn());
  const colSum = (section: "A" | "B", colId: string) =>
    rows.filter((r) => r.section === section && r.depth === 0).reduce((s, r) => s + (r.cells[colId] ?? 0), 0);
  const beforeVat = totalA / (1 + vatRate);
  const span = 4 + columns.length + 2;
  const lay = dtcpLayout(rows);
  const rn = "w-10 select-none border border-slate-300 bg-slate-50 px-1 text-center text-[11px] text-slate-400";
  const [active, setActive] = useState<Active>(null);
  const labelOfLink = new Map(linkOptions.map((o) => [o.value, o.label]));
  // chèn LINK("khoá") vào ô tiền đang được chọn (con trỏ vẫn nằm trong ô vì nút liên kết không lấy focus)
  function insertLink(key: string) {
    const el = document.activeElement;
    if (!(el instanceof HTMLInputElement) || !el.hasAttribute("data-fcell")) {
      window.alert("Bấm vào ô tiền cần tính (cột Thành tiền hoặc cột bổ sung) trước, rồi mới chọn nguồn liên kết.");
      return;
    }
    const tok = `LINK("${key}")`;
    const cur = el.value;
    const startsF = cur.startsWith("=");
    const from = startsF ? (el.selectionStart ?? cur.length) : 1;
    const to = startsF ? (el.selectionEnd ?? from) : 1;
    const base = startsF ? cur : "=";
    const next = base.slice(0, from) + tok + base.slice(to);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, next);
    el.setSelectionRange(from + tok.length, from + tok.length);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const barText = active ? (active.typing ?? (active.formula || (active.value ? String(Math.round(active.value * 100) / 100) : ""))) : "";

  // Kéo thả 1 dòng vào làm con của dòng khác (hoặc thả vào thanh section = về gốc của section đó) -
  // dòng cha tự cộng thêm giá trị dòng này vào tổng (dòng có con luôn = tổng các con).
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const dropProps = (key: string, targetParentId: string | null, targetSection: "A" | "B") => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragId || dragId === targetParentId) return;
      e.preventDefault();
      e.stopPropagation();
      if (over !== key) setOver(key);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setOver(null);
      const id = dragId;
      setDragId(null);
      if (id) run(() => moveDtcpLineAction(projectId, id, targetParentId, targetSection));
    },
  });

  const renderSection = (section: "A" | "B", title: string, total: number) => (
    <>
      <tr
        {...dropProps(`sec:${section}`, null, section)}
        className={`bg-blue-100 font-bold text-red-600 ${over === `sec:${section}` ? "outline outline-2 outline-blue-500" : ""}`}
      >
        <td className="border border-slate-400" />
        <td className="border border-slate-400 px-2 py-1.5 text-center">{section}</td>
        <td className="border border-slate-400 px-2 py-1.5 text-center">{title}</td>
        <td className="border border-slate-400" />
        <td className="border border-slate-400 px-2 py-1.5 text-right">{fmt(total)}</td>
        <td className="border border-slate-400 px-2 py-1.5 text-right">{section === "B" ? pct(total, totalA) : ""}</td>
        {columns.map((c) => (
          <td key={c.id} className="border border-slate-400 px-2 py-1.5 text-right">
            {fmt(colSum(section, c.id))}
          </td>
        ))}
        <td className="border border-slate-400" />
        <td className="border border-slate-400 text-center">
          <button
            title="Thêm dòng cấp 1"
            onClick={() => run(() => addDtcpLineAction(projectId, section, null))}
            className="rounded px-1.5 text-lg leading-none text-blue-700 hover:bg-blue-200"
          >
            +
          </button>
        </td>
        <td className="border border-slate-400" />
      </tr>
      {rows
        .filter((r) => r.section === section)
        .map((r) => (
          <tr
            key={r.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", r.id);
              setDragId(r.id);
            }}
            onDragEnd={() => {
              setDragId(null);
              setOver(null);
            }}
            {...dropProps(`row:${r.id}`, r.id, section)}
            className={`cursor-grab ${r.isLeaf ? "" : "bg-slate-50"} ${dragId === r.id ? "opacity-40" : ""} ${over === `row:${r.id}` ? "outline outline-2 outline-blue-500" : ""}`}
          >
            <td className="border border-slate-300 px-1 py-1 text-center">
              <input type="checkbox" data-bulk="dtcp" data-depth={r.depth} value={r.id} className="h-3.5 w-3.5 cursor-pointer" />
            </td>
            <td className={`border border-slate-300 px-2 py-1 text-center ${r.depth <= 1 ? "font-bold" : "italic text-slate-600"}`}>
              {r.code}
            </td>
            <td className="border border-slate-300 py-0.5" style={{ paddingLeft: 6 + r.depth * 16 }}>
              <div className="flex items-center gap-1">
                <input
                  key={r.name}
                  defaultValue={r.name}
                  onBlur={(e) => e.currentTarget.value !== r.name && run(() => updateDtcpLineAction(projectId, r.id, { name: e.currentTarget.value }))}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  className={`w-full rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-slate-300 focus:border-blue-400 focus:bg-white ${
                    r.depth <= 1 ? "font-bold" : "italic"
                  }`}
                />
              </div>
            </td>
            <td className="border border-slate-300 px-1 text-center text-xs font-semibold">
              <input
                key={r.unit}
                defaultValue={r.unit}
                onBlur={(e) => e.currentTarget.value !== r.unit && run(() => updateDtcpLineAction(projectId, r.id, { unit: e.currentTarget.value }))}
                className="w-14 rounded border border-transparent bg-transparent px-1 text-center hover:border-slate-300 focus:border-blue-400 focus:bg-white"
              />
            </td>
            <td className={`border border-slate-300 px-1 text-right ${r.depth <= 1 ? "font-bold" : ""}`}>
              {r.isLeaf ? (
                <div className="flex items-center justify-end gap-1">
                  <div className="w-36">
                    <MoneyInput
                      value={r.formula || r.linkSource ? r.amount : r.manualAmount}
                      formula={r.formula}
                      err={r.amountErr}
                      addr={`D${r.exRow}`}
                      setActive={setActive}
                      onFormula={(f) => run(() => setDtcpFormulaAction(projectId, r.id, null, f))}
                      onSave={(v) => run(() => (r.linkSource ? setDtcpFormulaAction(projectId, r.id, null, `=${v}`) : updateDtcpLineAction(projectId, r.id, { manualAmount: v })))}
                    />
                  </div>
                </div>
              ) : (
                <span className="px-1">{fmt(r.amount)}</span>
              )}
            </td>
            <td className="border border-slate-300 px-2 text-right">{section === "B" ? pct(r.amount, totalA) : ""}</td>
            {columns.map((c) => (
              <td key={c.id} className="border border-slate-300 px-1 text-right">
                {r.isLeaf ? (
                  <MoneyInput
                    value={r.cells[c.id] ?? 0}
                    formula={r.cellFormulas[c.id] ?? ""}
                    err={r.cellErrs[c.id] ?? ""}
                    addr={`${dtcpExtraColLetter(columns.findIndex((x) => x.id === c.id))}${r.exRow}`}
                    setActive={setActive}
                    onFormula={(f) => run(() => setDtcpFormulaAction(projectId, r.id, c.id, f))}
                    onSave={(v) => run(() => setDtcpCellAction(projectId, r.id, c.id, v))}
                  />
                ) : (
                  <span className="px-1 font-semibold">{fmt(r.cells[c.id] ?? 0)}</span>
                )}
              </td>
            ))}
            <td className="border border-slate-300 px-1">
              <input
                key={r.note}
                defaultValue={r.note}
                onBlur={(e) => e.currentTarget.value !== r.note && run(() => updateDtcpLineAction(projectId, r.id, { note: e.currentTarget.value }))}
                className="w-full rounded border border-transparent bg-transparent px-1 text-xs hover:border-slate-300 focus:border-blue-400 focus:bg-white"
              />
            </td>
            <td className="whitespace-nowrap border border-slate-300 px-1 text-center">
              <button
                title="Thêm dòng con"
                onClick={() => run(() => addDtcpLineAction(projectId, section, r.id))}
                className="rounded px-1 text-base leading-none text-blue-700 hover:bg-blue-100"
              >
                +
              </button>
            </td>
            <td className="whitespace-nowrap border border-slate-300 px-1.5 text-center text-[11px]">
              {r.isLeaf && r.linkSource ? (
                r.formula ? (
                  <span className="inline-flex items-center gap-1">
                    <span title="Số tiền đang do anh gõ / công thức đè lên, không tự lấy từ sheet nguồn nữa" className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">Đã sửa tay</span>
                    <button title="Bỏ công thức, lấy số tự động từ sheet nguồn như cũ" onClick={() => run(() => resetDtcpAutoLineAction(projectId, r.id))} className="text-blue-700 underline">
                      Về tự động
                    </button>
                  </span>
                ) : (
                  <span title='Tự động lấy từ đầu mục ở sheet nguồn (bật/tắt bằng nút "Thể hiện qua DT-CP" ở sheet đó). Gõ công thức vào ô Thành tiền để đè lên.' className="rounded bg-blue-100 px-1.5 py-0.5 font-medium text-blue-700">
                    {isAutoSynced(r.linkSource) ? "Tự động" : "Liên kết"}
                  </span>
                )
              ) : null}
            </td>
          </tr>
        ))}
    </>
  );

  return (
    <div className={pending ? "opacity-70" : ""}>
      <BulkDeleteBar projectId={projectId} kind="dtcp" noun="dòng" />
      <div className="mb-2 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm">
        <span className="w-20 rounded border border-slate-300 bg-slate-50 px-2 py-1 text-center text-[13px] font-medium text-slate-700">{active?.addr ?? ""}</span>
        <span className="select-none px-1 text-[13px] italic text-slate-400" title="Công thức / nội dung của ô">
          fx
        </span>
        <input
          readOnly
          value={barText}
          placeholder="Bấm vào một ô tiền để xem / gõ công thức (VD =LINK(...)*2%)"
          className="min-w-0 flex-1 rounded border border-slate-300 bg-slate-50 px-2 py-1 font-mono text-[13px] text-slate-800"
        />
        <LinkPicker options={linkOptions} values={linkValues} onPick={insertLink} />
      </div>
      {(() => {
        const keys = [...new Set(linkKeysOf(barText))];
        if (!keys.length && !active?.err) return null;
        return (
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-0.5 rounded-md border border-blue-100 bg-blue-50/50 px-3 py-1 text-[11px] text-slate-600">
            {active?.err && <span className="font-semibold text-red-600">Lỗi công thức: {active.err}</span>}
            {keys.map((k) => (
              <span key={k}>
                <b className="font-mono text-blue-700">{`LINK("${k.length > 14 ? k.slice(0, 14) + "…" : k}")`}</b> = {labelOfLink.get(k) ?? "(nguồn không tồn tại)"}:{" "}
                <span className="font-mono">{k in linkValues ? Math.round(linkValues[k]).toLocaleString("vi-VN") : "#NAME?"}</span>
              </span>
            ))}
          </div>
        );
      })()}
      <TableResize tableId="rz-dtcp" storageKey="dtcp" />
      <ScrollTable>
<table id="rz-dtcp" className="w-full min-w-[900px] border-collapse border border-slate-400 text-sm">
        <thead>
          <tr className="bg-green-100 text-center">
            <th rowSpan={2} className="w-8 border border-slate-400 px-1" title="Chọn dòng" />
            <th rowSpan={2} className="w-14 border border-slate-400 px-2">STT</th>
            <th rowSpan={2} className="border border-slate-400 px-2">Nội dung công việc</th>
            <th rowSpan={2} className="w-20 border border-slate-400 px-2">Đơn vị</th>
            <th colSpan={2 + columns.length} className="border border-slate-400 px-2 py-1">TMN</th>
            <th rowSpan={2} className="w-48 border border-slate-400 px-2">
              <div className="flex items-center justify-center gap-2">
                <button
                  title="Thêm cột so sánh (VD: giá CĐT đề xuất)"
                  onClick={() => {
                    const t = prompt("Tên cột mới (VD: Giá CĐT đề xuất):");
                    if (t !== null) run(() => addDtcpColumnAction(projectId, t));
                  }}
                  className="rounded bg-white px-1.5 text-xs font-semibold text-blue-700 shadow-sm hover:bg-blue-50"
                >
                  + Cột
                </button>
                Ghi chú
              </div>
            </th>
            <th rowSpan={2} className="w-16 border border-slate-400" />
            <th rowSpan={2} className="w-28 border border-slate-400 px-2 text-xs">Trạng thái</th>
          </tr>
          <tr className="bg-green-100 text-center">
            <th className="w-56 border border-slate-400 px-2 py-1">Thành tiền</th>
            <th className="w-20 border border-slate-400 px-2 py-1">% so với DT</th>
            {columns.map((c) => (
              <th key={c.id} className="min-w-36 border border-slate-400 px-1 py-1">
                <div className="flex items-center gap-1">
                  <input
                    key={c.title}
                    defaultValue={c.title}
                    onBlur={(e) => e.currentTarget.value !== c.title && run(() => renameDtcpColumnAction(projectId, c.id, e.currentTarget.value))}
                    className="w-full rounded border border-transparent bg-transparent px-1 text-center font-bold hover:border-slate-500 focus:bg-white"
                  />
                  <button
                    title="Xoá cột"
                    onClick={async () => await confirmNear(`⚠ Bạn có chắc chắn muốn XOÁ cột "${c.title}" cùng toàn bộ số liệu trong cột không?`) && run(() => deleteDtcpColumnAction(projectId, c.id))}
                    className="text-red-600"
                  >
                    ×
                  </button>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {renderSection("A", "DOANH THU", totalA)}
          <tr className="text-slate-700">
            <td className="border border-slate-300" />
            <td className="border border-slate-300" />
            <td className="border border-slate-300 px-2 py-1 pl-6 font-semibold">
              VAT{" "}
              <NumInput
                value={+(vatRate * 100).toFixed(4)}
                decimals
                suffix="%"
                title="Thuế suất VAT (%)"
                onCommit={(v) => run(() => updateVatRateAction(projectId, v ?? 0))}
                className="w-16 rounded border border-slate-300 px-1 text-right"
              />
            </td>
            <td className="border border-slate-300" />
            <td className="border border-slate-300 px-2 text-right font-semibold">{fmt(totalA - beforeVat)}</td>
            {Array.from({ length: columns.length + 4 }, (_, i) => (
              <td key={i} className="border border-slate-300" />
            ))}
          </tr>
          <tr className="text-blue-700">
            <td className="border border-slate-300" />
            <td className="border border-slate-300" />
            <td className="border border-slate-300 px-2 py-1 pl-6 font-semibold">Giá trị trước VAT</td>
            <td className="border border-slate-300" />
            <td className="border border-slate-300 px-2 text-right font-semibold">{fmt(beforeVat)}</td>
            {Array.from({ length: columns.length + 4 }, (_, i) => (
              <td key={i} className="border border-slate-300" />
            ))}
          </tr>
          {renderSection("B", "CHI PHÍ", totalB)}
        </tbody>
      </table>
</ScrollTable>
      <p className="mt-2 text-xs text-slate-500">
        Nút nhỏ bên trái số tiền: chọn liên kết giá trị từ sheet khác (hoặc để &quot;Nhập tay&quot;). Có thể gõ công thức như Excel vào ô Thành tiền / cột bổ sung (bắt đầu bằng =, tham chiếu ô theo địa chỉ ghi ở đầu cột và đầu dòng, VD =D20*5%) hoặc bấm 🔗 Liên kết sheet để lấy số từ BOQ, TH... Dòng có dòng con tự động bằng tổng các dòng con. Dấu + thêm dòng con, × xoá dòng. Kéo thả 1 dòng (giữ chuột trái) rồi thả vào dòng khác (hoặc vào thanh DOANH THU/CHI PHÍ) để chuyển dòng đó thành con của dòng vừa thả vào — hạng mục cha sẽ tự cộng thêm giá trị.
      </p>
    </div>
  );
}
