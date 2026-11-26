"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { deleteBoqItemsAction, renumberBoqAction, setBoqHeadingLevelAction } from "@/lib/actions";
import { confirmNear } from "@/app/(app)/confirm-near";

// Thanh chọn nhiều dòng BOQ để xoá hàng loạt. Ô tick là <input data-boq-check="id" data-stt="..."> đặt sẵn trong bảng;
// bấm 1 ô rồi Shift + bấm ô khác để chọn cả đoạn.
export default function BoqBulkBar({ projectId }: { projectId: string }) {
  const [count, setCount] = useState(0);
  const [stt, setStt] = useState("TT");
  const [pending, start] = useTransition();
  const last = useRef<number | null>(null);

  const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>("input[data-boq-check]"));
  const refresh = () => setCount(boxes().filter((c) => c.checked).length);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      if (t.hasAttribute("data-boq-check")) {
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
      } else if (t.hasAttribute("data-boq-checkall")) {
        boxes().forEach((c) => (c.checked = t.checked));
        refresh();
      }
    };
    document.addEventListener("click", onClick);
    // bảng đổi (xoá / thêm dòng) → cập nhật lại số dòng đang chọn
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
  }, []);

  function clearAll() {
    boxes().forEach((c) => (c.checked = false));
    document.querySelectorAll<HTMLInputElement>("input[data-boq-checkall]").forEach((c) => (c.checked = false));
    refresh();
  }

  function selectByStt() {
    const key = stt.trim().toLowerCase();
    if (!key) return;
    boxes().forEach((c) => {
      if ((c.dataset.stt ?? "").trim().toLowerCase() === key) c.checked = true;
    });
    refresh();
  }

  // Đặt cấp cho các ĐẦU MỤC đang được chọn (ô tick có data-depth)
  function setLevel(v: string) {
    if (!v) return;
    const ids = boxes()
      .filter((c) => c.checked && c.dataset.depth !== undefined)
      .map((c) => c.dataset.boqCheck as string);
    if (ids.length === 0) {
      window.alert("Hãy tick các dòng ĐẦU MỤC (nền vàng) cần đặt cấp.");
      return;
    }
    start(async () => {
      await setBoqHeadingLevelAction(projectId, ids, v === "auto" ? null : Number(v));
    });
  }

  async function remove() {
    const ids = boxes()
      .filter((c) => c.checked)
      .map((c) => c.dataset.boqCheck as string);
    if (ids.length === 0) return;
    if (!await confirmNear(`⚠ Bạn có chắc chắn muốn XOÁ ${ids.length} dòng đã chọn khỏi BOQ không?\n\nThao tác này không hoàn tác được.`)) return;
    start(async () => {
      await deleteBoqItemsAction(projectId, ids);
      clearAll();
    });
  }

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600">
      <span className={count > 0 ? "font-semibold text-slate-900" : ""}>Đã chọn {count} dòng</span>
      <button
        type="button"
        disabled={count === 0 || pending}
        onClick={remove}
        className="rounded bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Đang xoá..." : "Xoá các dòng đã chọn"}
      </button>
      <button type="button" disabled={count === 0} onClick={clearAll} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-40">
        Bỏ chọn
      </button>
      <span className="ml-2 text-slate-400">|</span>
      <span>Chọn nhanh các dòng có STT là</span>
      <input value={stt} onChange={(e) => setStt(e.target.value)} className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-center" />
      <button type="button" onClick={selectByStt} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
        Chọn
      </button>
      <span className="ml-2 text-slate-400">|</span>
      <label className="flex items-center gap-1">
        Đặt cấp cho đầu mục đã chọn:
        <select value="" disabled={pending} onChange={(e) => setLevel(e.target.value)} className="rounded border border-slate-300 bg-white px-1.5 py-1">
          <option value="">— chọn cấp —</option>
          <option value="0">Cấp 1 (lớn nhất)</option>
          <option value="1">Cấp 2</option>
          <option value="2">Cấp 3</option>
          <option value="3">Cấp 4</option>
          <option value="4">Cấp 5</option>
          <option value="auto">Tự động theo STT</option>
        </select>
      </label>
      <span className="ml-2 text-slate-400">|</span>
      <button
        type="button"
        disabled={pending}
        title="Tự đánh lại A/B/C, I/II/III, B.1, 1/2/3... theo đúng thứ tự dòng hiện tại"
        onClick={() => start(async () => void (await renumberBoqAction(projectId)))}
        className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
      >
        ↻ Đánh lại số thứ tự
      </button>
      <span className="ml-auto text-slate-400">Mẹo: bấm 1 ô, giữ Shift rồi bấm ô khác để chọn cả đoạn</span>
    </div>
  );
}
