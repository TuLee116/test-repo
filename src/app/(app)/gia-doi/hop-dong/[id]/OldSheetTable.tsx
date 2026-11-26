"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { editSheetAction, type SheetEditOp } from "@/lib/hop-dong-actions";
import type { SheetView, VCell, VRow } from "@/lib/sheet-view-model";

// Bảng sheet DT-CP / BOQ / CHI TIẾT của file DT-CP cũ (giao diện kiểu DT-CP của phần mềm). QSTT chỉnh được: gộp ô, tách ô, xoá dòng dư, kéo giãn cột.
// Chọn ô: bấm 1 ô, giữ Shift bấm ô khác để chọn vùng.
type Pos = { ri: number; ci: number };
const PX = 7.2; // 1 ký tự độ rộng Excel ≈ 7,2 px

const bgOf = (r: VRow) => (r.level === "sec" ? "bg-blue-100" : r.level === "grp" ? "bg-slate-50" : "");

export default function OldSheetTable({ view, sheetId, canEdit }: { view: SheetView; sheetId: string; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState<{ a: Pos; b: Pos } | null>(null);
  const [widths, setWidths] = useState<number[]>(() => view.cols.map((c) => Math.round(Math.min(Math.max(c.w * PX, 36), 900))));
  const drag = useRef<{ k: number; x0: number; w0: number } | null>(null);

  const rect = sel ? { r1: Math.min(sel.a.ri, sel.b.ri), r2: Math.max(sel.a.ri, sel.b.ri), c1: Math.min(sel.a.ci, sel.b.ci), c2: Math.max(sel.a.ci, sel.b.ci) } : null;
  const hit = (c: VCell) => !!rect && c.ri <= rect.r2 && c.ri + c.rs0 - 1 >= rect.r1 && c.ci <= rect.c2 && c.ci + c.cs0 - 1 >= rect.c1;
  const allRows = [...view.head, ...view.body];
  const mergedInSel = rect ? allRows.flatMap((r) => r.cells).filter((c): c is VCell => !!c && (c.cs0 > 1 || c.rs0 > 1) && hit(c)) : [];

  const run = (ops: SheetEditOp[], confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    start(async () => {
      for (const op of ops) {
        const r = await editSheetAction(sheetId, op);
        if (!r.ok) return window.alert(r.error);
      }
      setSel(null);
      router.refresh();
    });
  };

  const pick = (c: VCell, shift: boolean) => {
    if (!canEdit) return;
    setSel((s) => (shift && s ? { a: s.a, b: { ri: c.ri, ci: c.ci } } : { a: { ri: c.ri, ci: c.ci }, b: { ri: c.ri, ci: c.ci } }));
  };

  const startDrag = (e: React.MouseEvent, ci: number) => {
    e.preventDefault();
    e.stopPropagation();
    const k = view.colIdx.indexOf(ci);
    if (k < 0) return;
    drag.current = { k, x0: e.clientX, w0: widths[k] };
    const move = (ev: MouseEvent) => {
      const d = drag.current;
      if (d) setWidths((w) => w.map((x, i) => (i === d.k ? Math.min(Math.max(d.w0 + ev.clientX - d.x0, 30), 1200) : x)));
    };
    const up = (ev: MouseEvent) => {
      const d = drag.current;
      drag.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (!d) return;
      const px = Math.min(Math.max(d.w0 + ev.clientX - d.x0, 30), 1200);
      if (Math.abs(px - d.w0) < 2) return;
      start(async () => {
        const r = await editSheetAction(sheetId, { kind: "width", c: view.colIdx[d.k], w: px / PX });
        if (!r.ok) window.alert(r.error);
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const total = widths.reduce((a, b) => a + b, 0);
  const btn = "rounded border px-2 py-1 text-xs disabled:opacity-40";

  const cellCls = (c: VCell, r: VRow, k: number) => {
    const isStt = k === view.sttCol;
    const isContent = k === view.contentCol;
    const bold = c.bold || r.level === "sec" || r.level === "grp" || r.level === "l1";
    const color = r.level === "sec" ? "text-red-600" : r.level === "lN" ? "text-slate-700" : "text-slate-900";
    const align = c.num ? "text-right tabular-nums" : isStt ? "text-center" : r.level === "sec" && isContent ? "text-center" : "text-left";
    return `border border-slate-300 px-2 py-1 align-middle text-[13px] ${bold ? "font-semibold" : ""} ${c.italic || (isStt && r.level === "lN") ? "italic" : ""} ${color} ${align}`;
  };
  const selCls = (c: VCell) => (hit(c) ? " !bg-sky-200 outline outline-2 -outline-offset-2 outline-sky-500" : "");

  return (
    <div>
      {canEdit && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
          <span className="font-medium text-slate-700">Chỉnh bảng:</span>
          <button type="button" disabled={pending || !rect || (rect.r1 === rect.r2 && rect.c1 === rect.c2)} onClick={() => rect && run([{ kind: "merge", r1: rect.r1, c1: rect.c1, r2: rect.r2, c2: rect.c2 }])} className={`${btn} border-sky-300 bg-white text-sky-800 hover:bg-sky-50`}>
            Gộp ô
          </button>
          <button type="button" disabled={pending || !mergedInSel.length} onClick={() => run(mergedInSel.map((c) => ({ kind: "split" as const, r: c.ri, c: c.ci })))} className={`${btn} border-sky-300 bg-white text-sky-800 hover:bg-sky-50`}>
            Tách ô
          </button>
          <button
            type="button"
            disabled={pending || !rect}
            onClick={() => rect && run([{ kind: "delRows", r1: rect.r1, r2: rect.r2 }], `Xoá ${rect.r2 - rect.r1 + 1} dòng đang chọn khỏi bảng (dòng dư thừa)?`)}
            className={`${btn} border-red-300 bg-white text-red-700 hover:bg-red-50`}
          >
            Xoá dòng
          </button>
          <button type="button" disabled={!sel} onClick={() => setSel(null)} className={`${btn} border-slate-300 bg-white hover:bg-slate-100`}>
            Bỏ chọn
          </button>
          <span className="text-slate-500">Bấm 1 ô, giữ Shift bấm ô khác để chọn vùng · kéo mép phải ô tiêu đề để giãn cột.</span>
          {pending && <span className="text-amber-700">Đang lưu…</span>}
        </div>
      )}
      <div className="max-h-[75vh] overflow-auto rounded border border-slate-300">
        <table className="border-collapse" style={{ width: total, minWidth: "100%", tableLayout: "fixed" }}>
          <colgroup>
            {widths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          {view.head.length > 0 && (
            <thead className="sticky top-0 z-10">
              {view.head.map((r) => (
                <tr key={r.src}>
                  {r.cells.map((c, k) =>
                    c ? (
                      <th
                        key={k}
                        colSpan={c.colSpan > 1 ? c.colSpan : undefined}
                        rowSpan={c.rowSpan > 1 ? c.rowSpan : undefined}
                        onClick={(e) => pick(c, e.shiftKey)}
                        className={`relative border border-slate-300 bg-emerald-100 px-2 py-1.5 text-center align-middle text-[13px] font-semibold text-slate-900 ${canEdit ? "cursor-pointer" : ""}${selCls(c)}`}
                      >
                        <span className="whitespace-pre-line break-words">{c.text}</span>
                        {canEdit && <span onMouseDown={(e) => startDrag(e, c.ci + c.cs0 - 1)} onClick={(e) => e.stopPropagation()} className="absolute right-0 top-0 z-20 h-full w-1.5 cursor-col-resize hover:bg-sky-400/60" title="Kéo để giãn / thu cột" />}
                      </th>
                    ) : null,
                  )}
                </tr>
              ))}
            </thead>
          )}
          <tbody>
            {view.body.map((r) =>
              r.level === "blank" ? (
                <tr key={r.src}>
                  <td colSpan={Math.max(view.cols.length, 1)} onClick={(e) => canEdit && pick({ text: "", num: false, bold: false, italic: false, colSpan: 1, rowSpan: 1, ri: r.src - 1, ci: 0, cs0: 1, rs0: 1 }, e.shiftKey)} className={`h-2 border-x border-slate-300 p-0 ${rect && r.src - 1 >= rect.r1 && r.src - 1 <= rect.r2 ? "bg-sky-200" : ""}`} />
                </tr>
              ) : (
                <tr key={r.src} className={bgOf(r)}>
                  {r.cells.map((c, k) =>
                    c ? (
                      <td
                        key={k}
                        colSpan={c.colSpan > 1 ? c.colSpan : undefined}
                        rowSpan={c.rowSpan > 1 ? c.rowSpan : undefined}
                        onClick={(e) => pick(c, e.shiftKey)}
                        className={`${cellCls(c, r, k)} ${canEdit ? "cursor-pointer" : ""}${selCls(c)}`}
                        style={k === view.contentCol && r.level === "lN" ? { paddingLeft: 8 + r.depth * 14 } : k === view.contentCol && r.level === "plain" ? { paddingLeft: 8 } : undefined}
                      >
                        <span className="whitespace-pre-line break-words">{c.text}</span>
                      </td>
                    ) : null,
                  )}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
