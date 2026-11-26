"use client";

import { useMemo, useState, useTransition } from "react";
import { setSubMgmtRatesAction, applyHeadingSubAction, deleteHeadingSubAction } from "@/lib/actions";
import { confirmNear } from "@/app/(app)/confirm-near";
import { fmtQty } from "@/lib/fmt-qty";

export type HeadingItem = { id: string; stt: string; name: string; qty: number; unit: string; givenPct: number };
export type HeadingAssign = { assignId: string; contractorName: string; percent: number; coverVT: boolean; coverTB: boolean; coverNC: boolean; itemIds: string[] };

const fmtQ = fmtQty;
const scopeText = (a: { coverVT: boolean; coverTB: boolean; coverNC: boolean }) => [a.coverVT && "Vật tư", a.coverTB && "Thiết bị", a.coverNC && "Nhân công"].filter(Boolean).join(" + ") || "chưa chọn";

// Bảng "Giao thầu phụ cho đầu mục lớn": chọn % khối lượng giao + phạm vi thầu phụ bao + các công tác con áp dụng; mỗi công tác con tự có 1 phần giao.
// rates: tỷ lệ chi phí quản lý VT / TB TMN cấp đã khai báo theo tên nhà thầu (dùng chung với sheet TH Thầu Phụ)
export default function HeadingSubDialog({ projectId, headingId, headingText, items, assigns, rates = {} }: { projectId: string; headingId: string; headingText: string; items: HeadingItem[]; assigns: HeadingAssign[]; rates?: Record<string, { vt: number; tb: number }> }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [pct, setPct] = useState("30");
  const [cover, setCover] = useState({ coverVT: true, coverTB: false, coverNC: true });
  const [picked, setPicked] = useState<Set<string>>(new Set(items.map((i) => i.id)));
  // chi phí quản lý vật tư / thiết bị TMN cấp cho nhà thầu này (theo tên nhà thầu - áp cho mọi công tác của nhà thầu đó)
  const [mgVt, setMgVt] = useState("");
  const [mgTb, setMgTb] = useState("");
  const loadRates = (n: string) => {
    const r = rates[n.trim()];
    setMgVt(r?.vt ? String(r.vt) : "");
    setMgTb(r?.tb ? String(r.tb) : "");
  };
  const num = (v: string) => Math.max(0, Math.min(100, Number(v.replace(",", ".")) || 0));
  const pctNum = Math.max(0, Math.min(100, Number(pct.replace(",", ".")) || 0));
  const totalQty = useMemo(() => items.filter((i) => picked.has(i.id)).reduce((s, i) => s + i.qty, 0), [items, picked]);

  function reset(a?: HeadingAssign) {
    setEditId(a?.assignId ?? null);
    setName(a?.contractorName ?? "");
    loadRates(a?.contractorName ?? "");
    setPct(a ? String(+a.percent.toFixed(2)) : "30");
    setCover(a ? { coverVT: a.coverVT, coverTB: a.coverTB, coverNC: a.coverNC } : { coverVT: true, coverTB: false, coverNC: true });
    setPicked(new Set(a ? a.itemIds : items.map((i) => i.id)));
  }
  const submit = () =>
    start(async () => {
      await applyHeadingSubAction(projectId, headingId, { assignId: editId, contractorName: name, percent: pctNum, itemIds: [...picked], ...cover });
      const old = rates[name.trim()] ?? { vt: 0, tb: 0 };
      if (name.trim() && (num(mgVt) !== old.vt || num(mgTb) !== old.tb)) {
        const r = await setSubMgmtRatesAction(projectId, name, { vtPct: num(mgVt), tbPct: num(mgTb) });
        if (!r.ok) window.alert(r.error);
      }
      reset();
    });
  const noScope = !cover.coverVT && !cover.coverTB && !cover.coverNC;
  // % đã giao ở các lần giao khác của từng công tác → cảnh báo nếu tổng vượt 100%
  const overItems = items.filter((i) => picked.has(i.id) && i.givenPct - (editId ? (assigns.find((a) => a.assignId === editId)?.percent ?? 0) : 0) + pctNum > 100.0001);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        title="Giao thầu phụ cho cả đầu mục này: chọn % khối lượng, phạm vi bao (vật tư / thiết bị / nhân công) và các công tác con áp dụng"
        className={`ml-2 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium ${assigns.length ? "border-orange-400 bg-orange-100 text-orange-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
      >
        ⚑ Giao thầu phụ{assigns.length ? ` (${assigns.length})` : ""}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className={`my-6 w-full max-w-3xl rounded-lg bg-white p-4 text-sm font-normal text-slate-800 shadow-2xl ${pending ? "opacity-70" : ""}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Giao thầu phụ cho đầu mục</h3>
                <p className="text-xs text-slate-500">{headingText}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-lg leading-none text-slate-500 hover:text-slate-800">
                ×
              </button>
            </div>

            {assigns.length > 0 && (
              <div className="mt-3 rounded border border-orange-200 bg-orange-50 p-2">
                <div className="mb-1 text-xs font-semibold text-orange-800">Các lần giao đã có</div>
                {assigns.map((a) => (
                  <div key={a.assignId} className={`flex flex-wrap items-center justify-between gap-2 py-0.5 text-xs ${editId === a.assignId ? "font-semibold" : ""}`}>
                    <span>
                      {a.contractorName || "(chưa nhập thầu phụ)"} — giao <b>{+a.percent.toFixed(2)}%</b> khối lượng — bao {scopeText(a)} — {a.itemIds.length} công tác
                    </span>
                    <span className="flex gap-3">
                      <button type="button" onClick={() => reset(a)} className="text-blue-700 underline">
                        Sửa
                      </button>
                      <button type="button" onClick={async () => await confirmNear("Xoá lần giao thầu phụ này (các công tác con trở về tự làm hết)?") && start(() => void deleteHeadingSubAction(projectId, a.assignId))} className="text-red-600 underline">
                        Xoá
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 rounded border border-slate-200 p-3">
              <div className="mb-2 text-xs font-semibold text-slate-700">{editId ? "Sửa lần giao" : "＋ Lần giao mới"}</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs">
                  Tên thầu phụ
                  <input value={name} onChange={(e) => setName(e.target.value)} onBlur={(e) => rates[e.currentTarget.value.trim()] && loadRates(e.currentTarget.value)} placeholder="VD: Công ty ABC (có thể nhập sau)" className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm" />
                </label>
                <div className="text-xs">
                  Giao bao nhiêu % khối lượng
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    <input value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" className="w-16 rounded border border-slate-300 px-2 py-1 text-right text-sm" />
                    <span>%</span>
                    {[10, 25, 30, 50, 70, 100].map((v) => (
                      <button key={v} type="button" onClick={() => setPct(String(v))} className={`rounded border px-1.5 py-0.5 ${pctNum === v ? "border-blue-500 bg-blue-100 text-blue-800" : "border-slate-300 hover:bg-slate-50"}`}>
                        {v}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-3 text-xs">
                Thầu phụ bao:
                <div className="mt-1 flex flex-wrap items-center gap-4">
                  {(["coverVT", "coverTB", "coverNC"] as const).map((k) => (
                    <label key={k} className="flex cursor-pointer items-center gap-1 text-sm">
                      <input type="checkbox" checked={cover[k]} onChange={(e) => setCover({ ...cover, [k]: e.target.checked })} />
                      {k === "coverVT" ? "Vật tư" : k === "coverTB" ? "Thiết bị" : "Nhân công"}
                    </label>
                  ))}
                  <button type="button" onClick={() => setCover({ coverVT: true, coverTB: true, coverNC: true })} className="text-blue-700 underline">
                    Trọn gói (cả 3)
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded bg-violet-50 px-2 py-1.5 text-xs text-violet-900">
                Chi phí quản lý vật tư / thiết bị TMN cấp cho thầu phụ:
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <label className={`flex items-center gap-1 ${cover.coverVT ? "opacity-40" : ""}`} title={cover.coverVT ? "Thầu phụ đã bao vật tư - TMN không cấp" : "% trên giá trị vật tư TMN cấp"}>
                    Vật tư
                    <input value={cover.coverVT ? "" : mgVt} disabled={cover.coverVT} onChange={(e) => setMgVt(e.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" placeholder="0" className="w-14 rounded border border-violet-300 bg-white px-1.5 py-0.5 text-right" />%
                  </label>
                  <label className={`flex items-center gap-1 ${cover.coverTB ? "opacity-40" : ""}`} title={cover.coverTB ? "Thầu phụ đã bao thiết bị - TMN không cấp" : "% trên giá trị thiết bị TMN cấp"}>
                    Thiết bị
                    <input value={cover.coverTB ? "" : mgTb} disabled={cover.coverTB} onChange={(e) => setMgTb(e.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" placeholder="0" className="w-14 rounded border border-violet-300 bg-white px-1.5 py-0.5 text-right" />%
                  </label>
                  <span className="text-[11px] text-violet-700/80">{name.trim() ? `áp cho mọi công tác của "${name.trim()}"` : "nhập tên thầu phụ để áp"} · hiện ở sheet CHI TIẾT và cộng vào giá trị thầu phụ</span>
                </div>
              </div>

              <div className="mt-3 text-xs">
                <div className="mb-1 flex items-center justify-between">
                  <span>Áp dụng cho các công tác con ({picked.size}/{items.length}):</span>
                  <span className="flex gap-3">
                    <button type="button" onClick={() => setPicked(new Set(items.map((i) => i.id)))} className="text-blue-700 underline">
                      Chọn tất cả
                    </button>
                    <button type="button" onClick={() => setPicked(new Set())} className="text-slate-500 underline">
                      Bỏ chọn hết
                    </button>
                  </span>
                </div>
                <div className="max-h-52 overflow-y-auto rounded border border-slate-200">
                  {items.length === 0 && <p className="p-2 text-slate-400">Đầu mục này chưa có công tác chiết tính nào.</p>}
                  {items.map((i) => (
                    <label key={i.id} className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-2 py-0.5 last:border-0 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={picked.has(i.id)}
                        onChange={(e) =>
                          setPicked((p) => {
                            const n = new Set(p);
                            if (e.target.checked) n.add(i.id);
                            else n.delete(i.id);
                            return n;
                          })
                        }
                      />
                      <span className="w-10 shrink-0 text-slate-400">{i.stt}</span>
                      <span className="min-w-0 flex-1 truncate">{i.name}</span>
                      <span className="shrink-0 text-slate-500">
                        {fmtQ(i.qty)} {i.unit}
                      </span>
                      {i.givenPct > 0 && <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] text-amber-700">đã giao {+i.givenPct.toFixed(0)}%</span>}
                    </label>
                  ))}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className={`text-xs ${overItems.length ? "font-semibold text-red-600" : "text-slate-600"}`}>
                  {overItems.length
                    ? `⚠ ${overItems.length} công tác sẽ bị giao quá 100% khối lượng`
                    : `Sẽ giao ${+pctNum.toFixed(2)}% của ${picked.size} công tác (≈ ${fmtQ((totalQty * pctNum) / 100)} / ${fmtQ(totalQty)} khối lượng); phần còn lại mình tự làm.`}
                </p>
                <div className="flex gap-2">
                  {editId && (
                    <button type="button" onClick={() => reset()} className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50">
                      Huỷ sửa
                    </button>
                  )}
                  <button type="button" disabled={pending || picked.size === 0 || noScope || pctNum <= 0} onClick={submit} className="rounded bg-orange-600 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                    {editId ? "Cập nhật lần giao" : "Áp dụng giao thầu"}
                  </button>
                </div>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">Đơn giá thầu phụ của từng công tác nhập ở sheet TH Thầu Phụ (mỗi phần giao là 1 dòng). Khối lượng phần giao tự theo % khi khối lượng BOQ thay đổi.</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
