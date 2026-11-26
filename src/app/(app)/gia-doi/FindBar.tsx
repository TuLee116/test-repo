"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// TÌM KIẾM KIỂU EXCEL (Ctrl+F) trên các trang Đệ trình giá: sổ giá, lịch sử giá, lũy kế, danh sách hồ sơ, bảng duyệt.
// Tìm trong mọi ô bảng (kể cả ô đang nhập và phần "Lịch sử" đang thu gọn), không phân biệt dấu / hoa thường;
// gõ số thì bỏ qua dấu chấm phân cách (gõ 150000 vẫn tìm ra 150.000).
// Enter = kết quả tiếp, Shift+Enter = kết quả trước, Esc = đóng.

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ");
const digits = (s: string) => s.replace(/[.,\s]/g, "");

export default function FindBar({ scopeId }: { scopeId: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [count, setCount] = useState(0);
  const [idx, setIdx] = useState(-1);
  const hits = useRef<HTMLElement[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const path = usePathname();
  const search = useSearchParams();

  const clear = () => {
    document.querySelectorAll("[data-find]").forEach((el) => el.removeAttribute("data-find"));
    hits.current = [];
  };

  const go = useCallback((i: number) => {
    const list = hits.current;
    if (!list.length) return setIdx(-1);
    const k = ((i % list.length) + list.length) % list.length;
    list.forEach((el, j) => el.setAttribute("data-find", j === k ? "2" : "1"));
    const el = list[k];
    for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
    el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    setIdx(k);
  }, []);

  const run = useCallback(
    (text: string, keep = false) => {
      clear();
      const needle = norm(text.trim());
      const scope = document.getElementById(scopeId);
      if (!needle || !scope) {
        setCount(0);
        setIdx(-1);
        return;
      }
      const num = /^[\d.,\s]+$/.test(needle) ? digits(needle) : "";
      const cells = [...scope.querySelectorAll<HTMLElement>("td")].filter((td) => !td.querySelector("td"));
      hits.current = cells.filter((td) => {
        const vals = [...td.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].map((x) => x.value).join(" ");
        const hay = norm(`${td.textContent ?? ""} ${vals}`);
        return hay.includes(needle) || (!!num && digits(hay).includes(num));
      });
      setCount(hits.current.length);
      go(keep ? Math.max(idx, 0) : 0);
    },
    [scopeId, go, idx],
  );

  // Ctrl+F mở thanh tìm (thay hộp tìm của trình duyệt), Esc đóng
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => {
          input.current?.focus();
          input.current?.select();
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // đổi trang / tab: bỏ đánh dấu cũ (đặt lại số kết quả ngay lúc render, xoá tô màu trong effect)
  const pageKey = `${path}?${search.toString()}`;
  const [seen, setSeen] = useState(pageKey);
  if (seen !== pageKey) {
    setSeen(pageKey);
    setCount(0);
    setIdx(-1);
  }
  useEffect(() => clear(), [pageKey]);

  // gõ tới đâu tìm tới đó
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => run(q), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open]);

  const close = () => {
    clear();
    setOpen(false);
    setCount(0);
    setIdx(-1);
  };

  if (!open) return null;
  return (
    <div className="fixed right-4 top-16 z-[70] flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-2 shadow-lg">
      <span className="text-xs font-medium text-slate-500">Tìm</span>
      <input
        ref={input}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            // bảng có thể vừa đổi (thêm dòng, mở tab): tìm lại rồi mới nhảy
            if (!hits.current.length || !hits.current.every((el) => el.isConnected)) run(q, true);
            else go(idx + (e.shiftKey ? -1 : 1));
          } else if (e.key === "Escape") close();
        }}
        placeholder="Tên công việc, đội, đơn giá..."
        className="w-64 rounded border border-slate-300 px-2 py-1 text-sm"
      />
      <span className="min-w-[56px] text-center text-xs text-slate-500">{q.trim() ? (count ? `${idx + 1}/${count}` : "0 kết quả") : ""}</span>
      <button type="button" onClick={() => go(idx - 1)} disabled={!count} className="rounded border border-slate-300 px-2 py-0.5 text-sm disabled:opacity-40" title="Kết quả trước (Shift+Enter)">
        ↑
      </button>
      <button type="button" onClick={() => go(idx + 1)} disabled={!count} className="rounded border border-slate-300 px-2 py-0.5 text-sm disabled:opacity-40" title="Kết quả tiếp (Enter)">
        ↓
      </button>
      <button type="button" onClick={close} className="px-1 text-slate-400 hover:text-slate-700" title="Đóng (Esc)">
        ✕
      </button>
    </div>
  );
}
