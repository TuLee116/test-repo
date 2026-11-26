"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { setBoqColumnValuesAction } from "@/lib/actions";
import { parsePriceFormulaInput } from "@/lib/formula";
import { parsePastedNumber } from "@/lib/parse-number";

// Quét chọn nhiều ô Khối lượng / Đơn giá Báo CĐT của sheet BOQ để sửa cùng lúc (giống Excel):
// - nhấn giữ chuột ở 1 ô rồi kéo sang các ô khác (hoặc bấm 1 ô, giữ Shift rồi bấm ô cuối)
// - Delete: xoá trống các ô đã chọn · Ctrl+C: sao chép · Ctrl+V: dán (1 số = điền hết các ô, nhiều dòng = điền lần lượt) · Esc: bỏ chọn
// - Thanh phía dưới: gõ giá trị (hoặc công thức VD 120000*1.1) rồi "Áp dụng" cho tất cả ô đã chọn.
type Sel = { field: "quantity" | "quoted"; ids: string[] };
const LABEL = { quantity: "Khối lượng", quoted: "Đơn giá Báo CĐT" } as const;

export default function NumCellSelection({ projectId }: { projectId: string }) {
  const [sel, setSel] = useState<Sel | null>(null);
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const selRef = useRef<Sel | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ field: "quantity" | "quoted"; start: number; active: boolean } | null>(null);
  const anchor = useRef<{ field: "quantity" | "quoted"; idx: number } | null>(null);

  const cellsOf = (field: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-numcell="${field}"]`));
  const mark = (s: Sel | null) => {
    selRef.current = s;
    setSel(s);
    document.querySelectorAll<HTMLElement>("[data-numcell]").forEach((el) => {
      if (s && el.dataset.numcell === s.field && s.ids.includes(el.dataset.boqId as string)) el.setAttribute("data-sel", "1");
      else el.removeAttribute("data-sel");
    });
  };
  const select = (field: "quantity" | "quoted", a: number, b: number) => {
    const cells = cellsOf(field);
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    mark({ field, ids: cells.slice(lo, hi + 1).map((c) => c.dataset.boqId as string) });
  };
  const apply = (entries: { id: string; value: number | null }[], label: string) =>
    start(async () => {
      const s = selRef.current;
      if (!s) return;
      await setBoqColumnValuesAction(projectId, s.field, entries);
      setMsg(`${label} (${entries.length} ô)`);
      setTimeout(() => setMsg(""), 3000);
    });

  useEffect(() => {
    const cellAt = (t: EventTarget | null) => (t instanceof Element ? (t.closest("[data-numcell]") as HTMLElement | null) : null);
    const onDown = (e: MouseEvent) => {
      if (barRef.current?.contains(e.target as Node)) return;
      const cell = cellAt(e.target);
      if (!cell) {
        if (selRef.current) mark(null);
        anchor.current = null;
        return;
      }
      const field = cell.dataset.numcell as "quantity" | "quoted";
      const idx = cellsOf(field).indexOf(cell);
      if (e.shiftKey && anchor.current && anchor.current.field === field) {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        select(field, anchor.current.idx, idx);
        return;
      }
      anchor.current = { field, idx };
      drag.current = { field, start: idx, active: false };
      if (selRef.current) mark(null);
    };
    const onMove = (e: MouseEvent) => {
      const d = drag.current;
      if (!d || e.buttons !== 1) return;
      const over = cellAt(document.elementFromPoint(e.clientX, e.clientY));
      if (!over || over.dataset.numcell !== d.field) return;
      const idx = cellsOf(d.field).indexOf(over);
      if (idx === d.start && !d.active) return;
      if (!d.active) {
        d.active = true;
        (document.activeElement as HTMLElement | null)?.blur?.();
        window.getSelection()?.removeAllRanges();
        document.body.style.userSelect = "none";
      }
      select(d.field, d.start, idx);
    };
    const onUp = () => {
      drag.current = null;
      document.body.style.userSelect = "";
    };
    const onKey = (e: KeyboardEvent) => {
      const s = selRef.current;
      if (!s) return;
      const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
      if (e.key === "Escape") return mark(null);
      if (typing) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        apply(s.ids.map((id) => ({ id, value: null })), "Đã xoá giá trị");
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        const cells = cellsOf(s.field).filter((c) => s.ids.includes(c.dataset.boqId as string));
        const text = cells.map((c) => c.querySelector("input")?.value ?? "").join("\n");
        void navigator.clipboard?.writeText(text);
        e.preventDefault();
        setMsg(`Đã sao chép ${cells.length} ô`);
        setTimeout(() => setMsg(""), 2000);
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[0-9=]$/.test(e.key)) {
        inputRef.current?.focus(); // gõ số: chuyển sang ô nhập của thanh phía dưới
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      const s = selRef.current;
      if (!s || document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return;
      const lines = (e.clipboardData?.getData("text/plain") ?? "").replace(/\r/g, "").split("\n");
      while (lines.length > 1 && lines[lines.length - 1].trim() === "") lines.pop();
      const nums = lines.map((l) => parsePastedNumber(l));
      e.preventDefault();
      if (lines.length === 1) {
        if (nums[0] === null) return setMsg("Nội dung dán không phải số");
        const v = nums[0];
        apply(s.ids.map((id) => ({ id, value: v })), `Đã điền ${v.toLocaleString("vi-VN")}`);
      } else {
        const entries = s.ids.flatMap((id, i) => (nums[i] != null ? [{ id, value: nums[i] as number }] : []));
        if (entries.length) apply(entries, "Đã dán");
      }
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("keydown", onKey);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("paste", onPaste);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = () => {
    if (!sel) return;
    const t = value.trim();
    if (!t) return setMsg("Nhập giá trị cần áp dụng");
    const p = parsePriceFormulaInput(t);
    if (!p.ok) return setMsg(p.error);
    const v = sel.field === "quantity" ? p.value : Math.round(p.value);
    apply(sel.ids.map((id) => ({ id, value: v })), `Đã điền ${v.toLocaleString("vi-VN")}`);
    setValue("");
  };

  return (
    <>
      <style>{`[data-numcell][data-sel="1"] input{background:#bfdbfe !important;border-color:#2563eb !important;box-shadow:0 0 0 1px #2563eb}
tr:has([data-numcell] input:focus) > td,tr:has([data-numcell][data-sel="1"]) > td{background-color:#dbeafe !important}
tr:has([data-numcell] input:focus) > td:first-child,tr:has([data-numcell][data-sel="1"]) > td:first-child{box-shadow:inset 3px 0 0 #2563eb}`}</style>
      {sel && (
        <div ref={barRef} className={`fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs shadow-xl ${pending ? "opacity-60" : ""}`}>
          <b className="text-blue-800">
            Đã chọn {sel.ids.length} ô {LABEL[sel.field]}
          </b>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              else if (e.key === "Escape") mark(null);
            }}
            placeholder="Gõ giá trị (hoặc công thức)"
            className="w-44 rounded border border-slate-300 px-2 py-1 text-right"
          />
          <button type="button" disabled={pending} onClick={commit} className="rounded bg-blue-600 px-3 py-1 font-medium text-white disabled:opacity-40">
            Áp dụng cho tất cả
          </button>
          <button type="button" disabled={pending} onClick={() => apply(sel.ids.map((id) => ({ id, value: null })), "Đã xoá giá trị")} className="rounded border border-red-300 px-2 py-1 text-red-600 hover:bg-red-50">
            Xoá trống
          </button>
          <button type="button" onClick={() => mark(null)} className="text-slate-500 underline">
            Bỏ chọn
          </button>
          {msg && <span className="text-emerald-700">{msg}</span>}
        </div>
      )}
      {!sel && msg && <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded bg-slate-900 px-3 py-1.5 text-xs text-white">{msg}</div>}
    </>
  );
}
