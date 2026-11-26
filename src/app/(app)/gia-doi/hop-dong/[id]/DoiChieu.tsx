"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addOutsideToDtcpAction, matchOutsideAction } from "@/lib/doi-chieu-actions";
import type { DcOption, DcRow } from "@/lib/doi-chieu";
import { normText } from "@/lib/hop-dong-calc";

const fm = (n: number | null | undefined) => (n ? Math.round(n).toLocaleString("vi-VN") : "");
const fq = (n: number | null | undefined) => (n ? n.toLocaleString("vi-VN", { maximumFractionDigits: 2 }) : "");
const ADD = "+"; // giá trị cột "Xử lý": thêm vào DT-CP

// Đối chiếu sổ giá đội với DT-CP: mỗi dòng chọn ở cột "Xử lý" (khớp dòng DT-CP / thêm vào DT-CP / giữ ngoài),
// tick các dòng rồi bấm "Áp dụng" — làm hàng loạt như trên Excel. Gợi ý ≥ 60% được chọn sẵn để QSTT rà lại.
export default function DoiChieu({ contractId, rows, options, isApp, canEdit }: { contractId: string; rows: DcRow[]; options: DcOption[]; isApp: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const optMap = useMemo(() => new Map(options.map((o) => [o.key, o])), [options]);
  const open = useMemo(() => rows.filter((r) => !r.confirmed), [rows]);
  const kept = useMemo(() => rows.filter((r) => r.confirmed), [rows]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const last = useRef<number | null>(null);
  // cột Xử lý + tên / ĐVT khi thêm vào DT-CP (sửa được)
  const [act, setAct] = useState<Record<string, string>>(() => Object.fromEntries(open.map((r) => [r.srcKey, r.sugg[0] && r.sugg[0].score >= 0.6 ? r.sugg[0].key : ""])));
  const [names, setNames] = useState<Record<string, { name: string; unit: string }>>(() => Object.fromEntries(open.map((r) => [r.srcKey, { name: r.name, unit: r.unit }])));

  const shown = useMemo(() => {
    const n = normText(q);
    return open.filter((r) => !n || normText(r.name).includes(n));
  }, [open, q]);
  const allOn = shown.length > 0 && shown.every((r) => sel.has(r.srcKey));

  const toggle = (i: number, shift: boolean) => {
    const next = new Set(sel);
    const on = !next.has(shown[i].srcKey);
    const [a, b] = shift && last.current != null ? [Math.min(last.current, i), Math.max(last.current, i)] : [i, i];
    for (let k = a; k <= b; k++) {
      if (on) next.add(shown[k].srcKey);
      else next.delete(shown[k].srcKey);
    }
    last.current = i;
    setSel(next);
  };
  // điền cùng 1 lựa chọn cho mọi dòng đã tick (giống kéo / dán trên Excel)
  const fillSel = (v: string) => setAct((a) => ({ ...a, ...Object.fromEntries([...sel].map((k) => [k, v])) }));
  const pickSugg = () => setAct((a) => ({ ...a, ...Object.fromEntries([...sel].map((k) => [k, open.find((r) => r.srcKey === k)?.sugg[0]?.key ?? a[k] ?? ""])) }));

  // ↑ ↓ Enter di chuyển trong cùng cột như Excel
  const nav = (e: React.KeyboardEvent<HTMLElement>, col: string, i: number) => {
    const d = e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey) ? 1 : e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey) ? -1 : 0;
    if (!d || (e.target instanceof HTMLSelectElement && e.key !== "Enter")) return;
    const el = document.querySelector<HTMLElement>(`[data-dc="${col}-${i + d}"]`);
    if (el) {
      e.preventDefault();
      el.focus();
    }
  };

  const apply = () => {
    const picked = shown.filter((r) => sel.has(r.srcKey));
    const none = picked.filter((r) => !act[r.srcKey]);
    if (!picked.length) return window.alert("Tick chọn các dòng cần xử lý");
    if (none.length) return window.alert(`${none.length} dòng đã tick chưa chọn cách xử lý (cột "Xử lý")`);
    const toAdd = picked.filter((r) => act[r.srcKey] === ADD);
    const toMatch = picked.filter((r) => act[r.srcKey] !== ADD);
    const msg = [
      toMatch.filter((r) => act[r.srcKey] !== "-").length && `• Khớp ${toMatch.filter((r) => act[r.srcKey] !== "-").length} dòng vào dòng DT-CP đã chọn`,
      toAdd.length && `• Thêm ${toAdd.length} dòng PHÁT SINH vào DT-CP${isApp ? " (thêm luôn vào sheet TH Nhân Công mục B của dự án)" : ""}`,
      toMatch.filter((r) => act[r.srcKey] === "-").length && `• Giữ ${toMatch.filter((r) => act[r.srcKey] === "-").length} dòng ngoài DT-CP`,
    ].filter(Boolean);
    if (!window.confirm(`Áp dụng cho ${picked.length} dòng:\n${msg.join("\n")}`)) return;
    start(async () => {
      if (toMatch.length) {
        const r = await matchOutsideAction(contractId, toMatch.map((x) => ({ srcKey: x.srcKey, lineKey: act[x.srcKey] })));
        if (!r.ok) return window.alert(r.error);
      }
      if (toAdd.length) {
        const r = await addOutsideToDtcpAction(contractId, toAdd.map((x) => ({ srcKey: x.srcKey, name: names[x.srcKey]?.name ?? x.name, unit: names[x.srcKey]?.unit ?? x.unit })));
        if (!r.ok) return window.alert(r.error);
      }
      setSel(new Set());
      router.refresh();
    });
  };
  const reopen = (srcKey: string) =>
    start(async () => {
      const r = await matchOutsideAction(contractId, [{ srcKey, lineKey: "" }]);
      if (!r.ok) return window.alert(r.error);
      router.refresh();
    });

  const cellIn = "w-full bg-transparent px-1.5 py-1 outline-none focus:bg-sky-50 focus:ring-1 focus:ring-sky-400";
  const total = open.reduce((s, r) => s + r.value, 0);

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
        Các công việc đã duyệt giá đội nhưng <b>chưa gắn vào dòng TH Nhân Công</b> của DT-CP: <b>{open.length}</b> công việc, giá trị đã duyệt <b>{fm(total)}</b> đ. Mỗi dòng chọn ở cột <b>Xử lý</b>:
        khớp vào dòng DT-CP có sẵn (gợi ý ★ đã chọn sẵn — rà lại), <b>➕ Thêm vào DT-CP</b> (thành dòng phát sinh ở đầu mục &quot;PHÁT SINH – BỔ SUNG TỪ SỔ GIÁ&quot;, đơn giá = giá duyệt gần nhất, KL = lũy kế đã duyệt
        {isApp ? "; thêm luôn vào sheet TH Nhân Công của dự án" : ""}) hoặc <b>✕ Giữ ngoài DT-CP</b>. Tick các dòng rồi bấm <b>Áp dụng</b>. Phần mềm nhớ cách khớp, đợt trình sau tự khớp.
      </div>

      {open.length === 0 ? (
        <p className="text-sm text-emerald-700">✓ Mọi giá đội đã duyệt đều đã gắn với DT-CP.</p>
      ) : (
        <>
          <div className="sticky top-[77px] z-10 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white/95 px-2 py-1.5 text-sm shadow-sm">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Lọc tên công việc (không cần dấu)..." className="w-64 rounded border border-slate-300 px-2 py-1 text-sm" />
            <span className="text-slate-500">Đã tick {sel.size}</span>
            {canEdit && sel.size > 0 && (
              <>
                <button type="button" onClick={pickSugg} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
                  ★ Lấy gợi ý 1
                </button>
                <button type="button" onClick={() => fillSel(ADD)} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
                  ➕ Đặt &quot;Thêm vào DT-CP&quot;
                </button>
                <button type="button" onClick={() => fillSel("-")} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
                  ✕ Đặt &quot;Giữ ngoài&quot;
                </button>
              </>
            )}
            {canEdit && (
              <button type="button" disabled={pending || !sel.size} onClick={apply} className="ml-auto rounded-md bg-sky-700 px-4 py-1.5 font-medium text-white hover:bg-sky-800 disabled:opacity-50">
                {pending ? "Đang xử lý..." : `Áp dụng (${sel.size})`}
              </button>
            )}
          </div>
          <div className="xfreeze rounded border border-slate-200" style={{ "--fz1": "32px", "--fz2": "340px", "--fzh": "40px" } as React.CSSProperties}>
            <table className="w-full min-w-[1250px] border-collapse text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="w-8 border border-slate-200 px-1">
                    {canEdit && <input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(shown.map((r) => r.srcKey)))} title="Chọn tất cả (giữ Shift khi tick để chọn một dải)" />}
                  </th>
                  <th className="border border-slate-200 px-1.5 py-1.5 text-left">Công việc đã duyệt (tên khi thêm vào DT-CP — sửa được)</th>
                  <th className="w-16 border border-slate-200 px-1.5">ĐVT</th>
                  <th className="border border-slate-200 px-1.5">Lần duyệt / đội</th>
                  <th className="border border-slate-200 px-1.5">Giá duyệt gần nhất</th>
                  <th className="border border-slate-200 px-1.5">KL đã duyệt</th>
                  <th className="border border-slate-200 px-1.5">Giá trị</th>
                  <th className="w-[340px] border border-slate-200 px-1.5 text-left">Xử lý (khớp vào dòng DT-CP / thêm / giữ ngoài)</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => {
                  const a = act[r.srcKey] ?? "";
                  const o = optMap.get(a);
                  const nm = names[r.srcKey] ?? { name: r.name, unit: r.unit };
                  return (
                    <tr key={r.srcKey} className={`align-top ${sel.has(r.srcKey) ? "bg-sky-50/60" : ""}`}>
                      <td className="border border-slate-200 text-center">
                        {canEdit && <input type="checkbox" checked={sel.has(r.srcKey)} onChange={(e) => toggle(i, (e.nativeEvent as MouseEvent).shiftKey)} />}
                      </td>
                      <td className="border border-slate-200 p-0">
                        <input data-dc={`n-${i}`} className={cellIn} value={nm.name} disabled={!canEdit} onKeyDown={(e) => nav(e, "n", i)} onChange={(e) => setNames((x) => ({ ...x, [r.srcKey]: { ...nm, name: e.target.value } }))} title={r.name} />
                        <div className="px-1.5 pb-1 text-[11px] text-slate-400">
                          {r.codes.slice(0, 4).join(", ")}
                          {r.codes.length > 4 && ` +${r.codes.length - 4}`}
                        </div>
                      </td>
                      <td className="border border-slate-200 p-0">
                        <input data-dc={`u-${i}`} className={`${cellIn} text-center`} value={nm.unit} disabled={!canEdit} onKeyDown={(e) => nav(e, "u", i)} onChange={(e) => setNames((x) => ({ ...x, [r.srcKey]: { ...nm, unit: e.target.value } }))} />
                      </td>
                      <td className="border border-slate-200 px-1.5 text-center" title={r.crews.join("\n")}>
                        {r.count} lần · {r.crews.length} đội
                      </td>
                      <td className="border border-slate-200 px-1.5 text-right">
                        <b>{fm(r.price)}</b>
                        <div className="text-[11px] text-slate-400">{r.date}</div>
                      </td>
                      <td className="border border-slate-200 px-1.5 text-right">{fq(r.qty)}</td>
                      <td className="border border-slate-200 px-1.5 text-right">{fm(r.value)}</td>
                      <td className="border border-slate-200 p-0">
                        <select
                          data-dc={`a-${i}`}
                          disabled={!canEdit}
                          value={a}
                          onKeyDown={(e) => nav(e, "a", i)}
                          onChange={(e) => {
                            setAct((x) => ({ ...x, [r.srcKey]: e.target.value }));
                            if (!sel.has(r.srcKey)) setSel(new Set(sel).add(r.srcKey));
                          }}
                          className={`${cellIn} ${a === ADD ? "text-emerald-700" : a === "-" ? "text-slate-500" : !a ? "bg-amber-50" : ""}`}
                        >
                          <option value="">— chọn cách xử lý —</option>
                          <option value={ADD}>➕ Thêm vào DT-CP (phát sinh)</option>
                          <option value="-">✕ Giữ ngoài DT-CP</option>
                          {r.sugg.length > 0 && (
                            <optgroup label="★ Gợi ý">
                              {r.sugg.map((s) => {
                                const x = optMap.get(s.key)!;
                                return (
                                  <option key={`s${s.key}`} value={s.key}>
                                    ★ {Math.round(s.score * 100)}% · {x.name} ({x.unit}) {fm(x.price)}
                                  </option>
                                );
                              })}
                            </optgroup>
                          )}
                          <optgroup label="Tất cả dòng TH Nhân Công">
                            {options
                              .filter((x) => !r.sugg.some((s) => s.key === x.key))
                              .map((x) => (
                              <option key={x.key} value={x.key}>
                                {x.extra ? "[PS] " : ""}
                                {x.name} ({x.unit}) {fm(x.price)}
                              </option>
                              ))}
                          </optgroup>
                        </select>
                        {o && (
                          <div className={`px-1.5 pb-1 text-[11px] ${o.price != null && r.price > o.price + 0.5 ? "text-red-600" : "text-slate-500"}`}>
                            ĐG DT-CP {fm(o.price)}
                            {o.price != null && r.price > o.price + 0.5 && " — giá duyệt cao hơn DT-CP"}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {kept.length > 0 && (
        <details className="rounded-md border border-slate-200 px-3 py-2 text-xs">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            Đã xác nhận giữ ngoài DT-CP ({kept.length} công việc, {fm(kept.reduce((s, r) => s + r.value, 0))} đ)
          </summary>
          <table className="mt-1 w-full">
            <tbody>
              {kept.map((r) => (
                <tr key={r.srcKey} className="border-t border-slate-100">
                  <td className="py-1">{r.name}</td>
                  <td>{r.unit}</td>
                  <td className="text-right font-semibold">{fm(r.price)}</td>
                  <td className="text-right">{fm(r.value)}</td>
                  <td className="text-slate-500">{r.codes.join(", ")}</td>
                  <td className="text-right">
                    {canEdit && (
                      <button type="button" disabled={pending} onClick={() => reopen(r.srcKey)} className="text-sky-700 hover:underline">
                        ↩ Đối chiếu lại
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
