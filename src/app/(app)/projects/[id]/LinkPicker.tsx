"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GridSourceOption } from "@/lib/grid-sources-shared";

// Nút "🔗 Liên kết sheet": chọn sheet → chọn khoản chi phí cần lấy giá trị, rồi chèn LINK("khoá") vào công thức đang gõ.
// Nút và danh sách không lấy mất con trỏ khỏi ô đang sửa (onMouseDown preventDefault), trừ ô tìm kiếm.
export default function LinkPicker({ options, values, onPick }: { options: GridSourceOption[]; values: Record<string, number>; onPick: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sheet, setSheet] = useState<string | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  // Khung nổi canh theo mép TRÁI của nút (mở sang phải), luôn nằm trong màn hình - nút sát lề trái thì
  // không bị tràn ra ngoài; bám theo khi cuộn trang
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(416, window.innerWidth - 16);
      setPos({ width, top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);
  const sheets = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of options) m.set(o.group, (m.get(o.group) ?? 0) + 1);
    return [...m.entries()];
  }, [options]);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = new Map<string, GridSourceOption[]>();
    for (const o of options) {
      if (q ? !(o.label.toLowerCase().includes(q) || o.group.toLowerCase().includes(q)) : sheet !== o.group) continue;
      out.set(o.group, [...(out.get(o.group) ?? []), o]);
    }
    return [...out.entries()];
  }, [options, query, sheet]);
  const close = () => {
    setOpen(false);
    setSheet(null);
    setQuery("");
  };
  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? close() : setOpen(true))}
        title="Chèn giá trị lấy từ sheet khác (BOQ, TH Vật Tư / Nhân Công / Thiết Bị / Thầu Phụ...) vào công thức"
        className="whitespace-nowrap rounded border border-blue-300 bg-blue-50 px-2 py-1 text-[13px] font-medium text-blue-700 hover:bg-blue-100"
      >
        🔗 Liên kết sheet
      </button>
      {open && pos && (
        <div
          style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width }}
          className="z-50 rounded-md border border-slate-300 bg-white p-2 text-left font-normal shadow-lg"
          onMouseDown={(e) => {
            if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
          }}
        >
          <p className="mb-1 text-[11px] text-slate-500">Chọn sheet, rồi chọn chi phí cần lấy (VD =LINK(&quot;boq_work&quot;)*30%*A1/12). Con trỏ đang sửa ô nào thì chèn vào ô đó.</p>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm nhanh trong mọi sheet (VD: thiết bị, gói thầu…)" className="mb-1 w-full rounded border border-slate-300 px-2 py-1 text-xs" />
          {!query.trim() && sheet === null ? (
            <div className="max-h-72 overflow-y-auto">
              <div className="px-1 pb-1 text-[11px] font-semibold uppercase text-slate-500">Chọn sheet</div>
              {sheets.map(([g, n]) => (
                <button key={g} type="button" onClick={() => setSheet(g)} className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-blue-50">
                  <span className="font-medium">{g}</span>
                  <span className="text-xs text-slate-400">{n} mục ›</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              {!query.trim() && (
                <button type="button" onClick={() => setSheet(null)} className="mb-1 w-full px-1 py-1 text-left text-xs font-medium text-blue-700 hover:underline">
                  ‹ Chọn sheet khác — đang xem: {sheet}
                </button>
              )}
              {groups.length === 0 && <p className="px-1 py-2 text-xs text-slate-400">Không có nguồn nào khớp.</p>}
              {groups.map(([group, opts]) => (
                <div key={group} className="mb-1">
                  {query.trim() && <div className="sticky top-0 bg-slate-100 px-1 py-0.5 text-[11px] font-semibold uppercase text-slate-500">{group}</div>}
                  {opts.map((o) => (
                    o.disabled ? (
                      <div key={o.value} title={o.disabled} className="flex w-full cursor-not-allowed items-baseline justify-between gap-2 px-1 py-1 text-left text-xs text-slate-400">
                        <span>
                          {o.label}
                          <span className="ml-1 text-[10px] italic">— không dùng được ở đây (rê chuột xem lý do)</span>
                        </span>
                      </div>
                    ) : (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => {
                        onPick(o.value);
                        close();
                      }}
                      className="flex w-full items-baseline justify-between gap-2 px-1 py-1 text-left text-xs hover:bg-blue-50"
                    >
                      <span>{o.label}</span>
                      <span className="whitespace-nowrap font-mono text-slate-500">{Math.round(values[o.value] ?? 0).toLocaleString("vi-VN")}</span>
                    </button>
                    )
                  ))}
                </div>
              ))}
            </div>
          )}
          <button type="button" onClick={close} className="mt-1 text-[11px] text-slate-500 underline">
            Đóng
          </button>
        </div>
      )}
    </div>
  );
}
