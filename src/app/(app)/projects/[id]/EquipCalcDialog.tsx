"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import NumInput from "@/app/(app)/NumInput";
import { confirmNear } from "@/app/(app)/confirm-near";
import { toast } from "@/app/(app)/EnterDown";
import { fmtQty } from "@/lib/fmt-qty";
import {
  computeEquip,
  daysBetween,
  defaultParams,
  EQUIP_KINDS,
  PARAM_FIELDS,
  parseParams,
  priceKey,
  type EquipKind,
  type EquipParams,
  type FacadeLift,
  type FacadeParams,
  type SafetyBlock,
  type SafetyParams,
  type ShoringFloor,
  type ShoringParams,
} from "@/lib/equip-calc";
import type { EquipItemRow } from "@/lib/equip";
import { deleteEquipCalcAction, recalcAllEquipAction, saveEquipCalcAction, updateEquipItemAction } from "@/lib/equip-actions";

// Nút "Tính toán thiết bị" ở sheet TH Thiết Bị: chọn tính chống sàn / bao che / an toàn (dự án nào cần gì thì tính nấy),
// nhập thông số → xem trước số lượng từng cấu kiện + chi phí → lưu thì kết quả thành 1 đầu mục lớn ở TH Thiết Bị.
// Tab "Đơn giá thiết bị": giá thuê theo từng NCC, giá dùng (mặc định cao nhất), giá mua + % hao hụt - dùng chung mọi dự án.

export type EquipCalcRow = { id: string; kind: string; name: string; params: string; updatedAt: string };

const fm = (n: number) => Math.round(n).toLocaleString("vi-VN");
const inp = "w-full rounded border border-slate-300 px-1.5 py-1 text-xs";
const th = "border border-slate-200 bg-slate-50 px-2 py-1 text-left font-medium text-slate-600";
const td = "border border-slate-200 px-1 py-0.5";

type Draft = { id?: string; kind: EquipKind; name: string; params: EquipParams };

export default function EquipCalcDialog({ projectId, calcs, items }: { projectId: string; calcs: EquipCalcRow[]; items: EquipItemRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"calc" | "price">("calc");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const openCalc = (c: EquipCalcRow) => {
    const kind = c.kind as EquipKind;
    setDraft({ id: c.id, kind, name: c.name, params: parseParams(kind, c.params) });
    setMsg("");
  };
  const newCalc = (kind: EquipKind) => {
    setDraft({ kind, name: EQUIP_KINDS.find((k) => k.kind === kind)!.group, params: defaultParams(kind) });
    setMsg("");
  };

  const save = () =>
    draft &&
    start(async () => {
      const r = await saveEquipCalcAction(projectId, { id: draft.id, kind: draft.kind, name: draft.name, params: draft.params });
      if (!r.ok) return setMsg(r.error ?? "Lưu không thành công");
      // lưu xong: đóng cửa sổ, quay về sheet TH Thiết Bị (đã cập nhật)
      setDraft(null);
      setMsg("");
      setOpen(false);
      toast(`Đã lưu và cập nhật vào TH Thiết Bị (đầu mục "${draft.name.toUpperCase()}")`);
      router.refresh();
    });

  const remove = async () => {
    if (!draft?.id) return setDraft(null);
    if (!(await confirmNear(`Xoá bản tính "${draft.name}" và các dòng nó tạo ở TH Thiết Bị?`, { okLabel: "Xoá", danger: true }))) return;
    start(async () => {
      const r = await deleteEquipCalcAction(projectId, draft.id!);
      if (!r.ok) return setMsg(r.error ?? "Xoá không thành công");
      setDraft(null);
      router.refresh();
    });
  };

  const recalcAll = () =>
    start(async () => {
      const r = await recalcAllEquipAction(projectId);
      setMsg(r.ok ? `Đã tính lại ${r.count} bản tính theo đơn giá hiện hành.` : (r.error ?? "Có lỗi"));
      router.refresh();
    });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Tính số lượng và chi phí thiết bị chống sàn, giàn giáo bao che, thiết bị an toàn rồi đưa vào sheet này"
        className="rounded border border-amber-600 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
      >
        Tính toán thiết bị
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3">
          <div className="my-2 w-full max-w-[98vw] rounded-lg bg-white shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
              <div className="flex items-center gap-3">
                <h2 className="text-base font-semibold text-slate-900">Tính toán thiết bị</h2>
                {(["calc", "price"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setTab(t)} className={`rounded px-2 py-1 text-xs ${tab === t ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                    {t === "calc" ? "Bản tính của dự án" : "Đơn giá thiết bị"}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                ✕
              </button>
            </div>

            {tab === "price" ? (
              <PriceTab items={items} onRecalc={calcs.length ? recalcAll : undefined} pending={pending} msg={msg} />
            ) : (
              <div className="flex min-h-[70vh] flex-col md:flex-row">
                <aside className="w-full shrink-0 border-b border-slate-200 p-3 md:w-64 md:border-b-0 md:border-r">
                  <div className="text-[11px] font-semibold uppercase text-slate-500">Bản tính đã có</div>
                  {calcs.length === 0 && <div className="mt-1 text-xs text-slate-400">Chưa có bản tính nào</div>}
                  <ul className="mt-1 space-y-1">
                    {calcs.map((c) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => openCalc(c)} className={`w-full rounded px-2 py-1 text-left text-xs ${draft?.id === c.id ? "bg-amber-100 font-medium" : "hover:bg-slate-100"}`}>
                          {c.name}
                          <div className="text-[10px] text-slate-400">{EQUIP_KINDS.find((k) => k.kind === c.kind)?.title}</div>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 text-[11px] font-semibold uppercase text-slate-500">Thêm bản tính</div>
                  <div className="mt-1 space-y-1.5">
                    {EQUIP_KINDS.map((k) => (
                      <button key={k.kind} type="button" onClick={() => newCalc(k.kind)} className="w-full rounded border border-slate-200 px-2 py-1.5 text-left hover:border-amber-400 hover:bg-amber-50">
                        <div className="text-xs font-medium text-slate-800">+ {k.title}</div>
                        <div className="text-[10px] leading-tight text-slate-500">{k.desc}</div>
                      </button>
                    ))}
                  </div>
                  {calcs.length > 0 && (
                    <button type="button" disabled={pending} onClick={recalcAll} className="mt-4 w-full rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50" title="Sau khi cập nhật đơn giá thiết bị: tính lại mọi bản tính và cập nhật TH Thiết Bị">
                      Tính lại tất cả theo giá mới
                    </button>
                  )}
                </aside>
                <main className="min-w-0 flex-1 p-3">
                  {msg && <div className="mb-2 rounded bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">{msg}</div>}
                  {draft ? (
                    <CalcEditor draft={draft} setDraft={(d) => setDraft(d)} items={items} onSave={save} onDelete={remove} pending={pending} />
                  ) : (
                    <div className="mt-16 text-center text-sm text-slate-400">Chọn 1 bản tính bên trái, hoặc thêm bản tính mới (chống sàn / bao che / an toàn).</div>
                  )}
                </main>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ---------------- Soạn 1 bản tính ----------------
function CalcEditor({ draft, setDraft, items, onSave, onDelete, pending }: { draft: Draft; setDraft: (d: Draft) => void; items: EquipItemRow[]; onSave: () => void; onDelete: () => void; pending: boolean }) {
  const [showParams, setShowParams] = useState(false);
  const [view, setView] = useState<"lines" | "detail">("lines");
  const result = useMemo(() => computeEquip(draft.kind, draft.params, items), [draft.kind, draft.params, items]);
  const setParams = (patch: Partial<EquipParams>) => setDraft({ ...draft, params: { ...draft.params, ...patch } as EquipParams });
  const p = draft.params as unknown as Record<string, unknown>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="block text-[11px] font-medium text-slate-600">Tên bản tính (= tên đầu mục ở TH Thiết Bị)</span>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="w-80 rounded border border-slate-300 px-2 py-1 text-sm" />
        </label>
        <span className="rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{EQUIP_KINDS.find((k) => k.kind === draft.kind)?.title}</span>
      </div>

      {draft.kind === "SHORING" && <ShoringInputs p={draft.params as ShoringParams} set={setParams} />}
      {draft.kind === "FACADE" && <FacadeInputs p={draft.params as FacadeParams} set={setParams} />}
      {draft.kind === "SAFETY" && <SafetyInputs p={draft.params as SafetyParams} set={setParams} items={items} />}

      <div className="rounded border border-slate-200">
        <button type="button" onClick={() => setShowParams((v) => !v)} className="w-full px-3 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-50">
          {showParams ? "▾" : "▸"} Định mức &amp; thông số tính (sửa được cho bản tính này)
        </button>
        {showParams && (
          <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 border-t border-slate-200 p-3 sm:grid-cols-2 lg:grid-cols-3">
            {PARAM_FIELDS[draft.kind].map((f) => (
              <label key={f.key} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-600">
                  {f.label}
                  {f.unit && <span className="text-slate-400"> ({f.unit})</span>}
                </span>
                <NumInput value={(p[f.key] as number) ?? 0} decimals onCommit={(v) => setParams({ [f.key]: v ?? 0 } as Partial<EquipParams>)} onLive={(v) => setParams({ [f.key]: v } as Partial<EquipParams>)} className="w-24 rounded border border-slate-300 px-1 py-0.5 text-right" />
              </label>
            ))}
            {draft.kind === "SHORING" &&
              (["mainSplit", "secSplit"] as const).map((k) => (
                <div key={k} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-600">{k === "mainSplit" ? "Xà gồ chính" : "Xà gồ phụ"} chia theo dài 4m / 3m / 2m (%)</span>
                  <span className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <NumInput
                        key={i}
                        value={(draft.params as ShoringParams)[k][i]}
                        decimals
                        onCommit={(v) => {
                          const arr = [...(draft.params as ShoringParams)[k]] as [number, number, number];
                          arr[i] = v ?? 0;
                          setParams({ [k]: arr } as Partial<EquipParams>);
                        }}
                        className="w-12 rounded border border-slate-300 px-1 py-0.5 text-right"
                      />
                    ))}
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>

      {result.warnings.length > 0 && <div className="rounded bg-amber-50 px-3 py-1.5 text-xs text-amber-800">{result.warnings.join(" · ")}</div>}

      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          {(["lines", "detail"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} className={`rounded px-2 py-0.5 text-xs ${view === v ? "bg-slate-800 text-white" : "border border-slate-300 text-slate-600"}`}>
              {v === "lines" ? "Kết quả đưa vào TH Thiết Bị" : `Số lượng theo ${draft.kind === "SHORING" ? "tầng" : draft.kind === "FACADE" ? "đợt giáo" : "khối"}`}
            </button>
          ))}
          <span className="ml-auto text-sm">
            Tổng chi phí: <b className="text-slate-900">{fm(result.total)}</b> đ
          </span>
        </div>
        <div className="max-h-[45vh] overflow-auto rounded border border-slate-200">
          {view === "lines" ? (
            <table className="w-full min-w-[1000px] border-collapse text-xs">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className={th}>Nội dung</th>
                  <th className={th}>ĐVT</th>
                  <th className={`${th} text-right`}>Số lượng</th>
                  <th className={`${th} text-center`}>Thuê / Mua</th>
                  <th className={`${th} text-right`}>Thời gian thuê (ngày)</th>
                  <th className={`${th} text-right`}>Đơn giá</th>
                  <th className={`${th} text-right`}>Thành tiền</th>
                  <th className={th}>Diễn giải</th>
                </tr>
              </thead>
              <tbody>
                {result.lines.map((l, i) => {
                  const key = l.code && l.mode ? priceKey(l.mode, l.code) : "";
                  const overridden = !!key && draft.params.priceOverrides?.[key] !== undefined;
                  const setPrice = (v: number | null) => {
                    if (l.paramKey) return setParams({ [l.paramKey]: v ?? 0 } as Partial<EquipParams>);
                    const next = { ...(draft.params.priceOverrides ?? {}) };
                    if (v == null) delete next[key];
                    else next[key] = v;
                    setParams({ priceOverrides: next });
                  };
                  return (
                    <tr key={i} className={l.mode === "BUY" && l.equip ? "bg-sky-50/60" : ""}>
                      <td className={td}>{l.name}</td>
                      <td className={`${td} text-center`}>{l.unit}</td>
                      <td className={`${td} text-right`}>{fmtQty(l.qty)}</td>
                      <td className={`${td} text-center`}>
                        {l.equip ? (
                          <select
                            value={l.mode}
                            onChange={(e) => setParams({ modeOverrides: { ...(draft.params.modeOverrides ?? {}), [l.code!]: e.target.value as "RENT" | "BUY" } })}
                            className="rounded border border-slate-300 px-1 py-0.5 text-xs"
                          >
                            <option value="RENT">Thuê</option>
                            <option value="BUY">Mua</option>
                          </select>
                        ) : (
                          <span className="text-[11px] text-slate-400" title={l.type === "labor" ? "Dòng nhân công được đưa sang sheet TH Nhân Công" : undefined}>{l.type === "buy" ? "Mua" : l.type === "labor" ? "Nhân công → TH Nhân Công" : ""}</span>
                        )}
                      </td>
                      <td className={`${td} w-24`}>
                        {l.mode === "RENT" && l.days !== undefined && (
                          <div className="flex items-center gap-1">
                            <NumInput
                              value={l.days}
                              onCommit={(v) => {
                                const next = { ...(draft.params.daysOverrides ?? {}) };
                                if (v == null) delete next[l.name];
                                else next[l.name] = v;
                                setParams({ daysOverrides: next });
                              }}
                              className={`${inp} text-right ${draft.params.daysOverrides?.[l.name] !== undefined ? "border-amber-400 bg-amber-50" : ""}`}
                            />
                            {draft.params.daysOverrides?.[l.name] !== undefined && (
                              <button
                                type="button"
                                title="Về số ngày theo ngày cấp / ngày trả"
                                onClick={() => {
                                  const next = { ...(draft.params.daysOverrides ?? {}) };
                                  delete next[l.name];
                                  setParams({ daysOverrides: next });
                                }}
                                className="text-[11px] text-blue-600"
                              >
                                ↺
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className={`${td} w-36`}>
                        {key || l.paramKey ? (
                          <div className="flex items-center gap-1">
                            <NumInput value={l.rate ?? 0} decimals money onCommit={setPrice} className={`${inp} text-right ${overridden ? "border-amber-400 bg-amber-50" : ""}`} />
                            <span className="whitespace-nowrap text-[10px] text-slate-400">{l.mode === "RENT" ? "đ/ngày" : `đ/${l.unit}`}</span>
                            {overridden && (
                              <button type="button" title="Về đơn giá trong bảng giá chung" onClick={() => setPrice(null)} className="text-[11px] text-blue-600">
                                ↺
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="text-right">{fm(l.unitPrice)}</div>
                        )}
                      </td>
                      <td className={`${td} text-right font-medium`}>{fm(l.amount)}</td>
                      <td className={`${td} max-w-[360px] text-[11px] text-slate-500`}>{l.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0">
                <tr>
                  <th className={th}>Cấu kiện</th>
                  <th className={th}>ĐVT</th>
                  {result.cols.map((c, i) => (
                    <th key={i} className={`${th} text-right`}>
                      {c}
                    </th>
                  ))}
                  <th className={`${th} text-right`}>Tổng</th>
                </tr>
              </thead>
              <tbody>
                {result.detail.map((d) => (
                  <tr key={d.code}>
                    <td className={td}>{d.name}</td>
                    <td className={`${td} text-center`}>{d.unit}</td>
                    {d.per.map((q, i) => (
                      <td key={i} className={`${td} text-right`}>
                        {q ? fmtQty(q) : ""}
                      </td>
                    ))}
                    <td className={`${td} text-right font-medium`}>{fmtQty(d.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending} onClick={onSave} className="rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
          {pending ? "Đang lưu..." : draft.id ? "Lưu & cập nhật TH Thiết Bị" : "Lưu & đưa vào TH Thiết Bị"}
        </button>
        <button type="button" disabled={pending} onClick={onDelete} className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
          {draft.id ? "Xoá bản tính" : "Bỏ"}
        </button>
        <span className="text-[11px] text-slate-500">Thiết bị, vật tư, vận chuyển, hao hụt → TH Thiết Bị; nhân công → TH Nhân Công. Lưu lại sẽ thay toàn bộ các dòng bản tính này đã tạo (VAT % đã đặt cho từng dòng được giữ).</span>
      </div>
    </div>
  );
}

// ---- bảng nhập dòng (tầng / đợt / khối) ----
function RowsTable<T>({ cols, rows, set, blank, render }: { cols: string[]; rows: T[]; set: (rows: T[]) => void; blank: () => T; render: (row: T, upd: (patch: Partial<T>) => void, i: number) => React.ReactNode[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-xs">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} className={th}>
                {c}
              </th>
            ))}
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {render(r, (patch) => set(rows.map((x, j) => (j === i ? { ...x, ...patch } : x))), i).map((cell, k) => (
                <td key={k} className={td}>
                  {cell}
                </td>
              ))}
              <td className={`${td} w-8 text-center`}>
                <button type="button" title="Xoá dòng" onClick={() => set(rows.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600">
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => set([...rows, blank()])} className="mt-1 rounded border border-dashed border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50">
        + Thêm dòng
      </button>
    </div>
  );
}

const Num = ({ v, on, dec = true }: { v: number; on: (n: number) => void; dec?: boolean }) => <NumInput value={v || null} decimals={dec} onCommit={(x) => on(x ?? 0)} onLive={on} className={`${inp} text-right`} />;
const Txt = ({ v, on }: { v: string; on: (s: string) => void }) => <input value={v} onChange={(e) => on(e.target.value)} className={inp} />;
const DateIn = ({ v, on }: { v: string; on: (s: string) => void }) => <input type="date" value={v} onChange={(e) => on(e.target.value)} className={inp} />;
const DaysCell = ({ start, end, days, on }: { start: string; end: string; days: number; on: (n: number) => void }) => {
  const d = daysBetween(start, end);
  return d != null ? <div className="px-1 text-right text-slate-600" title="Tính từ ngày cấp → ngày trả">{d}</div> : <Num v={days} on={on} dec={false} />;
};

function ShoringInputs({ p, set }: { p: ShoringParams; set: (patch: Partial<ShoringParams>) => void }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-700">Các tầng chống (mỗi tầng thuê riêng theo ngày cấp → ngày trả)</div>
      <RowsTable<ShoringFloor>
        cols={["Tầng", "Diện tích sàn (m2)", "Chiều cao tầng (m)", "Ngày cấp", "Ngày trả", "Số ngày thuê"]}
        rows={p.floors}
        set={(floors) => set({ floors })}
        blank={() => ({ name: `Tầng ${p.floors.length + 1}`, area: p.floors.at(-1)?.area ?? 0, height: p.floors.at(-1)?.height ?? 3.6, start: "", end: "", days: 30 })}
        render={(f, u) => [<Txt key="n" v={f.name} on={(name) => u({ name })} />, <Num key="a" v={f.area} on={(area) => u({ area })} />, <Num key="h" v={f.height} on={(height) => u({ height })} />, <DateIn key="s" v={f.start} on={(start) => u({ start })} />, <DateIn key="e" v={f.end} on={(end) => u({ end })} />, <DaysCell key="d" start={f.start} end={f.end} days={f.days} on={(days) => u({ days })} />]}
      />
    </div>
  );
}

function FacadeInputs({ p, set }: { p: FacadeParams; set: (patch: Partial<FacadeParams>) => void }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-700">Các đợt giáo bao che (thuê theo ngày cấp → ngày trả, cộng thêm {p.extraDays} ngày lắp / tháo)</div>
      <RowsTable<FacadeLift>
        cols={["Đợt giáo", "Chu vi ngoài giáo (m)", "Chiều cao đợt (m)", "Số lối đi (thang)", "Dầm I 3m (góc)", "Treo dầm I", "Ngày cấp", "Ngày trả", "Số ngày thuê"]}
        rows={p.lifts}
        set={(lifts) => set({ lifts })}
        blank={() => ({ ...(p.lifts.at(-1) ?? (defaultParams("FACADE") as FacadeParams).lifts[0]), name: `Đợt ${p.lifts.length + 1}`, start: "", end: "" })}
        render={(l, u) => [
          <Txt key="n" v={l.name} on={(name) => u({ name })} />,
          <Num key="p" v={l.perimeter} on={(perimeter) => u({ perimeter })} />,
          <Num key="h" v={l.height} on={(height) => u({ height })} />,
          <Num key="s" v={l.stairs} on={(stairs) => u({ stairs })} dec={false} />,
          <Num key="b" v={l.beams3} on={(beams3) => u({ beams3 })} dec={false} />,
          <input key="g" type="checkbox" checked={l.hung} onChange={(e) => u({ hung: e.target.checked })} title="Bỏ tick = giàn đứng trên nền (dùng chân kích + hộp kê)" />,
          <DateIn key="st" v={l.start} on={(start) => u({ start })} />,
          <DateIn key="en" v={l.end} on={(end) => u({ end })} />,
          <DaysCell key="d" start={l.start} end={l.end} days={l.days} on={(days) => u({ days })} />,
        ]}
      />
    </div>
  );
}

function SafetyInputs({ p, set, items }: { p: SafetyParams; set: (patch: Partial<SafetyParams>) => void; items: EquipItemRow[] }) {
  const pick = items.filter((i) => i.category === "An toàn" || ["CLAMP", "JB34", "TUBE"].includes(i.code));
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-xs font-medium text-slate-700">Các khối công trình (lan can biên, lan can thang bộ, cửa hoist, cửa chắn thang máy) · thuê {p.days} ngày</div>
        <RowsTable<SafetyBlock>
          cols={["Khối", "Chu vi (m)", "Số tầng", "Số thang bộ", "Số hoist", "Số thang máy", "Lan can biên"]}
          rows={p.blocks}
          set={(blocks) => set({ blocks })}
          blank={() => ({ name: `Khối ${p.blocks.length + 1}`, perimeter: 0, floors: 1, stairs: 2, hoists: 1, lifts: 0, edgeRail: false })}
          render={(b, u) => [
            <Txt key="n" v={b.name} on={(name) => u({ name })} />,
            <Num key="p" v={b.perimeter} on={(perimeter) => u({ perimeter })} />,
            <Num key="f" v={b.floors} on={(floors) => u({ floors })} dec={false} />,
            <Num key="s" v={b.stairs} on={(stairs) => u({ stairs })} dec={false} />,
            <Num key="h" v={b.hoists} on={(hoists) => u({ hoists })} dec={false} />,
            <Num key="l" v={b.lifts} on={(lifts) => u({ lifts })} dec={false} />,
            <input key="e" type="checkbox" checked={b.edgeRail} onChange={(e) => u({ edgeRail: e.target.checked })} title="Lan can quanh mép sàn (bỏ tick khi đã có giàn bao che)" />,
          ]}
        />
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-slate-700">Sàn tiếp liệu</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(() => {
            const pl = p.platforms ?? { count: 0, raises: 5, start: "", end: "", days: 0 };
            const up = (patch: Partial<typeof pl>) => set({ platforms: { ...pl, ...patch } });
            return [
              <label key="c" className="text-[11px] text-slate-600">
                Số bộ
                <Num v={pl.count} on={(count) => up({ count })} dec={false} />
              </label>,
              <label key="r" className="text-[11px] text-slate-600" title="Mỗi lần tháo sàn tiếp liệu chuyển lên tầng trên (đặt bulong chờ, lắp lại) tính 1 lần nâng. VD 1 bộ dùng lần lượt ở 6 tầng = 5 lần nâng.">
                Số lần chuyển sàn lên tầng trên / bộ
                <Num v={pl.raises} on={(raises) => up({ raises })} dec={false} />
              </label>,
              <label key="s" className="text-[11px] text-slate-600">
                Ngày lắp
                <DateIn v={pl.start} on={(start) => up({ start })} />
              </label>,
              <label key="e" className="text-[11px] text-slate-600">
                Ngày tháo
                <DateIn v={pl.end} on={(end) => up({ end })} />
              </label>,
              <label key="d" className="text-[11px] text-slate-600">
                Số ngày thuê
                <DaysCell start={pl.start} end={pl.end} days={pl.days} on={(days) => up({ days })} />
              </label>,
            ];
          })()}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-slate-700">Thiết bị khác — không tính theo khối công trình, nhập thẳng số lượng cần dùng cho cả công trình</div>
        <div className="mb-1 text-[11px] text-slate-500">VD phễu đổ bê tông, xuồng tiếp liệu, cáp / ma ní cẩu tháp, bộ đàm, gối kê… Danh sách mặc định lấy theo file khái toán mẫu; thêm / xoá / đổi số lượng tuỳ dự án (không dùng thì bấm ✕).</div>
        <RowsTable<{ code: string; qty: number }>
          cols={["Thiết bị", "Số lượng"]}
          rows={p.others}
          set={(others) => set({ others })}
          blank={() => ({ code: pick[0]?.code ?? "", qty: 1 })}
          render={(o, u) => [
            <select key="c" value={o.code} onChange={(e) => u({ code: e.target.value })} className={inp}>
              {pick.map((i) => (
                <option key={i.code} value={i.code}>
                  {i.name} ({i.unit}) · {i.mode === "RENT" ? "thuê" : "mua"}
                </option>
              ))}
            </select>,
            <Num key="q" v={o.qty} on={(qty) => u({ qty })} />,
          ]}
        />
      </div>
    </div>
  );
}

// ---------------- Đơn giá thiết bị (dùng chung) ----------------
function PriceTab({ items, onRecalc, pending, msg }: { items: EquipItemRow[]; onRecalc?: () => void; pending: boolean; msg: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [newNcc, setNewNcc] = useState("");
  const [extraNcc, setExtraNcc] = useState<string[]>([]);
  const nccs = useMemo(() => [...new Set([...items.flatMap((i) => Object.keys(i.supplierPrices)), ...extraNcc])], [items, extraNcc]);
  const cats = [...new Set(items.map((i) => i.category))];
  const upd = (id: string, patch: Parameters<typeof updateEquipItemAction>[1]) =>
    start(async () => {
      await updateEquipItemAction(id, patch);
      router.refresh();
    });

  return (
    <div className="p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span>Giá thuê tính theo ngày (đ/ngày), vật tư mua tính theo đơn vị. Giá dùng mặc định = <b>giá cao nhất</b> các nhà cung cấp; sửa ô &quot;Giá dùng&quot; để tự đặt giá theo thời điểm. Bảng giá dùng chung cho mọi dự án.</span>
        <span className="ml-auto flex items-center gap-1">
          <input value={newNcc} onChange={(e) => setNewNcc(e.target.value)} placeholder="Tên NCC mới" className="w-32 rounded border border-slate-300 px-1.5 py-0.5" />
          <button type="button" onClick={() => newNcc.trim() && (setExtraNcc((x) => [...x, newNcc.trim().toUpperCase()]), setNewNcc(""))} className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50">
            + Cột NCC
          </button>
          {onRecalc && (
            <button type="button" disabled={pending} onClick={onRecalc} className="rounded bg-slate-900 px-2 py-0.5 font-medium text-white disabled:opacity-50">
              Tính lại các bản tính theo giá mới
            </button>
          )}
        </span>
      </div>
      {msg && <div className="mb-2 rounded bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">{msg}</div>}
      <div className={`max-h-[70vh] overflow-auto rounded border border-slate-200 ${busy ? "opacity-70" : ""}`}>
        <table className="w-full min-w-[1100px] border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={th}>Cấu kiện</th>
              <th className={th}>ĐVT</th>
              <th className={th}>Loại</th>
              <th className={`${th} text-right`}>Kg/ĐV</th>
              {nccs.map((n) => (
                <th key={n} className={`${th} text-right`}>
                  {n}
                </th>
              ))}
              <th className={`${th} bg-amber-50 text-right`}>Giá dùng</th>
              <th className={`${th} text-right`}>Giá mua mới</th>
              <th className={`${th} text-right`}>% hao hụt</th>
              <th className={th}>Cập nhật</th>
            </tr>
          </thead>
          <tbody>
            {cats.map((cat) => [
              <tr key={cat}>
                <td colSpan={9 + nccs.length} className="border border-slate-200 bg-slate-100 px-2 py-1 font-semibold text-slate-700">
                  {cat}
                </td>
              </tr>,
              ...items
                .filter((i) => i.category === cat)
                .map((i) => (
                  <tr key={i.id}>
                    <td className={td}>{i.name}</td>
                    <td className={`${td} text-center`}>{i.unit}</td>
                    <td className={`${td} text-center text-[11px] text-slate-500`}>{i.mode === "RENT" ? "thuê/ngày" : "mua"}</td>
                    <td className={`${td} w-16`}>{i.mode === "RENT" && <NumInput value={i.weight || null} decimals onCommit={(v) => v !== i.weight && upd(i.id, { weight: v ?? 0 })} className={`${inp} text-right`} />}</td>
                    {nccs.map((n) => (
                      <td key={n} className={`${td} w-20`}>
                        <NumInput
                          value={i.supplierPrices[n] ?? null}
                          decimals
                          money
                          allowEmpty
                          onCommit={(v) => (v ?? 0) !== (i.supplierPrices[n] ?? 0) && upd(i.id, { supplierPrices: { ...i.supplierPrices, [n]: v ?? 0 } })}
                          className={`${inp} text-right`}
                        />
                      </td>
                    ))}
                    <td className={`${td} w-28 bg-amber-50/50`}>
                      <NumInput value={i.price || null} decimals money onCommit={(v) => (v ?? 0) !== i.price && upd(i.id, { price: v ?? 0 })} className={`${inp} text-right font-medium`} />
                      <div className="flex justify-between px-0.5 text-[10px] text-slate-400">
                        <span>{i.priceManual ? "tự đặt" : "cao nhất"}</span>
                        {i.priceManual && Object.keys(i.supplierPrices).length > 0 && (
                          <button type="button" onClick={() => upd(i.id, { priceManual: false })} className="text-blue-600 hover:underline">
                            theo giá cao nhất
                          </button>
                        )}
                      </div>
                    </td>
                    <td className={`${td} w-24`}>{i.mode === "RENT" && <NumInput value={i.buyPrice || null} decimals money onCommit={(v) => (v ?? 0) !== i.buyPrice && upd(i.id, { buyPrice: v ?? 0 })} className={`${inp} text-right`} />}</td>
                    <td className={`${td} w-16`}>{i.mode === "RENT" && <NumInput value={i.lossPct || null} decimals suffix="%" onCommit={(v) => (v ?? 0) !== i.lossPct && upd(i.id, { lossPct: v ?? 0 })} className={`${inp} text-right`} />}</td>
                    <td className={`${td} whitespace-nowrap text-[10px] text-slate-500`}>
                      {new Date(i.updatedAt).toLocaleDateString("vi-VN")}
                      <div>{i.updatedBy}</div>
                    </td>
                  </tr>
                )),
            ])}
          </tbody>
        </table>
      </div>
    </div>
  );
}
