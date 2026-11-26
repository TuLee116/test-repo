"use client";

import { useRef, useState, useTransition } from "react";
import { createProjectResourceAction, setLineResourceSwapAction } from "@/lib/actions";

type Opt = { id: string; name: string; unit: string; unitPrice: number };

// Nút ⇄ ở dòng hao phí của CHI TIẾT: đổi vật liệu của dòng này (VD loại gạch / đá theo spec CĐT) chỉ cho dòng BOQ đang xem
// (hoặc mọi dòng BOQ dùng cùng định mức). Vật liệu lấy từ danh sách riêng của dự án, tạo mới ngay tại đây.
export default function ResourceSwapCell({
  projectId,
  boqItemId,
  lineId,
  category,
  currentId,
  swapped,
  options,
  sameNormCount,
}: {
  projectId: string;
  boqItemId: string;
  lineId: string;
  category: "VT" | "NC" | "TB";
  currentId: string;
  swapped: boolean;
  options: Opt[];
  sameNormCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [all, setAll] = useState(false);
  const [draft, setDraft] = useState({ name: "", unit: "m2", price: "" });
  const [pending, start] = useTransition();
  const btn = useRef<HTMLButtonElement>(null);
  const isNC = category === "NC";
  const noun = isNC ? "nhân công" : "vật liệu";
  const pick = (id: string | null) =>
    start(async () => {
      await setLineResourceSwapAction(projectId, boqItemId, lineId, id, all);
      setOpen(false);
    });
  return (
    <>
      <button
        ref={btn}
        type="button"
        title={isNC ? "Chọn / đổi tên nhân công cho dòng BOQ này" : swapped ? "Đã đổi vật liệu cho dòng BOQ này — bấm để đổi lại / chọn loại khác" : "Đổi loại vật liệu cho dòng BOQ này (VD gạch / đá theo spec CĐT)"}
        onClick={() => {
          const r = btn.current?.getBoundingClientRect();
          if (r) setPos({ x: Math.max(8, Math.min(r.left, window.innerWidth - 340)), y: Math.min(r.bottom + 4, window.innerHeight - 380) });
          setOpen((o) => !o);
        }}
        className={`ml-1 rounded px-1 text-[11px] not-italic ${swapped ? "bg-amber-100 font-semibold text-amber-700" : "text-blue-600 hover:bg-blue-50"}`}
      >
        {swapped && !isNC ? "⇄ đã đổi" : "⇄"}
      </button>
      {open && (
        <div className="fixed inset-0 z-50" onClick={() => setOpen(false)}>
          <div style={{ left: pos.x, top: pos.y }} className="absolute w-80 rounded-md border border-slate-300 bg-white p-2 text-xs not-italic shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 font-semibold text-slate-700">Chọn {noun} cho dòng này</div>
            <div className="max-h-44 overflow-y-auto">
              {options.length === 0 && <p className="px-1 py-2 text-slate-400">Dự án chưa có {noun} riêng nào — tạo mới ở bên dưới.</p>}
              {options.map((o) => (
                <button key={o.id} type="button" disabled={pending} onClick={() => pick(o.id)} className={`flex w-full items-baseline justify-between gap-2 rounded px-1.5 py-1 text-left hover:bg-blue-50 ${o.id === currentId ? "bg-blue-100 font-semibold" : ""}`}>
                  <span>
                    {o.name} <span className="text-slate-400">({o.unit})</span>
                  </span>
                  <span className="whitespace-nowrap font-mono text-slate-500">{Math.round(o.unitPrice).toLocaleString("vi-VN")}</span>
                </button>
              ))}
            </div>
            {swapped && (
              <button type="button" disabled={pending} onClick={() => pick(null)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-left text-slate-700 hover:bg-slate-50">
                ↺ Về {noun} mặc định của định mức
              </button>
            )}
            {sameNormCount > 1 && (
              <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-slate-700">
                <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
                Áp dụng cho cả {sameNormCount} dòng BOQ dùng cùng định mức
              </label>
            )}
            <div className="mt-2 border-t border-slate-200 pt-2">
              <div className="mb-1 font-semibold text-slate-700">＋ Tạo {noun} mới của dự án</div>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={isNC ? "Tên công việc (VD: Đổ bê tông lót móng)" : "Tên (VD: Gạch granite 600x600 sảnh)"} className="mb-1 w-full rounded border border-slate-300 px-1.5 py-1" />
              <div className="flex gap-1">
                <input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="ĐVT" className="w-16 rounded border border-slate-300 px-1.5 py-1" />
                <input value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value.replace(/[^\d]/g, "") })} placeholder="Đơn giá" inputMode="numeric" className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-1 text-right" />
                <button
                  type="button"
                  disabled={pending || !draft.name.trim()}
                  onClick={() =>
                    start(async () => {
                      const id = await createProjectResourceAction(projectId, { name: draft.name, unit: draft.unit, unitPrice: Number(draft.price) || 0, category });
                      await setLineResourceSwapAction(projectId, boqItemId, lineId, id, all);
                      setDraft({ name: "", unit: draft.unit, price: "" });
                      setOpen(false);
                    })
                  }
                  className="rounded bg-blue-600 px-2 py-1 font-medium text-white disabled:opacity-40"
                >
                  Tạo &amp; chọn
                </button>
              </div>
              <p className="mt-1 text-[10px] text-slate-400">{isNC ? "Đơn giá chỉnh tiếp ở sheet TH Nhân Công." : "Đơn giá, VAT và hao hụt chỉnh tiếp ở sheet TH Vật Tư. Đổi spec giữa chừng: chọn lại loại khác ở đây."}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
