"use client";

import { startTransition } from "react";
import { parsePastedNumber } from "@/lib/parse-number";
import { pasteSheetNumbersAction, setBoqColumnValuesAction, type PasteField } from "@/lib/actions";

// Bấm Enter trong 1 ô nhập → lưu ô đó (ô tự lưu khi rời) rồi chuyển con trỏ xuống ô CÙNG CỘT ở dòng kế tiếp,
// giống sheet BOQ / Excel. Bọc quanh ô nhập; `col` = tên cột (các ô cùng tên cột nối thành 1 cột theo thứ tự
// trên trang). Shift+Enter giữ hành vi mặc định (VD xuống dòng trong ô chữ nhiều dòng).
// pasteKey + pasteField + projectId: ô số chọn / dán hàng loạt được như Excel (xem phần "Chọn nhiều ô" bên dưới).
export default function EnterDown({ col, pasteKey, pasteField, projectId, children }: { col: string; pasteKey?: string; pasteField?: CellPasteField; projectId?: string; children: React.ReactNode }) {
  return (
    <div
      className="contents"
      data-enter-col={col}
      data-paste-key={pasteKey}
      data-paste-field={pasteField}
      data-paste-project={projectId}
      onKeyDownCapture={(e) => {
        if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
        const cells = Array.from(document.querySelectorAll<HTMLElement>(`[data-enter-col="${CSS.escape(col)}"]`));
        const next = cells[cells.indexOf(e.currentTarget as HTMLElement) + 1];
        const input = next?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input:not([type=checkbox]):not([disabled]), textarea:not([disabled])");
        if (!input) return;
        // để ô hiện tại kịp lưu (blur) rồi mới chuyển
        setTimeout(() => {
          input.focus();
          input.select();
          input.scrollIntoView({ block: "nearest" });
        }, 0);
      }}
    >
      {children}
    </div>
  );
}

// Dán nhiều dòng (1 cột copy từ Excel) vào ô đang chọn: dòng 1 vào ô này, các dòng sau lần lượt vào các ô CÙNG CỘT
// bên dưới (thứ tự như phím Enter). Dòng trống / không phải số thì giữ nguyên ô đó; ô không dán được (dòng chỉ
// xem) cũng bỏ qua. Trả về danh sách {key, value} để màn hình gọi 1 lần lưu.
export function pasteDownTargets(lines: string[]): { entries: { key: string; value: number }[]; skipped: number } {
  const here = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-enter-col]");
  if (!here) return { entries: [], skipped: lines.length };
  const cells = Array.from(document.querySelectorAll<HTMLElement>(`[data-enter-col="${CSS.escape(here.dataset.enterCol ?? "")}"]`));
  const from = cells.indexOf(here);
  const entries: { key: string; value: number }[] = [];
  let skipped = 0;
  lines.forEach((ln, i) => {
    const cell = cells[from + i];
    const v = parsePastedNumber(ln);
    if (v === null) return;
    if (!cell?.dataset.pasteKey) {
      skipped++;
      return;
    }
    entries.push({ key: cell.dataset.pasteKey, value: v });
  });
  return { entries, skipped };
}

// Thông báo nhỏ góc dưới phải (tự tắt)
export function toast(msg: string) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.className = "fixed bottom-4 right-4 z-[80] max-w-sm rounded-md bg-slate-900 px-4 py-2 text-sm text-white shadow-lg";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ---- Chọn nhiều ô như Excel (mọi ô số có pasteField) ----
// Shift + bấm: chọn cả đoạn từ ô đang đứng tới ô vừa bấm (cùng cột). Ctrl + bấm: thêm / bớt từng ô. Bấm thường / Esc: bỏ chọn.
// Delete: xoá trắng tất cả ô đang chọn. Ctrl+V: 1 giá trị → dán vào TẤT CẢ ô đang chọn; nhiều dòng → điền lần lượt các ô đang chọn (hết dòng thì lặp lại);
// chưa chọn nhiều ô mà dán nhiều dòng → điền từ ô đang đứng xuống các ô bên dưới. Lưu 1 lần cho cả loạt.
// boq-quantity / boq-quoted: ô Khối lượng / Giá báo CĐT của sheet BOQ (key "boq:<id>").
export type CellPasteField = PasteField | "boq-quantity" | "boq-quoted";

const SEL_STYLE = { background: "#dbeafe", outline: "2px solid #3b82f6" };
let anchor: HTMLElement | null = null;
let selected: HTMLElement[] = [];

const cellOf = (el: EventTarget | null) => (el instanceof Element ? el.closest<HTMLElement>("[data-enter-col][data-paste-field]") : null);
const colCells = (col: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-enter-col="${CSS.escape(col)}"][data-paste-field]`));

function paint(next: HTMLElement[]) {
  for (const c of selected) c.querySelectorAll<HTMLElement>("input").forEach((i) => Object.keys(SEL_STYLE).forEach((k) => i.style.removeProperty(k)));
  selected = next;
  if (selected.length < 2) return; // 1 ô thì không tô (ô đang đứng đã có viền focus)
  for (const c of selected) c.querySelectorAll<HTMLElement>("input").forEach((i) => Object.assign(i.style, SEL_STYLE));
}

// value null = xoá ô (giá báo CĐT → chưa nhập; các ô số khác → 0)
async function save(projectId: string, field: CellPasteField, entries: { key: string; value: number | null }[]): Promise<number> {
  if (field === "boq-quantity" || field === "boq-quoted") {
    const r = await setBoqColumnValuesAction(projectId, field === "boq-quantity" ? "quantity" : "quoted", entries.map((e) => ({ id: e.key.replace(/^boq:/, ""), value: e.value })));
    return r.updated;
  }
  return (await pasteSheetNumbersAction(projectId, field, entries.map((e) => ({ key: e.key, value: e.value ?? 0 })))).count;
}

// Lưu cùng 1 lúc cho nhiều ô (có thể khác dự án / khác cột dữ liệu): gom theo (dự án, loại ô)
async function saveCells(cells: HTMLElement[], valueOf: (cell: HTMLElement, i: number) => number | null | undefined): Promise<{ n: number; skipped: number }> {
  const groups = new Map<string, { projectId: string; field: CellPasteField; entries: { key: string; value: number | null }[] }>();
  let skipped = 0;
  cells.forEach((cell, i) => {
    const v = valueOf(cell, i);
    const { pasteKey, pasteField, pasteProject } = cell.dataset;
    if (v === undefined || !pasteKey || !pasteField || !pasteProject) {
      skipped++;
      return;
    }
    const g = `${pasteProject}|${pasteField}`;
    if (!groups.has(g)) groups.set(g, { projectId: pasteProject, field: pasteField as CellPasteField, entries: [] });
    groups.get(g)!.entries.push({ key: pasteKey, value: v });
  });
  let n = 0;
  for (const g of groups.values()) n += await save(g.projectId, g.field, g.entries);
  return { n, skipped };
}

if (typeof window !== "undefined" && !(window as unknown as { __cellSel?: boolean }).__cellSel) {
  (window as unknown as { __cellSel?: boolean }).__cellSel = true;
  window.addEventListener(
    "mousedown",
    (e) => {
      const c = cellOf(e.target);
      if (!c) {
        if (selected.length) paint([]);
        return;
      }
      const col = c.dataset.enterCol as string;
      if (e.shiftKey && anchor && anchor.isConnected && anchor.dataset.enterCol === col) {
        const all = colCells(col);
        const [a, b] = [all.indexOf(anchor), all.indexOf(c)].sort((x, y) => x - y);
        if (a >= 0) {
          e.preventDefault(); // giữ con trỏ ở ô đang đứng, không bôi đen chữ
          paint(all.slice(a, b + 1));
        }
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const base = selected.length && selected[0].dataset.enterCol === col ? selected : anchor && anchor.dataset.enterCol === col ? [anchor] : [];
        const next = base.includes(c) ? base.filter((x) => x !== c) : [...base, c];
        paint(colCells(col).filter((x) => next.includes(x)));
        return;
      }
      anchor = c;
      paint([c]);
    },
    true
  );
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && selected.length > 1) paint([]);
      // Delete khi đang chọn nhiều ô: xoá trắng TẤT CẢ ô đang chọn (như Excel), lưu 1 lần
      if (e.key === "Delete" && selected.length > 1) {
        const here = cellOf(document.activeElement);
        if (!here || !selected.includes(here)) return;
        e.preventDefault();
        e.stopPropagation();
        const targets = selected.filter((x) => x.isConnected);
        targets.forEach((c) => c.querySelectorAll<HTMLInputElement>("input:not([type=checkbox])").forEach((i) => (i.value = "")));
        startTransition(async () => {
          const { n } = await saveCells(targets, () => null);
          paint([]);
          toast(`Đã xoá ${n} ô`);
        });
      }
    },
    true
  );
  window.addEventListener(
    "paste",
    (e) => {
      const here = cellOf(document.activeElement);
      if (!here) return;
      const lines = (e.clipboardData?.getData("text") ?? "").replace(/\r/g, "").split("\n");
      while (lines.length > 1 && lines[lines.length - 1].trim() === "") lines.pop();
      let targets: HTMLElement[];
      let multi = false;
      if (selected.length > 1 && selected.includes(here)) {
        targets = selected.filter((x) => x.isConnected);
        multi = true;
      } else if (lines.length > 1) {
        const all = colCells(here.dataset.enterCol as string);
        targets = all.slice(all.indexOf(here), all.indexOf(here) + lines.length);
      } else return; // 1 giá trị vào 1 ô: để ô tự xử lý như bình thường
      e.preventDefault();
      e.stopPropagation();
      const values = targets.map((_, i) => parsePastedNumber(lines[multi ? i % lines.length : i] ?? ""));
      if (values.every((v) => v === null)) {
        toast("Không có số hợp lệ để dán");
        return;
      }
      startTransition(async () => {
        const { n, skipped } = await saveCells(targets, (_, i) => values[i] ?? undefined);
        paint([]);
        toast(`Đã dán vào ${n} ô${skipped ? ` (bỏ qua ${skipped} ô trống / không phải số)` : ""}`);
      });
    },
    true
  );
}
