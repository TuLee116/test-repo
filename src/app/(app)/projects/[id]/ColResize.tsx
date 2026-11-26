"use client";

import { useEffect } from "react";

// Kéo chỉnh độ rộng cột cho bảng CHI TIẾT. Bảng có <colgroup> gồm các <col data-i="0..N-1">;
// cột thứ i ứng với ô tiêu đề cuối cùng (leaf) thứ i. Độ rộng lưu ở trình duyệt của từng người dùng.
const KEY = "dtcp-chitiet-cols-v1";
const MIN = 28;

function leafHeaders(table: HTMLTableElement): HTMLTableCellElement[] {
  const rows = table.tHead?.rows;
  if (!rows || rows.length < 2) return [];
  const row1 = Array.from(rows[0].cells);
  const row2 = Array.from(rows[1].cells);
  const spanning = row1.filter((c) => c.rowSpan === 2);
  // thứ tự cột: các ô rowSpan (trừ ô cuối) → hàng 2 → ô rowSpan cuối
  return [...spanning.slice(0, -1), ...row2, spanning[spanning.length - 1]];
}

// Dòng tiêu đề có thể cao thêm khi chữ xuống dòng → đặt lại top của dòng 2, dòng 3 cho khớp
function syncStickyTops(table: HTMLTableElement) {
  const rows = table.tHead?.rows;
  if (!rows || rows.length < 2) return;
  const h1 = rows[0].getBoundingClientRect().height;
  const h2 = rows[1].getBoundingClientRect().height;
  Array.from(rows[1].cells).forEach((c) => (c.style.top = `${h1}px`));
  if (rows[2]) Array.from(rows[2].cells).forEach((c) => (c.style.top = `${h1 + h2}px`));
}

function colsOf(table: HTMLTableElement) {
  return Array.from(table.querySelectorAll<HTMLTableColElement>("col[data-i]")).sort((a, b) => Number(a.dataset.i) - Number(b.dataset.i));
}

function applyWidths(table: HTMLTableElement, widths: number[]) {
  colsOf(table).forEach((c, i) => (c.style.width = `${widths[i]}px`));
  table.style.tableLayout = "fixed";
  table.style.minWidth = "0";
  table.style.width = `${widths.reduce((s, w) => s + w, 0)}px`;
  table.classList.add("ct-fixed");
}

function currentWidths(table: HTMLTableElement): number[] {
  return colsOf(table).map((c) => parseFloat(c.style.width) || 60);
}

export function ColWidthsInit({ tableId }: { tableId: string }) {
  useEffect(() => {
    const table = document.getElementById(tableId) as HTMLTableElement | null;
    if (!table) return;
    const cols = colsOf(table);
    let saved: number[] | null = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) saved = JSON.parse(raw);
    } catch {}
    const heads = leafHeaders(table);
    const measured = heads.map((h) => Math.max(MIN, Math.round(h.getBoundingClientRect().width)));
    const widths = cols.map((_, i) => (saved && typeof saved[i] === "number" ? Math.max(MIN, saved[i]) : measured[i] ?? 80));
    applyWidths(table, widths);
    syncStickyTops(table);
    const ro = new ResizeObserver(() => syncStickyTops(table));
    if (table.tHead) Array.from(table.tHead.rows).forEach((r) => ro.observe(r));

    const reset = () => {
      try {
        localStorage.removeItem(KEY);
      } catch {}
      table.style.tableLayout = "";
      table.style.width = "";
      table.style.minWidth = "";
      table.classList.remove("ct-fixed");
      cols.forEach((c) => (c.style.width = ""));
      requestAnimationFrame(() => {
        applyWidths(table, leafHeaders(table).map((h) => Math.max(MIN, Math.round(h.getBoundingClientRect().width))));
        syncStickyTops(table);
      });
    };
    window.addEventListener("ct-reset-cols", reset);
    return () => {
      window.removeEventListener("ct-reset-cols", reset);
      ro.disconnect();
    };
  }, [tableId]);
  return null;
}

export function ColResizer({ index }: { index: number }) {
  return (
    <span
      title="Kéo để chỉnh độ rộng cột"
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const th = e.currentTarget.closest("th") as HTMLTableCellElement;
        const table = th.closest("table") as HTMLTableElement;
        const col = table.querySelector<HTMLTableColElement>(`col[data-i="${index}"]`);
        if (!col) return;
        const startX = e.clientX;
        const startW = th.getBoundingClientRect().width;
        const startTable = table.getBoundingClientRect().width;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        const move = (ev: MouseEvent) => {
          const w = Math.max(MIN, startW + ev.clientX - startX);
          col.style.width = `${w}px`;
          table.style.width = `${startTable + (w - startW)}px`;
        };
        const up = () => {
          document.removeEventListener("mousemove", move);
          document.removeEventListener("mouseup", up);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          try {
            localStorage.setItem(KEY, JSON.stringify(currentWidths(table)));
          } catch {}
        };
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
      }}
      className="absolute right-0 top-0 z-30 h-full w-1.5 cursor-col-resize hover:bg-blue-400/70"
    />
  );
}

export function ResetColsButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("ct-reset-cols"))}
      className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
      title="Trả độ rộng các cột về mặc định"
    >
      ↺ Đặt lại độ rộng cột
    </button>
  );
}
