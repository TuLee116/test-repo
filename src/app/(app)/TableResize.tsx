"use client";

import { useEffect } from "react";

// Kéo chỉnh độ rộng cột cho BẤT KỲ bảng nào (tiêu đề 1 hoặc nhiều dòng, có ô gộp).
// Cách dùng: đặt <TableResize tableId="..." storageKey="..." /> ngay trước <table id="...">.
// - Mỗi cột dạng "lá" ở dòng tiêu đề cuối có thanh kéo ở mép phải.
// - Khi đã kéo (hoặc khi bảng được cố định độ rộng), chữ trong ô tự xuống dòng (xem .rz-fixed ở globals.css).
// - Độ rộng lưu ở trình duyệt của từng người dùng, theo storageKey + số cột.
const MIN = 28;

type Grid = { colCount: number; leaf: (HTMLTableCellElement | null)[] };

function buildGrid(table: HTMLTableElement): Grid {
  const rows = Array.from(table.tHead?.rows ?? []);
  if (rows.length === 0) return { colCount: 0, leaf: [] };
  const occupied: boolean[][] = rows.map(() => []);
  const cover: (HTMLTableCellElement | null)[][] = rows.map(() => []);
  let colCount = 0;
  rows.forEach((row, r) => {
    let c = 0;
    for (const cell of Array.from(row.cells)) {
      while (occupied[r][c]) c++;
      for (let dr = 0; dr < cell.rowSpan && r + dr < rows.length; dr++) {
        for (let dc = 0; dc < cell.colSpan; dc++) {
          occupied[r + dr][c + dc] = true;
          cover[r + dr][c + dc] = cell;
        }
      }
      c += cell.colSpan;
    }
    colCount = Math.max(colCount, c);
  });
  const last = rows.length - 1;
  const leaf = Array.from({ length: colCount }, (_, c) => {
    const cell = cover[last][c];
    return cell && cell.colSpan === 1 ? cell : null;
  });
  return { colCount, leaf };
}

function getCols(table: HTMLTableElement, colCount: number): HTMLTableColElement[] {
  let group = table.querySelector<HTMLTableColElement>(":scope > colgroup");
  if (!group || group.children.length !== colCount) {
    if (group) group.remove();
    const g = document.createElement("colgroup");
    for (let i = 0; i < colCount; i++) g.appendChild(document.createElement("col"));
    table.insertBefore(g, table.firstChild);
    group = g as unknown as HTMLTableColElement;
  }
  return Array.from((group as unknown as HTMLElement).children) as HTMLTableColElement[];
}

function clearFixed(table: HTMLTableElement, cols: HTMLTableColElement[]) {
  table.style.tableLayout = "";
  table.style.width = "";
  table.style.minWidth = "";
  table.classList.remove("rz-fixed");
  cols.forEach((c) => (c.style.width = ""));
}

function apply(table: HTMLTableElement, cols: HTMLTableColElement[], widths: number[]) {
  cols.forEach((c, i) => (c.style.width = `${widths[i]}px`));
  table.style.tableLayout = "fixed";
  table.style.minWidth = "0";
  table.style.width = `${widths.reduce((s, w) => s + w, 0)}px`;
  table.classList.add("rz-fixed");
}

// Cố định các dòng tiêu đề (thead) khi cuộn: mỗi dòng dính ngay dưới dòng trước, ô có nền đặc để không lộ nội dung phía sau
function syncSticky(table: HTMLTableElement) {
  const rows = Array.from(table.tHead?.rows ?? []);
  if (rows.length === 0) return;
  const isClear = (c: string) => c === "transparent" || c === "rgba(0, 0, 0, 0)";
  const headBg = table.tHead ? getComputedStyle(table.tHead).backgroundColor : "";
  let top = 0;
  rows.forEach((row) => {
    const rowBg = getComputedStyle(row).backgroundColor;
    Array.from(row.cells).forEach((cell) => {
      cell.style.position = "sticky";
      cell.style.top = `${top}px`;
      cell.style.zIndex = "20";
      const own = getComputedStyle(cell).backgroundColor;
      if (isClear(own)) cell.style.backgroundColor = !isClear(rowBg) ? rowBg : !isClear(headBg) ? headBg : "#ffffff";
    });
    top += row.getBoundingClientRect().height;
  });
}

function addHandles(grid: Grid) {
  grid.leaf.forEach((th, i) => {
    if (!th || th.querySelector(":scope > .rz-handle")) return;
    if (getComputedStyle(th).position === "static") th.style.position = "relative";
    const h = document.createElement("span");
    h.className = "rz-handle";
    h.dataset.col = String(i);
    h.title = "Kéo để chỉnh độ rộng cột";
    th.appendChild(h);
  });
}

export default function TableResize({ tableId, storageKey }: { tableId: string; storageKey: string }) {
  useEffect(() => {
    const table = document.getElementById(tableId) as HTMLTableElement | null;
    if (!table) return;

    table.classList.add("rz-sticky");
    let colCount = -1;
    let cols: HTMLTableColElement[] = [];
    const keyFor = (n: number) => `dtcp-cols:${storageKey}:${n}`;

    function init() {
      if (!table) return;
      const grid = buildGrid(table);
      if (grid.colCount === 0) return;
      // đo độ rộng tự nhiên trước khi cố định
      if (cols.length) clearFixed(table, cols);
      cols = getCols(table, grid.colCount);
      clearFixed(table, cols);
      const measured = grid.leaf.map((th) => (th ? Math.max(MIN, Math.round(th.getBoundingClientRect().width)) : 80));
      let saved: number[] | null = null;
      try {
        const raw = localStorage.getItem(keyFor(grid.colCount));
        if (raw) saved = JSON.parse(raw);
      } catch {}
      const widths = measured.map((m, i) => (saved && typeof saved[i] === "number" ? Math.max(MIN, saved[i]) : m));
      apply(table, cols, widths);
      syncSticky(table);
      addHandles(grid);
      colCount = grid.colCount;
    }
    init();

    // Bảng đổi số cột (VD: thêm cột so sánh) hoặc mất thanh kéo sau khi render lại → dựng lại
    let raf = 0;
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!table) return;
        const grid = buildGrid(table);
        if (grid.colCount !== colCount) init();
        else {
          syncSticky(table);
          addHandles(grid);
        }
      });
    });
    if (table.tHead) mo.observe(table.tHead, { childList: true, subtree: true });
    const ro = new ResizeObserver(() => table && syncSticky(table));
    if (table.tHead) Array.from(table.tHead.rows).forEach((r) => ro.observe(r));

    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains("rz-handle") || !table) return;
      e.preventDefault();
      e.stopPropagation();
      const idx = Number(target.dataset.col);
      const th = target.closest("th") as HTMLTableCellElement;
      const startX = e.clientX;
      const startW = th.getBoundingClientRect().width;
      const startTable = table.getBoundingClientRect().width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const move = (ev: MouseEvent) => {
        const w = Math.max(MIN, startW + ev.clientX - startX);
        cols[idx].style.width = `${w}px`;
        table.style.width = `${startTable + (w - startW)}px`;
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        try {
          localStorage.setItem(keyFor(colCount), JSON.stringify(cols.map((c) => parseFloat(c.style.width) || 60)));
        } catch {}
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    };
    table.addEventListener("mousedown", onDown);

    const reset = () => {
      try {
        localStorage.removeItem(keyFor(colCount));
      } catch {}
      init();
    };
    window.addEventListener(`rz-reset-${tableId}`, reset);

    return () => {
      mo.disconnect();
      ro.disconnect();
      cancelAnimationFrame(raf);
      table.removeEventListener("mousedown", onDown);
      window.removeEventListener(`rz-reset-${tableId}`, reset);
    };
  }, [tableId, storageKey]);

  return (
    <div className="mb-1 flex justify-end">
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event(`rz-reset-${tableId}`))}
        className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
        title="Trả độ rộng các cột về mặc định. Kéo mép phải của tiêu đề cột để chỉnh độ rộng."
      >
        ↺ Đặt lại độ rộng cột
      </button>
    </div>
  );
}
