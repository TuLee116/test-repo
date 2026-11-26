"use client";

import { useRef, useState, useTransition } from "react";
import {
  addManualItemAction,
  addVtGroupAction,
  createTransportLinesAction,
  deleteManualItemsAction,
  moveManualItemsAction,
  deleteVtGroupAction,
  moveManualItemAction,
  moveVtResourcesAction,
  renameProjectLaborAction,
  renameVtGroupAction,
  setProjectResourcePriceAction,
  setFieldFormulaAction,
  setVtGroupVatAction,
  setVtGroupWastageAction,
  setVtResourceNoteAction,
  updateManualItemAction,
} from "@/lib/actions";
import { setCrewMgmtPctAction, setThVatAction } from "@/lib/actions";
import { SHEET_CFG, vatOnTop, type SheetGroup, type SheetKind, type SheetRow } from "@/lib/tonghop-shared";
import WastageCell from "./WastageCell";
import NumInput from "@/app/(app)/NumInput";
import EnterDown from "@/app/(app)/EnterDown";
import { collapseToLevel, OutlineBar, OutlineToggle, useOutline } from "@/app/(app)/outline";
import { pasteSheetColumn } from "./paste-sheet";
import { FormulaNum } from "./LinkBar";
import TableResize from "@/app/(app)/TableResize";
import DtcpToggleButton from "./DtcpToggleButton";
import ScrollTable from "./ScrollTable";
import { confirmNear } from "@/app/(app)/confirm-near";
import { fmtQty } from "@/lib/fmt-qty";
import EquipCalcDialog, { type EquipCalcRow } from "./EquipCalcDialog";
import type { EquipItemRow } from "@/lib/equip";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"];
const fmt = (n: number) => (n ? Math.round(n).toLocaleString("vi-VN") : "");
const cell = "border border-slate-200 px-1.5 py-1";
const inputCls = "w-full rounded border border-slate-300 px-1 py-0.5 text-right";
const ghost = "w-full rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-slate-300 focus:border-blue-400 focus:bg-white";

function common(values: (number | null)[]): number | null {
  if (values.length === 0) return null;
  const first = values[0];
  return values.every((v) => v === first) ? first : null;
}

// ---- TH Thiết Bị: ô VAT % (cộng thêm vào thành tiền - DT-CP lấy sau VAT) của 1 dòng ----
const vatKey = (r: SheetRow) => `${r.manual ? "man" : "res"}:${r.resourceId}`;
function VatTopCell({ projectId, row }: { projectId: string; row: SheetRow }) {
  const [, start] = useTransition();
  return (
    <NumInput
      value={+row.vatPercent.toFixed(4)}
      decimals
      suffix="%"
      onCommit={(v) => (v ?? 0) !== +row.vatPercent.toFixed(4) && start(async () => {
        const r = await setThVatAction(projectId, [{ key: vatKey(row), price: row.priceAfterVat }], v ?? 0);
        if (!r.ok) window.alert(r.error);
      })}
      className={inputCls}
    />
  );
}

// ---- TH Nhân Công: ô % quản lý của đội thi công (thành tiền = KL × đơn giá × (1 + %)) ----
function CrewPctCell({ projectId, row }: { projectId: string; row: SheetRow }) {
  const [, start] = useTransition();
  const cur = +(row.mgmtPct ?? 0).toFixed(4);
  return (
    <NumInput
      value={cur || null}
      allowEmpty
      decimals
      suffix="%"
      title="% quản lý của đội thi công: thành tiền = khối lượng × đơn giá × (1 + % quản lý)"
      onCommit={(v) => (v ?? 0) !== cur && start(async () => {
        const r = await setCrewMgmtPctAction(projectId, [row.resourceId], v ?? 0);
        if (!r.ok) window.alert(r.error);
      })}
      className={inputCls}
    />
  );
}

// ---- Ô đơn giá (+VAT với vật tư) của tài nguyên lấy từ CHI TIẾT ----
function PriceCells({ projectId, row, showVat }: { projectId: string; row: SheetRow; showVat: boolean }) {
  const [p, setP] = useState(row.priceAfterVat);
  const [v, setV] = useState(row.vatPercent);
  const [, start] = useTransition();
  const save = (price: number, vatPct: number) => {
    if (Math.round(price) === Math.round(row.priceAfterVat) && Math.abs(vatPct - row.vatPercent) < 1e-9) return;
    start(() => void setProjectResourcePriceAction(projectId, row.resourceId, price, vatPct / 100, !!row.priceFormula && Math.round(price) === Math.round(row.priceAfterVat)));
  };
  return (
    <>
      <td className={cell}>
        <EnterDown col="th-price" pasteKey={`res:${row.resourceId}`} pasteField="unitPrice" projectId={projectId}>
          <FormulaNum value={row.priceAfterVat} formula={row.priceFormula} err={row.priceErr} onFormula={(f) => start(() => void setFieldFormulaAction(projectId, "price", row.resourceId, "unitPrice", f))} onCommit={(x) => save(x ?? 0, v)} onMultiPaste={(lines) => pasteSheetColumn(projectId, "unitPrice", lines, start)} className={inputCls} />
        </EnterDown>
      </td>
      {showVat && (
        <>
          <td className={cell}>
            <EnterDown col="th-vat" pasteKey={`res:${row.resourceId}`} pasteField="vat" projectId={projectId}>
              <NumInput value={+row.vatPercent.toFixed(4)} decimals suffix="%" onLive={setV} onCommit={(x) => save(p, x ?? 0)} className={inputCls} />
            </EnterDown>
          </td>
          <td className={`${cell} text-right text-slate-600`}>{fmt(p / (1 + v / 100))}</td>
        </>
      )}
    </>
  );
}

function NoteCell({ projectId, row, kind }: { projectId: string; row: SheetRow; kind: SheetKind }) {
  const [, start] = useTransition();
  return (
    <input
      key={row.note}
      defaultValue={row.note}
      onBlur={(e) => {
        if (e.currentTarget.value === row.note) return;
        const val = e.currentTarget.value;
        start(() => void (row.manual ? updateManualItemAction(projectId, row.resourceId, { note: val }) : setVtResourceNoteAction(projectId, row.resourceId, val, kind)));
      }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className={ghost}
    />
  );
}

// TH Thiết Bị: ô thời gian thuê (ngày) của dòng tự thêm - có số ngày thì thành tiền = SL × đơn giá (đ/ngày) × số ngày
function DaysCell({ projectId, row }: { projectId: string; row: SheetRow }) {
  const [, start] = useTransition();
  return (
    <NumInput
      value={row.days ?? null}
      allowEmpty
      placeholder=""
      title="Thời gian thuê (ngày): có số ngày thì đơn giá tính theo đ/ngày. Dòng từ Tính toán thiết bị: sửa ở đây sẽ lưu luôn vào bản tính."
      onCommit={(v) => (v ?? null) !== (row.days ?? null) && start(() => void updateManualItemAction(projectId, row.resourceId, { days: v }))}
      className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-right hover:border-slate-300 focus:border-blue-400 focus:bg-white"
    />
  );
}

// Ô văn bản / số của dòng tự thêm
function ManualField({ projectId, row, field, align }: { projectId: string; row: SheetRow; field: "name" | "unit" | "quantity" | "unitPrice"; align?: "right" | "center" }) {
  const [, start] = useTransition();
  const cur = field === "name" ? row.name : field === "unit" ? row.unit : field === "quantity" ? row.qty : row.priceAfterVat;
  if (field === "quantity" || field === "unitPrice") {
    return (
      <FormulaNum
        value={cur as number}
        decimals
        qty={field === "quantity"}
        money={field === "unitPrice"}
        formula={field === "quantity" ? row.qtyFormula : row.priceFormula}
        err={field === "quantity" ? row.qtyErr : row.priceErr}
        onFormula={(f) => start(() => void setFieldFormulaAction(projectId, "manual", row.resourceId, field, f))}
        onCommit={(v) => start(() => void updateManualItemAction(projectId, row.resourceId, { [field]: v ?? 0 }))}
        onMultiPaste={(lines) => pasteSheetColumn(projectId, field, lines, start)}
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
        start(() => void updateManualItemAction(projectId, row.resourceId, { [field]: val }));
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.currentTarget.blur();
      }}
      className={`${ghost} ${align === "center" ? "text-center" : ""} field-sizing-content block resize-none leading-tight`}
    />
  );
}

// Tên nhân công theo công việc BOQ: sửa được ngay tại đây (áp cho mọi dòng BOQ đang dùng). Đặt trùng
// tên với 1 dòng khác (cùng ĐVT) = gộp 2 dòng làm 1.
function LaborNameField({ projectId, row }: { projectId: string; row: SheetRow }) {
  const [pending, start] = useTransition();
  return (
    <div>
      <textarea
        key={row.name}
        defaultValue={row.name}
        rows={1}
        disabled={pending}
        title="Sửa tên nhân công (áp cho mọi dòng BOQ đang dùng). Đặt trùng tên với dòng khác cùng ĐVT để gộp 2 dòng làm 1."
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            e.currentTarget.value = row.name;
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => {
          const v = e.currentTarget.value.trim();
          if (!v || v === row.name) {
            e.currentTarget.value = row.name;
            return;
          }
          start(async () => {
            const res = await renameProjectLaborAction(projectId, row.resourceId, v);
            if (res.merged) alert(`Đã gộp vào dòng nhân công "${v}" có sẵn (đơn giá theo dòng đó).`);
          });
        }}
        className="field-sizing-content w-full resize-none rounded border border-transparent bg-transparent px-0.5 leading-tight text-slate-800 hover:border-slate-300 focus:border-blue-400 focus:bg-white focus:outline-none"
      />
      {row.usedBy && <div className="text-[10px] text-slate-400" title="Các dòng BOQ (STT) đang dùng nhân công này">BOQ: {row.usedBy}</div>}
    </div>
  );
}

export default function TongHopBoard({
  projectId,
  kind,
  rows: allRows,
  groups,
  equip,
}: {
  projectId: string;
  kind: SheetKind;
  rows: SheetRow[];
  groups: SheetGroup[];
  equip?: { calcs: EquipCalcRow[]; items: EquipItemRow[] }; // TH Thiết Bị: nút "Tính toán thiết bị"
}) {
  const cfg = SHEET_CFG[kind];
  const showVat = kind === "VT";
  const showWaste = kind === "VT"; // nhân công / thiết bị không có hao hụt
  const daysCol = kind === "TB"; // TH Thiết Bị: cột thời gian thuê (ngày)
  const canAddManualKind = kind === "NC" || kind === "TB";
  const vatTop = vatOnTop(kind); // TH Thiết Bị: thêm cột VAT % + Thành tiền sau VAT
  const crewTop = kind === "NC"; // TH Nhân Công: cột "% quản lý" trước Thành tiền
  const nCols = (showVat ? 11 : 8) + (vatTop ? 2 : 0) + (crewTop ? 1 : 0) + (daysCol ? 1 : 0);
  const extraCols = vatTop ? 2 : 0; // số cột nằm SAU cột Thành tiền (dòng tổng mục A/B, Tổng cộng)
  const sumVat = (list: SheetRow[]) => list.reduce((s, r) => s + r.amountVat, 0);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSection, setNewSection] = useState<"A" | "B">(cfg.defaultSection);
  const [pending, start] = useTransition();
  // Chọn nhiều dòng để chuyển tới / xoá cùng lúc (Shift + bấm = chọn cả đoạn)
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState("");
  const [transportPct, setTransportPct] = useState(100); // % khối lượng vật tư tính vận chuyển
  const lastPick = useRef<string | null>(null);
  // Dòng không còn khối lượng (công tác đã giao thầu phụ 100%, khối lượng BOQ = 0...) ẩn cho gọn - bấm để xem lại.
  // Dòng tự bổ sung luôn hiện (đang nhập dở). Chỉ ẩn trên màn hình, file Excel xuất ra vẫn đủ dòng.
  const [showZero, setShowZero] = useState(false);
  const isZero = (r: SheetRow) => !r.manual && Math.abs(r.qty) < 1e-9;
  const zeroCount = allRows.filter(isZero).length;
  const rows = showZero ? allRows : allRows.filter((r) => !isZero(r));
  // thu gọn / mở rộng nhóm giống Group của Excel: cấp 1 = mục lớn A / B, cấp 2 = đầu mục lớn
  const outline = useOutline(`th-${kind}-${projectId}`);
  const outlineHeads = [{ id: "sec:A", level: 0 }, { id: "sec:B", level: 0 }, ...groups.map((g) => ({ id: `grp:${g.id}`, level: 1 }))];

  const inBox = (section: "A" | "B", groupId: string | null) => rows.filter((r) => r.section === section && r.groupId === groupId);
  const sum = (list: SheetRow[]) => list.reduce((s, r) => s + r.amount, 0);
  const rowById = (id: string) => rows.find((r) => r.resourceId === id);

  // Thứ tự trong mỗi khung luôn A-Z nên chỉ cần đổi khung chứa tài nguyên
  function moveTo(id: string, section: "A" | "B", groupId: string | null) {
    const r = rowById(id);
    if (r?.manual) {
      if (section !== "B") return; // dòng tự thêm chỉ nằm ở mục B
      start(() => void moveManualItemAction(projectId, id, groupId));
      return;
    }
    const list = inBox(section, groupId).filter((x) => !x.manual).map((x) => x.resourceId).filter((x) => x !== id);
    list.push(id);
    start(() => void moveVtResourcesAction(projectId, section, groupId, list, kind));
  }

  // Thứ tự dòng đúng như đang hiển thị (để Shift + bấm chọn đúng đoạn)
  const displayOrder = (["A", "B"] as const)
    .flatMap((sec) => [...groups.filter((g) => g.section === sec).flatMap((g) => inBox(sec, g.id)), ...inBox(sec, null)])
    .map((r) => r.resourceId);

  function togglePick(id: string, shift: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      const on = !prev.has(id);
      const setOne = (x: string) => (on ? next.add(x) : next.delete(x));
      if (shift && lastPick.current) {
        const a = displayOrder.indexOf(lastPick.current);
        const b = displayOrder.indexOf(id);
        if (a >= 0 && b >= 0) displayOrder.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(setOne);
        else setOne(id);
      } else setOne(id);
      return next;
    });
    lastPick.current = id;
  }

  function movePicked() {
    if (!target || picked.size === 0) return;
    const [sec, gid] = target.split("|") as ["A" | "B", string];
    const groupId = gid || null;
    const chosen = rows.filter((r) => picked.has(r.resourceId));
    const own = chosen.filter((r) => !r.manual).map((r) => r.resourceId);
    const manual = chosen.filter((r) => r.manual).map((r) => r.resourceId);
    const skipped = sec === "B" ? 0 : manual.length; // dòng tự bổ sung chỉ nằm ở mục B
    start(async () => {
      if (own.length) {
        const keep = inBox(sec, groupId)
          .filter((x) => !x.manual && !picked.has(x.resourceId))
          .map((x) => x.resourceId);
        await moveVtResourcesAction(projectId, sec, groupId, [...keep, ...own], kind);
      }
      if (manual.length && sec === "B") await moveManualItemsAction(projectId, manual, groupId);
      setPicked(new Set());
      if (skipped) alert(`${skipped} dòng tự bổ sung không chuyển được sang mục A (chỉ nằm ở mục B).`);
    });
  }

  async function deletePickedManual() {
    const ids = rows.filter((r) => r.manual && picked.has(r.resourceId)).map((r) => r.resourceId);
    if (!ids.length || !await confirmNear(`⚠ Xoá ${ids.length} dòng tự bổ sung đã chọn?`)) return;
    start(async () => {
      await deleteManualItemsAction(projectId, ids);
      setPicked(new Set());
    });
  }

  const targetOptions = (["A", "B"] as const).map((sc) => (
    <optgroup key={sc} label={`${sc}. ${cfg[sc]}`}>
      <option value={`${sc}|`}>{sc} — chưa phân nhóm</option>
      {groups
        .filter((g) => g.section === sc)
        .map((g) => (
          <option key={g.id} value={`${sc}|${g.id}`}>
            {sc} › {g.name}
          </option>
        ))}
    </optgroup>
  ));

  const dropProps = (key: string, section: "A" | "B", groupId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragId) return;
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
      if (id) moveTo(id, section, groupId);
    },
  });

  const renderRow = (r: SheetRow, no: number, section: "A" | "B", groupId: string | null) => {
    const key = `row:${r.resourceId}`;
    return (
      <tr
        key={r.resourceId}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", r.resourceId);
          setDragId(r.resourceId);
        }}
        onDragEnd={() => {
          setDragId(null);
          setOver(null);
        }}
        {...dropProps(key, section, groupId)}
        className={`cursor-grab hover:bg-slate-50 ${dragId === r.resourceId ? "opacity-40" : ""} ${over === key ? "bg-blue-100" : ""}`}
      >
        <td className={`${cell} text-center text-slate-500`}>
          <label className="flex cursor-pointer items-center justify-center gap-1">
            <input
              type="checkbox"
              checked={picked.has(r.resourceId)}
              onChange={() => {}}
              onClick={(e) => togglePick(r.resourceId, e.shiftKey)}
              className="h-3.5 w-3.5 cursor-pointer"
            />
            {no}
          </label>
        </td>
        {r.manual ? (
          <>
            <td className={cell}>
              <EnterDown col="th-name"><ManualField projectId={projectId} row={r} field="name" /></EnterDown>
            </td>
            <td className={cell}>
              <EnterDown col="th-unit"><ManualField projectId={projectId} row={r} field="unit" align="center" /></EnterDown>
            </td>
            <td className={cell}>
              <EnterDown col="th-qty" pasteKey={`man:${r.resourceId}`} pasteField="quantity" projectId={projectId}><ManualField projectId={projectId} row={r} field="quantity" /></EnterDown>
            </td>
            {daysCol && (
              <td className={cell}>
                <EnterDown col="th-days"><DaysCell projectId={projectId} row={r} /></EnterDown>
              </td>
            )}
            <td className={cell}>
              <EnterDown col="th-price" pasteKey={`man:${r.resourceId}`} pasteField="unitPrice" projectId={projectId}><ManualField projectId={projectId} row={r} field="unitPrice" /></EnterDown>
            </td>
          </>
        ) : (
          <>
            <td className={cell}>
              {r.laborByWork ? (
                <EnterDown col="th-name"><LaborNameField projectId={projectId} row={r} /></EnterDown>
              ) : (
                <>
                  <div className="leading-tight text-slate-800">{r.name}</div>
                  <div className="text-[10px] text-slate-400">{r.code}</div>
                </>
              )}
            </td>
            <td className={`${cell} text-center text-slate-600`}>{r.unit}</td>
            {showWaste && (
              <td className={`${cell} text-right`}>
                <EnterDown col="th-waste" pasteKey={`res:${r.resourceId}`} pasteField="waste" projectId={projectId}><WastageCell projectId={projectId} resourceId={r.resourceId} ratePercent={r.wastagePercent} /></EnterDown>
              </td>
            )}
            <td className={`${cell} text-right text-slate-700`}>{fmtQty(r.qty)}</td>
            {daysCol && <td className={cell} />}
            <PriceCells key={`${r.priceAfterVat}-${r.vatPercent}`} projectId={projectId} row={r} showVat={showVat} />
          </>
        )}
        {r.manual && showVat && <td colSpan={2} className={cell} />}
        {crewTop && <td className={cell}>{!r.manual && <EnterDown col="th-crew" pasteKey={`res:${r.resourceId}`} pasteField="crewPct" projectId={projectId}><CrewPctCell projectId={projectId} row={r} /></EnterDown>}</td>}
        <td className={`${cell} text-right font-medium text-slate-900`}>{fmt(r.amount)}</td>
        {vatTop && (
          <>
            <td className={cell}>
              <EnterDown col="th-vat-top" pasteKey={vatKey(r)} pasteField="vat" projectId={projectId}><VatTopCell projectId={projectId} row={r} /></EnterDown>
            </td>
            <td className={`${cell} text-right font-medium text-slate-900`}>{fmt(r.amountVat)}</td>
          </>
        )}
        <td className={cell}>
          <select
            value={`${r.section}|${r.groupId ?? ""}`}
            title="Chọn nằm trong mục lớn / đầu mục lớn nào"
            onChange={(e) => {
              const [sec, gid] = e.target.value.split("|");
              moveTo(r.resourceId, sec as "A" | "B", gid || null);
            }}
            className="w-full rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px]"
          >
            {(["A", "B"] as const)
              .filter((sc) => !r.manual || sc === "B")
              .map((sc) => (
                <optgroup key={sc} label={`${sc}. ${cfg[sc]}`}>
                  <option value={`${sc}|`}>{sc} — chưa phân nhóm</option>
                  {groups
                    .filter((g) => g.section === sc)
                    .map((g) => (
                      <option key={g.id} value={`${sc}|${g.id}`}>
                        {sc} › {g.name}
                      </option>
                    ))}
                </optgroup>
              ))}
          </select>
        </td>
        <td className={cell}>
          <div className="flex items-center gap-1">
            <EnterDown col="th-note"><NoteCell projectId={projectId} row={r} kind={kind} /></EnterDown>
          </div>
        </td>
      </tr>
    );
  };

  const renderSection = (section: "A" | "B") => {
    const secRows = rows.filter((r) => r.section === section);
    const secKey = `sec:${section}`;
    const loose = inBox(section, null);
    const secGroups = groups.filter((g) => g.section === section);
    const canAddManual = canAddManualKind && section === "B";
    return (
      <>
        <tr
          {...dropProps(secKey, section, null)}
          className={`bg-blue-100 font-bold text-red-600 ${over === secKey ? "outline outline-2 outline-blue-500" : ""}`}
        >
          <td className={`${cell} text-center`}>{section}</td>
          <td className={cell} colSpan={nCols - 4 - extraCols}>
            <div className="flex items-center justify-between gap-2">
              <span>
                <OutlineToggle open={!outline.collapsed.has(secKey)} onClick={() => outline.toggle(secKey)} />
                {cfg[section]}
              </span>
              {canAddManual && (
                <button
                  onClick={() => start(() => void addManualItemAction(projectId, null, kind as "NC" | "TB"))}
                  className="rounded bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-slate-800"
                >
                  + Bổ sung công tác
                </button>
              )}
            </div>
          </td>
          <td className={`${cell} text-right`}>{fmt(sum(secRows))}</td>
          {vatTop && (
            <>
              <td className={cell} />
              <td className={`${cell} text-right`}>{fmt(sumVat(secRows))}</td>
            </>
          )}

          <td className={cell} colSpan={2} />
        </tr>
        {!outline.collapsed.has(secKey) && (
        <>
        {secGroups.map((g, gi) => {
          const list = inBox(section, g.id);
          const gKey = `grp:${g.id}`;
          return (
            <GroupBlock
              key={g.id}
              no={ROMAN[gi] ?? String(gi + 1)}
              group={g}
              kind={kind}
              total={sum(list)}
              list={list}
              highlighted={over === gKey}
              dropProps={dropProps(gKey, section, g.id)}
              projectId={projectId}
              canAddManual={canAddManual}
              open={!outline.collapsed.has(gKey)}
              onToggle={() => outline.toggle(gKey)}
            >
              {list.length === 0 && (
                <tr {...dropProps(gKey, section, g.id)}>
                  <td className={`${cell} py-2 text-center text-slate-400`} colSpan={nCols}>
                    (Kéo vào đây hoặc chọn ở cột Chuyển Tới)
                  </td>
                </tr>
              )}
              {list.map((r, i) => renderRow(r, i + 1, section, g.id))}
            </GroupBlock>
          );
        })}
        {secGroups.length > 0 && loose.length > 0 && (
          <tr {...dropProps(`loose:${section}`, section, null)} className={`bg-slate-50 italic text-slate-500 ${over === `loose:${section}` ? "outline outline-2 outline-blue-500" : ""}`}>
            <td className={cell} />
            <td className={cell} colSpan={nCols - 2}>
              Chưa phân nhóm
            </td>
            <td className={cell} />
          </tr>
        )}
        {loose.map((r, i) => renderRow(r, i + 1, section, null))}
        {secRows.length === 0 && secGroups.length === 0 && (
          <tr>
            <td className={`${cell} py-2 text-center text-slate-400`} colSpan={nCols}>
              {canAddManual ? `(Bấm "+ Bổ sung công tác" để thêm ${kind === "NC" ? "nhân công" : "thiết bị"} khác)` : "(Kéo vào đây)"}
            </td>
          </tr>
        )}
        </>
        )}
      </>
    );
  };

  const total = sum(rows);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium text-slate-900">{cfg.title}</h2>
        <div className="flex items-center gap-2">
          {equip && <EquipCalcDialog projectId={projectId} calcs={equip.calcs} items={equip.items} />}
          <OutlineBar levels={groups.length ? 2 : 1} onLevel={(lv) => outline.setAll(collapseToLevel(outlineHeads, lv))} onExpandAll={() => outline.setAll([])} />
          {zeroCount > 0 && (
            <button
              type="button"
              onClick={() => setShowZero((v) => !v)}
              title="Dòng không còn khối lượng: công tác đã giao thầu phụ 100%, hoặc khối lượng BOQ bằng 0"
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              {showZero ? `Ẩn ${zeroCount} dòng khối lượng = 0` : `Đang ẩn ${zeroCount} dòng khối lượng = 0 · Hiện`}
            </button>
          )}
          {adding ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newName.trim()) return;
                start(() => void addVtGroupAction(projectId, newSection, newName, kind));
                setNewName("");
                setAdding(false);
              }}
            >
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={kind === "VT" ? "VD: THÉP, BÊ TÔNG, CÁT ĐÁ XI..." : kind === "NC" ? "VD: THÉP, COFFA, BÊ TÔNG..." : "VD: CẨU THÁP, MÁY ĐÀO, VẬN THĂNG..."} className="w-56 rounded border border-slate-300 px-2 py-1 text-xs" />
              <select value={newSection} onChange={(e) => setNewSection(e.target.value as "A" | "B")} className="rounded border border-slate-300 px-1 py-1 text-xs">
                <option value="A">Vào mục A ({cfg.A})</option>
                <option value="B">Vào mục B ({cfg.B})</option>
              </select>
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
        </div>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        Tick chọn nhiều dòng (Shift + bấm để chọn cả đoạn) rồi chuyển cùng lúc ở thanh phía trên bảng, hoặc kéo thả dòng / chọn ở cột Chuyển Tới để chuyển sang mục A/B hay đầu mục lớn khác. Trong mỗi mục, dòng lấy từ chiết tính xếp theo vần A-Z, dòng tự thêm giữ thứ tự đã thêm. Đơn giá nhập riêng cho dự án.{kind === "VT" && " Hao hụt nhập 1 lần tại đây sẽ áp dụng cho sheet CHI TIẾT (để trống = theo định mức gốc)."}
        {canAddManualKind && " Mục A tự tổng hợp từ CHI TIẾT; mục B do người dùng tự bổ sung công tác."} Nút &quot;Thể hiện qua DT-CP&quot; ở dòng đầu mục lớn: bật để đầu mục hiện thành 1 dòng riêng bên sheet DT-CP (dễ kiểm soát chi tiết), tắt để gộp chung vào dòng &quot;chưa phân nhóm&quot;.
      </p>

      <div className="mt-2">
        {picked.size > 0 && (
          <div className="sticky top-0 z-20 mb-2 flex flex-wrap items-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-xs text-slate-800 shadow-sm">
            <b>Đã chọn {picked.size} dòng</b>
            <span className="text-slate-500">— chuyển tới</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)} className="rounded border border-slate-300 bg-white px-1 py-1 text-xs">
              <option value="">— Chọn mục / đầu mục —</option>
              {targetOptions}
            </select>
            <button type="button" disabled={!target || pending} onClick={movePicked} className="rounded bg-blue-600 px-3 py-1 font-medium text-white hover:bg-blue-700 disabled:opacity-40">
              Chuyển
            </button>
            {rows.some((r) => r.manual && picked.has(r.resourceId)) && (
              <button type="button" disabled={pending} onClick={deletePickedManual} className="rounded border border-red-300 bg-white px-2 py-1 text-red-600 hover:bg-red-50">
                Xoá dòng tự bổ sung đã chọn
              </button>
            )}
            {kind === "VT" && rows.some((r) => !r.manual && picked.has(r.resourceId)) && (
              <span className="flex items-center gap-1 text-slate-600" title="Phần trăm Tổng KL vật tư cần tính vận chuyển (không phải 100% vật tư đều vận chuyển). Sau khi tạo vẫn sửa riêng từng dòng được.">
                tính vận chuyển
                <NumInput value={transportPct} decimals suffix="%" onCommit={(v) => setTransportPct(v ?? 100)} onLive={(v) => setTransportPct(v ?? 100)} className="w-16 rounded border border-slate-300 bg-white px-1 py-0.5 text-right text-xs" />
                KL
              </span>
            )}
            {kind === "VT" && rows.some((r) => !r.manual && picked.has(r.resourceId)) && (
              <button
                type="button"
                disabled={pending}
                title="Tạo dòng 'Vận chuyển <vật tư>' ở TH Nhân Công (mục B, đầu mục VẬN CHUYỂN VẬT TƯ), số lượng tự lấy theo Tổng KL vật tư — chỉ cần nhập đơn giá vận chuyển"
                onClick={() =>
                  start(async () => {
                    const ids = rows.filter((r) => !r.manual && picked.has(r.resourceId)).map((r) => r.resourceId);
                    const res = await createTransportLinesAction(projectId, ids, transportPct);
                    setPicked(new Set());
                    alert(
                      `Đã tạo ${res.created} dòng vận chuyển (${transportPct}% khối lượng vật tư) ở TH Nhân Công (mục B › VẬN CHUYỂN VẬT TƯ)${res.skipped ? `; ${res.skipped} vật tư đã có dòng vận chuyển nên bỏ qua` : ""}.\nSang sheet TH Nhân Công để nhập đơn giá vận chuyển.`
                    );
                  })
                }
                className="rounded border border-emerald-400 bg-white px-2 py-1 text-emerald-700 hover:bg-emerald-50"
              >
                🚚 Tạo dòng vận chuyển ở TH Nhân Công
              </button>
            )}
            <button type="button" onClick={() => setPicked(new Set())} className="ml-auto text-slate-500 hover:text-slate-800">
              Bỏ chọn
            </button>
            <span className="w-full text-[10px] text-slate-500">Mẹo: bấm 1 ô rồi giữ Shift bấm ô khác để chọn cả đoạn.</span>
          </div>
        )}
        <TableResize tableId={`rz-th-${kind}`} storageKey={`th-${kind}`} />
      </div>
      <ScrollTable>
<table id={`rz-th-${kind}`} className="w-full table-fixed border-collapse text-xs">
        <colgroup>
          <col className="w-10" />
          <col />
          <col className="w-12" />
          {showWaste && <col className="w-16" />}
          <col className="w-24" />
          {daysCol && <col className="w-16" />}
          <col className="w-24" />
          {showVat && (
            <>
              <col className="w-14" />
              <col className="w-24" />
            </>
          )}
          {crewTop && <col className="w-16" />}
          <col className="w-28" />
          {vatTop && (
            <>
              <col className="w-16" />
              <col className="w-28" />
            </>
          )}

          <col className="w-44" />
          <col className="w-36" />
        </colgroup>
        <thead className="bg-green-100 text-center align-middle text-slate-900">
          <tr>
            <th className={`${cell} font-medium`}>
              <label className="flex cursor-pointer items-center justify-center gap-1" title="Chọn / bỏ chọn tất cả">
                <input
                  type="checkbox"
                  checked={rows.length > 0 && picked.size === rows.length}
                  onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.resourceId)) : new Set())}
                  className="h-3.5 w-3.5 cursor-pointer"
                />
                TT
              </label>
            </th>
            <th className={`${cell} text-center font-medium`}>{kind === "VT" ? "Tên vật tư" : kind === "NC" ? "Tên nhân công / công tác" : "Tên thiết bị / công tác"}</th>
            <th className={`${cell} font-medium`}>ĐVT</th>
            {showWaste && <th className={`${cell} text-center font-medium`}>Hao hụt %</th>}
            <th className={`${cell} text-center font-medium`}>Tổng KL</th>
            {daysCol && <th className={`${cell} text-center font-medium`} title="Có số ngày thì thành tiền = KL × đơn giá (đ/ngày) × số ngày">Thời gian thuê (ngày)</th>}
            <th className={`${cell} text-center font-medium`}>{showVat ? "Đơn giá (sau VAT)" : vatTop ? "Đơn giá (trước VAT)" : "Đơn giá"}</th>
            {showVat && (
              <>
                <th className={`${cell} text-center font-medium`}>VAT %</th>
                <th className={`${cell} text-center font-medium`}>Đơn giá (trước VAT)</th>
              </>
            )}
            {crewTop && <th className={`${cell} text-center font-medium`} title="% quản lý của đội thi công: thành tiền = KL × đơn giá × (1 + %)">% quản lý</th>}
            <th className={`${cell} text-center font-medium`}>{vatTop ? "Thành tiền (trước VAT)" : kind === "VT" ? "Thành tiền (sau VAT)" : "Thành tiền"}</th>
            {vatTop && (
              <>
                <th className={`${cell} text-center font-medium`}>VAT %</th>
                <th className={`${cell} text-center font-medium`}>Thành tiền sau VAT</th>
              </>
            )}

            <th className={`${cell} text-center font-medium`}>Chuyển Tới</th>
            <th className={`${cell} text-center font-medium`}>Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {renderSection("A")}
          {renderSection("B")}
        </tbody>
        <tfoot>
          <tr className="bg-slate-100 font-semibold text-slate-900">
            <td className={cell} colSpan={nCols - 3 - extraCols}>
              Tổng cộng
            </td>
            <td className={`${cell} text-right`}>{fmt(total)}</td>
            {vatTop && (
              <>
                <td className={cell} />
                <td className={`${cell} text-right`}>{fmt(sumVat(rows))}</td>
              </>
            )}

            <td className={cell} colSpan={2} />
          </tr>
        </tfoot>
      </table>
</ScrollTable>
      {rows.length === 0 && <p className="mt-3 text-center text-sm text-slate-400">Chưa có dữ liệu. Thêm BOQ có công tác đã gán định mức để xem tổng hợp.</p>}
    </div>
  );
}

function GroupBlock({
  no,
  group,
  kind,
  total,
  list,
  highlighted,
  dropProps,
  projectId,
  canAddManual,
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  no: string;
  group: SheetGroup;
  kind: SheetKind;
  total: number;
  list: SheetRow[];
  highlighted: boolean;
  dropProps: { onDragOver: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void };
  projectId: string;
  canAddManual: boolean;
  children: React.ReactNode;
}) {
  const [, start] = useTransition();
  const real = list.filter((r) => !r.manual);
  const showVat = kind === "VT";
  const vatTop = vatOnTop(kind);
  const crewTop = kind === "NC";
  const realIds = real.map((r) => r.resourceId);
  return (
    <>
      <tr {...dropProps} className={`bg-slate-100 font-semibold ${highlighted ? "outline outline-2 outline-blue-500" : ""}`}>
        <td className={`${cell} text-center`}>{no}</td>
        <td className={cell} colSpan={2}>
          <div className="flex items-center gap-1">
            <OutlineToggle open={open} onClick={onToggle} />
            <input
              key={group.name}
              defaultValue={group.name}
              onBlur={(e) => e.currentTarget.value !== group.name && start(() => void renameVtGroupAction(projectId, group.id, e.currentTarget.value))}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              className="w-full rounded border border-transparent bg-transparent px-1 font-semibold uppercase hover:border-slate-300 focus:border-blue-400 focus:bg-white"
            />
            {canAddManual && (
              <button
                title="Thêm công tác vào đầu mục này"
                onClick={() => start(() => void addManualItemAction(projectId, group.id, kind as "NC" | "TB"))}
                className="shrink-0 rounded bg-slate-900 px-1.5 text-[10px] font-medium text-white"
              >
                + công tác
              </button>
            )}
          </div>
        </td>
        {showVat && (
          <td className={cell}>
            <GroupRate
              key={`wa-${common(real.map((r) => r.wastagePercent))}`}
              value={common(real.map((r) => r.wastagePercent))}
              disabled={real.length === 0}
              onSave={(v) => start(() => void setVtGroupWastageAction(projectId, real.map((r) => r.resourceId), v))}
            />
          </td>
        )}
        <td className={cell} colSpan={2 + (kind === "TB" ? 1 : 0)} />
        {showVat && (
          <>
            <td className={cell}>
              <GroupRate
                key={`vat-${common(real.map((r) => r.vatPercent))}`}
                value={common(real.map((r) => r.vatPercent))}
                disabled={real.length === 0}
                onSave={(v) => start(() => void setVtGroupVatAction(projectId, real.map((r) => ({ resourceId: r.resourceId, priceAfterVat: r.priceAfterVat })), v ?? 0))}
              />
            </td>
            <td className={cell} />
          </>
        )}
        {crewTop && (
          <td className={cell}>
            <GroupRate key={`crew-${common(real.map((r) => r.mgmtPct ?? 0))}`} value={common(real.map((r) => r.mgmtPct ?? 0))} disabled={real.length === 0} onSave={(v) => start(() => void setCrewMgmtPctAction(projectId, realIds, v ?? 0))} />
          </td>
        )}
        <td className={`${cell} text-right`}>{fmt(total)}</td>
        {vatTop && (
          <>
            <td className={cell}>
              <GroupRate
                key={`vt-${common(list.map((r) => r.vatPercent))}`}
                value={common(list.map((r) => r.vatPercent))}
                disabled={list.length === 0}
                onSave={(v) => start(() => void setThVatAction(projectId, list.map((r) => ({ key: vatKey(r), price: r.priceAfterVat })), v ?? 0))}
              />
            </td>
            <td className={`${cell} text-right`}>{fmt(list.reduce((s, r) => s + r.amountVat, 0))}</td>
          </>
        )}

        <td className={`${cell} text-center`}>
          <DtcpToggleButton projectId={projectId} groupId={group.id} on={group.showInDtcp} />
        </td>
        <td className={`${cell} text-center`}>
          <button
            title="Xoá đầu mục (các dòng bên trong quay về chưa phân nhóm)"
            onClick={async () => (await confirmNear(`⚠ Bạn có chắc chắn muốn XOÁ đầu mục lớn "${group.name}" không?\n\nCác dòng bên trong sẽ không bị mất, chỉ quay về mục lớn (chưa phân nhóm).`)) && start(() => void deleteVtGroupAction(projectId, group.id))}
            className="rounded px-1.5 text-base leading-none text-red-500 hover:bg-red-100"
          >
            ×
          </button>
        </td>
      </tr>
      {open && children}
    </>
  );
}

function GroupRate({ value, onSave, disabled }: { value: number | null; onSave: (v: number | null) => void; disabled?: boolean }) {
  return (
    <div>
      <NumInput
        value={value === null ? null : +value.toFixed(4)}
        decimals
        allowEmpty
        suffix="%"
        placeholder="—"
        disabled={disabled}
        title="Nhập % để áp cho tất cả dòng trong đầu mục này (vẫn sửa riêng từng dòng được)"
        onCommit={onSave}
        className="w-full rounded border border-slate-400 bg-yellow-50 px-1 py-0.5 text-right font-normal"
      />
    </div>
  );
}
