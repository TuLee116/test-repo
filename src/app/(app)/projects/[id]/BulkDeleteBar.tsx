"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  deleteDtcpLinesAction,
  deleteManualItemsAction,
  deleteSubItemsAction,
  deleteWorkItemResourceLinesAction,
} from "@/lib/actions";
import { confirmNear } from "@/app/(app)/confirm-near";

export type BulkKind = "dtcp" | "sub" | "nc-manual" | "tb-manual" | "ct-lines";

// Thanh chọn nhiều dòng để xoá hàng loạt cho các sheet. Ô tick là <input data-bulk="{kind}" value="{id}"> đặt trong bảng;
// bấm 1 ô rồi Shift + bấm ô khác để chọn cả đoạn.
export default function BulkDeleteBar({ projectId, kind, noun = "dòng" }: { projectId: string; kind: BulkKind; noun?: string }) {
  const [count, setCount] = useState(0);
  const [pending, start] = useTransition();
  const last = useRef<number | null>(null);

  const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>(`input[data-bulk="${kind}"]`));
  const refresh = () => setCount(boxes().filter((c) => c.checked).length);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || t.dataset.bulk !== kind) return;
      const list = boxes();
      const idx = list.indexOf(t);
      if (e.shiftKey && last.current !== null) {
        const from = Math.min(last.current, idx);
        const to = Math.max(last.current, idx);
        for (let i = from; i <= to; i++) list[i].checked = t.checked;
      }

      // chọn / bỏ chọn 1 đầu mục (có data-depth) → tự chọn / bỏ chọn toàn bộ mục con nằm dưới nó
      const depthOf = (el: HTMLInputElement) => (el.dataset.depth !== undefined ? Number(el.dataset.depth) : Infinity);
      const d = depthOf(t);
      if (!e.shiftKey && Number.isFinite(d)) {
        for (let i = idx + 1; i < list.length; i++) {
          if (depthOf(list[i]) <= d) break;
          list[i].checked = t.checked;
        }
      }
      last.current = idx;
      refresh();
    };
    document.addEventListener("click", onClick);
    let raf = 0;
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(refresh);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      document.removeEventListener("click", onClick);
      mo.disconnect();
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const setAll = (v: boolean) => {
    boxes().forEach((c) => (c.checked = v));
    refresh();
  };

  async function remove() {
    const ids = boxes()
      .filter((c) => c.checked)
      .map((c) => c.value);
    if (ids.length === 0) return;
    const extra =
      kind === "dtcp"
        ? "\n\nCác dòng con của dòng được chọn cũng bị xoá theo."
        : kind === "ct-lines"
        ? "\n\nLưu ý: định mức này dùng chung cho mọi dự án có công tác này."
        : "";
    if (!await confirmNear(`⚠ Bạn có chắc chắn muốn XOÁ ${ids.length} ${noun} đã chọn không?${extra}\n\nThao tác này không hoàn tác được.`)) return;
    start(async () => {
      if (kind === "dtcp") await deleteDtcpLinesAction(projectId, ids);
      else if (kind === "sub") await deleteSubItemsAction(projectId, ids);
      else if (kind === "nc-manual" || kind === "tb-manual") await deleteManualItemsAction(projectId, ids);
      else await deleteWorkItemResourceLinesAction(ids);
      setAll(false);
    });
  }

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600">
      <span className={count > 0 ? "font-semibold text-slate-900" : ""}>
        Đã chọn {count} {noun}
      </span>
      <button
        type="button"
        disabled={count === 0 || pending}
        onClick={remove}
        className="rounded bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Đang xoá..." : `Xoá các ${noun} đã chọn`}
      </button>
      <button type="button" onClick={() => setAll(true)} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
        Chọn tất cả
      </button>
      <button type="button" disabled={count === 0} onClick={() => setAll(false)} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-40">
        Bỏ chọn
      </button>
      <span className="ml-auto text-slate-400">Mẹo: bấm 1 ô, giữ Shift rồi bấm ô khác để chọn cả đoạn</span>
    </div>
  );
}
