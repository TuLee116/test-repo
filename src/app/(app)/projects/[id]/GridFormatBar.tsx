"use client";

import { useState } from "react";
import type { CellStyle } from "@/lib/grid-style";

const TEXT_COLORS = ["#000000", "#64748b", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#2563eb", "#7c3aed"];
const FILL_COLORS = ["#ffffff", "#e2e8f0", "#fecaca", "#fed7aa", "#fef08a", "#bbf7d0", "#bfdbfe", "#ddd6fe"];

function ColorButton({
  label,
  title,
  colors,
  current,
  disabled,
  onPick,
  noneLabel,
}: {
  label: React.ReactNode;
  title: string;
  colors: string[];
  current?: string;
  disabled: boolean;
  onPick: (c: string | null) => void;
  noneLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        title={title}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 min-w-7 flex-col items-center justify-center rounded border border-transparent px-1.5 leading-none hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="text-[13px] font-semibold">{label}</span>
        <span className="mt-0.5 block h-1 w-4 rounded-sm border border-slate-300" style={{ backgroundColor: current ?? "transparent" }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1 w-40 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
            <div className="grid grid-cols-4 gap-1">
              {colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  onClick={() => {
                    onPick(c);
                    setOpen(false);
                  }}
                  className="h-6 w-6 rounded border border-slate-300 hover:ring-2 hover:ring-blue-400"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                onPick(null);
                setOpen(false);
              }}
              className="mt-2 w-full rounded border border-slate-300 px-1 py-0.5 text-[11px] hover:bg-slate-50"
            >
              {noneLabel}
            </button>
          </div>
        </>
      )}
    </span>
  );
}

// Thanh công cụ định dạng ô của bảng tự do, giống Excel: áp dụng cho vùng ô đang chọn (bấm / kéo / Shift+bấm, bấm tên cột để chọn cả cột)
export default function GridFormatBar({
  hasSelection,
  active,
  painterArmed,
  onToggle,
  onAlign,
  onColor,
  onPct,
  onSep,
  onDecimals,
  onPainter,
  onClear,
  canMerge,
  canUnmerge,
  onMerge,
  onUnmerge,
  selectionLabel,
  onWholeColumn,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onFontSize,
  onBorder,
  onFind,
}: {
  hasSelection: boolean;
  active: CellStyle;
  painterArmed: boolean;
  onToggle: (key: "b" | "i" | "u") => void;
  onAlign: (a: "left" | "center" | "right") => void;
  onColor: (kind: "color" | "bg", c: string | null) => void;
  onPct: () => void;
  onSep: () => void;
  onDecimals: (delta: 1 | -1) => void;
  onPainter: () => void;
  onClear: () => void;
  canMerge: boolean;
  canUnmerge: boolean;
  onMerge: () => void;
  onUnmerge: () => void;
  selectionLabel: string;
  onWholeColumn: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onFontSize: (size: number | null) => void;
  onBorder: (mode: "all" | "none" | null) => void;
  onFind: () => void;
}) {
  const d = !hasSelection;
  const base = "h-7 min-w-7 rounded border px-1.5 text-[13px] leading-none disabled:cursor-not-allowed disabled:opacity-40";
  const cls = (on: boolean) => `${base} ${on ? "border-blue-300 bg-blue-100 text-blue-800" : "border-transparent hover:bg-slate-100"}`;
  const keep = (e: React.MouseEvent) => e.preventDefault(); // giữ ô đang gõ, không mất con trỏ khi bấm nút
  const sep = <span className="mx-1 h-5 w-px bg-slate-200" />;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-0.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
      <button type="button" disabled={!canUndo} onMouseDown={keep} onClick={onUndo} title="Hoàn tác (Ctrl+Z)" className={cls(false)}>
        ↶
      </button>
      <button type="button" disabled={!canRedo} onMouseDown={keep} onClick={onRedo} title="Làm lại (Ctrl+Y)" className={cls(false)}>
        ↷
      </button>
      <button type="button" onMouseDown={keep} onClick={onFind} title="Tìm & thay thế (Ctrl+F)" className={cls(false)}>
        🔍
      </button>
      {sep}
      <button type="button" disabled={d} onMouseDown={keep} onClick={onWholeColumn} title="Chọn cả cột của vùng đang chọn để định dạng" className={cls(false)}>
        ▥ Cả cột
      </button>
      {sep}
      <button type="button" disabled={d} onMouseDown={keep} onClick={onPainter} title="Sao chép định dạng: chọn ô mẫu, bấm nút này, rồi chọn ô / vùng cần áp dụng" className={cls(painterArmed)}>
        🖌 Sao chép định dạng
      </button>
      {painterArmed && <span className="text-[11px] text-blue-700">Chọn ô hoặc vùng cần áp dụng…</span>}
      {sep}
      <button type="button" disabled={d} onMouseDown={keep} onClick={() => onToggle("b")} title="In đậm (Ctrl+B)" className={`${cls(!!active.b)} font-bold`}>
        B
      </button>
      <button type="button" disabled={d} onMouseDown={keep} onClick={() => onToggle("i")} title="In nghiêng (Ctrl+I)" className={`${cls(!!active.i)} italic`}>
        I
      </button>
      <button type="button" disabled={d} onMouseDown={keep} onClick={() => onToggle("u")} title="Gạch chân (Ctrl+U)" className={`${cls(!!active.u)} underline`}>
        U
      </button>
      {sep}
      <button type="button" disabled={d} onMouseDown={keep} onClick={() => onAlign("left")} title="Căn trái" className={cls(active.align === "left")}>
        ⇤
      </button>
      <button type="button" disabled={d} onMouseDown={keep} onClick={() => onAlign("center")} title="Căn giữa" className={cls(active.align === "center")}>
        ≡
      </button>
      <button type="button" disabled={d} onMouseDown={keep} onClick={() => onAlign("right")} title="Căn phải" className={cls(active.align === "right")}>
        ⇥
      </button>
      {sep}
      <select
        disabled={d}
        value={active.fs ?? ""}
        onChange={(e) => onFontSize(e.target.value === "" ? null : Number(e.target.value))}
        title="Cỡ chữ"
        className="h-7 rounded border border-slate-200 bg-white px-1 text-[12px] disabled:opacity-40"
      >
        <option value="">Cỡ chữ</option>
        {[9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <select
        disabled={d}
        value={active.bd ?? ""}
        onChange={(e) => onBorder(e.target.value === "" ? null : (e.target.value as "all" | "none"))}
        title="Viền ô"
        className="h-7 rounded border border-slate-200 bg-white px-1 text-[12px] disabled:opacity-40"
      >
        <option value="">Viền mặc định</option>
        <option value="all">Kẻ viền đậm</option>
        <option value="none">Bỏ viền</option>
      </select>
      <ColorButton label="A" title="Màu chữ" colors={TEXT_COLORS} current={active.color} disabled={d} onPick={(c) => onColor("color", c)} noneLabel="Màu chữ mặc định" />
      <ColorButton label="▧" title="Màu nền ô" colors={FILL_COLORS} current={active.bg} disabled={d} onPick={(c) => onColor("bg", c)} noneLabel="Không tô màu" />
      {sep}
      <button type="button" disabled={d} onMouseDown={keep} onClick={onPct} title="Định dạng phần trăm (0,15 → 15%)" className={cls(!!active.pct)}>
        %
      </button>
      <button type="button" disabled={d} onMouseDown={keep} onClick={onSep} title="Dấu phân cách hàng nghìn (bật/tắt)" className={cls(active.sep === true)}>
        000
      </button>
      <button type="button" disabled={d} onMouseDown={keep} onClick={() => onDecimals(-1)} title="Bớt một chữ số sau dấu phẩy" className={cls(false)}>
        .0←
      </button>
      <button type="button" disabled={d} onMouseDown={keep} onClick={() => onDecimals(1)} title="Thêm một chữ số sau dấu phẩy" className={cls(false)}>
        .00→
      </button>
      {sep}
      <button type="button" disabled={!canMerge} onMouseDown={keep} onClick={onMerge} title="Gộp các ô đang chọn thành một ô (giữ nội dung ô trên-trái)" className={cls(false)}>
        ⊞ Gộp ô
      </button>
      <button type="button" disabled={!canUnmerge} onMouseDown={keep} onClick={onUnmerge} title="Tách ô gộp trong vùng đang chọn" className={cls(false)}>
        ⊟ Tách ô
      </button>
      {sep}
      <button type="button" disabled={d} onMouseDown={keep} onClick={onClear} title="Xoá toàn bộ định dạng của vùng đang chọn (giữ nguyên nội dung)" className={cls(false)}>
        ⌫ Xoá định dạng
      </button>
    </div>
  );
}
