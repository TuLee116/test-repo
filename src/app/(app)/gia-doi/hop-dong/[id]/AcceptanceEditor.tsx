"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import NumInput from "../../../NumInput";
import { deleteAcceptanceAction, saveAcceptanceAction } from "@/lib/hd-overview-actions";
import type { Acceptance } from "@/lib/hd-overview";

const fm = (n: number) => Math.round(n).toLocaleString("vi-VN");
type Draft = { id?: string; period: string; date: string; value: number | null; note: string };
const empty = (n: number): Draft => ({ period: `Đợt ${n}`, date: "", value: null, note: "" });

// NGHIỆM THU VỚI CĐT từng đợt — tạm nhập tay (sau này lấy từ hồ sơ thanh toán CĐT). Lũy kế / doanh thu = % hoàn thành.
export default function AcceptanceEditor({ contractId, rows, revenue, canEdit }: { contractId: string; rows: Acceptance[]; revenue: number | null; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState<Draft>(empty(rows.length + 1));
  const [edit, setEdit] = useState<Draft | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      setErr("");
      const r = await fn();
      if (!r.ok) setErr(r.error ?? "Không lưu được.");
      else {
        after?.();
        router.refresh();
      }
    });

  const cums = rows.reduce<number[]>((a, r) => [...a, (a.at(-1) ?? 0) + r.value], []);
  const inp = "w-full rounded border border-slate-300 px-2 py-1 text-sm";
  const row = (d: Draft, set: (d: Draft) => void) => (
    <>
      <td className="px-2 py-1"><input className={inp} value={d.period} onChange={(e) => set({ ...d, period: e.target.value })} placeholder="Đợt 1" /></td>
      <td className="px-2 py-1"><input type="date" className={inp} value={d.date} onChange={(e) => set({ ...d, date: e.target.value })} /></td>
      <td className="px-2 py-1"><NumInput value={d.value} money allowEmpty onCommit={(v) => set({ ...d, value: v })} className={`${inp} text-right`} /></td>
      <td className="px-2 py-1 text-right text-slate-400">—</td>
      <td className="px-2 py-1"><input className={inp} value={d.note} onChange={(e) => set({ ...d, note: e.target.value })} placeholder="Số biên bản, ghi chú…" /></td>
    </>
  );

  return (
    <div className="space-y-2">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="w-[14%] px-2 py-1.5 text-left font-medium">Đợt</th>
            <th className="w-[14%] px-2 py-1.5 text-left font-medium">Ngày nghiệm thu</th>
            <th className="w-[18%] px-2 py-1.5 text-right font-medium">Giá trị đợt này (sau VAT)</th>
            <th className="w-[18%] px-2 py-1.5 text-right font-medium">Lũy kế · % doanh thu</th>
            <th className="px-2 py-1.5 text-left font-medium">Ghi chú</th>
            {canEdit && <th className="w-[12%]" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const cum = cums[i];
            const pct = revenue ? Math.round((cum / revenue) * 1000) / 10 : null;
            if (edit?.id === r.id)
              return (
                <tr key={r.id} className="border-t border-slate-100 bg-sky-50/40">
                  {row(edit, setEdit)}
                  <td className="space-x-2 whitespace-nowrap px-2 py-1 text-right">
                    <button disabled={pending} onClick={() => run(() => saveAcceptanceAction(contractId, edit), () => setEdit(null))} className="text-xs font-medium text-sky-700 hover:underline">Lưu</button>
                    <button onClick={() => setEdit(null)} className="text-xs text-slate-500 hover:underline">Huỷ</button>
                  </td>
                </tr>
              );
            return (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-2 py-1.5">{r.period || "—"}</td>
                <td className="px-2 py-1.5">{r.date ? r.date.split("-").reverse().join("/") : ""}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fm(r.value)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {fm(cum)}
                  {pct != null && <span className="ml-1 text-xs text-slate-500">· {pct.toLocaleString("vi-VN")}%</span>}
                </td>
                <td className="px-2 py-1.5 text-slate-600">
                  {r.note}
                  {r.by && <span className="ml-1 text-xs text-slate-400">({r.by})</span>}
                </td>
                {canEdit && (
                  <td className="space-x-2 whitespace-nowrap px-2 py-1.5 text-right">
                    <button onClick={() => setEdit({ id: r.id, period: r.period, date: r.date ?? "", value: r.value, note: r.note })} className="text-xs text-sky-700 hover:underline">Sửa</button>
                    <button disabled={pending} onClick={() => confirm(`Xoá ${r.period || "đợt này"}?`) && run(() => deleteAcceptanceAction(contractId, r.id))} className="text-xs text-red-600 hover:underline">Xoá</button>
                  </td>
                )}
              </tr>
            );
          })}
          {!rows.length && (
            <tr>
              <td colSpan={canEdit ? 6 : 5} className="px-2 py-3 text-center text-xs text-slate-500">Chưa nhập đợt nghiệm thu nào — % hoàn thành chưa tính được.</td>
            </tr>
          )}
          {canEdit && !edit && (
            <tr className="border-t border-slate-200 bg-emerald-50/30">
              {row(draft, setDraft)}
              <td className="px-2 py-1 text-right">
                <button disabled={pending} onClick={() => run(() => saveAcceptanceAction(contractId, draft), () => setDraft(empty(rows.length + 2)))} className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                  + Thêm đợt
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <p className="text-xs text-slate-400">Tạm thời nhập tay theo số liệu bộ phận thanh toán CĐT cung cấp. Sau này có phần hồ sơ thanh toán CĐT sẽ tự lấy sang.</p>
    </div>
  );
}
