"use client";

import { useState, useTransition } from "react";
import NumInput from "@/app/(app)/NumInput";
import { toast } from "@/app/(app)/EnterDown";
import { setSubPriceFromQuotedAction } from "@/lib/actions";

// Tạm tính đơn giá thầu phụ = x% × đơn giá đang báo CĐT (sheet TH Thầu Phụ) cho các dòng của 1 đầu mục / cả sheet,
// khi chưa có giá thầu phụ duyệt. Tỷ lệ lần trước nhớ trong trình duyệt.
export default function QuotedPctButton({ projectId, itemIds, label = "% giá CĐT", title }: { projectId: string; itemIds: string[]; label?: string; title?: string }) {
  // vị trí khung (cố định theo màn hình - bảng nằm trong khung cuộn nên không đặt tuyệt đối được)
  const [open, setOpen] = useState<{ left: number; top: number } | null>(null);
  const [pct, setPct] = useState(() => {
    try {
      return Number(localStorage.getItem("tp-quoted-pct")) || 80;
    } catch {
      return 80;
    }
  });
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const [pending, start] = useTransition();
  if (itemIds.length === 0) return null;

  function apply() {
    try {
      localStorage.setItem("tp-quoted-pct", String(pct));
    } catch {}
    start(async () => {
      const r = await setSubPriceFromQuotedAction(projectId, itemIds, pct, onlyEmpty);
      if (!r.ok) return window.alert(r.error ?? "Không tạm tính được");
      setOpen(null);
      const extra = [r.kept && `${r.kept} dòng đã có giá giữ nguyên`, r.noQuoted && `${r.noQuoted} dòng chưa có giá báo CĐT`].filter(Boolean).join(", ");
      toast(`Đã tạm tính ${r.count} dòng = ${pct}% giá báo CĐT${extra ? ` (${extra})` : ""}`);
    });
  }

  return (
    <span className="inline-block">
      <button
        type="button"
        onClick={(e) => {
          if (open) return setOpen(null);
          const r = e.currentTarget.getBoundingClientRect();
          setOpen({ left: Math.max(8, Math.min(r.right - 288, window.innerWidth - 296)), top: r.bottom + 260 > window.innerHeight ? Math.max(8, r.top - 252) : r.bottom + 4 });
        }}
        title={title ?? "Tạm tính đơn giá thầu phụ theo % đơn giá đang báo CĐT (khi chưa có giá thầu phụ duyệt)"}
        className="whitespace-nowrap rounded border border-violet-300 bg-violet-50 px-1.5 py-0.5 text-[11px] font-normal text-violet-800 hover:bg-violet-100"
      >
        {label}
      </button>
      {open && (
        <div style={{ left: open.left, top: open.top }} className="fixed z-50 w-72 rounded-md border border-slate-300 bg-white p-3 text-left text-xs font-normal text-slate-700 shadow-lg">
          <div className="font-medium text-slate-900">Tạm tính đơn giá thầu phụ</div>
          <div className="mt-2 flex items-center gap-2">
            Đơn giá thầu phụ =
            <NumInput value={pct} decimals suffix="%" onLive={(v) => setPct(v)} onCommit={(v) => setPct(v ?? 80)} className="w-16 rounded border border-slate-300 px-1 py-0.5 text-right" />
            × giá báo CĐT
          </div>
          <label className="mt-2 flex items-center gap-1.5">
            <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} className="h-3.5 w-3.5" />
            Chỉ điền dòng chưa có đơn giá (không đè giá đã nhập)
          </label>
          <p className="mt-1 text-[11px] text-slate-500">Áp cho {itemIds.length} dòng. Dòng chưa có giá báo CĐT ở BOQ sẽ bỏ qua. Giá là số tạm tính — sửa lại khi có giá thầu phụ duyệt.</p>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(null)} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
              Huỷ
            </button>
            <button type="button" disabled={pending || !(pct > 0)} onClick={apply} className="rounded bg-violet-700 px-3 py-1 font-medium text-white hover:bg-violet-800 disabled:opacity-50">
              {pending ? "Đang áp dụng..." : "Áp dụng"}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
