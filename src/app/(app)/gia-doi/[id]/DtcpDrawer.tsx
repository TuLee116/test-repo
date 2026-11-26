"use client";

import { useState } from "react";

// base1: đơn giá thời điểm 1 (thầu phụ: đơn giá cơ sở để so) — có thì thêm cột "ĐG TĐ1"
export type DtcpRow = { level: string; stt: string; name: string; unit: string; qty: number | null; price: number | null; amount: number | null; base1?: number | null };

const fm = (n: number | null | undefined) => (n ? Math.round(n).toLocaleString("vi-VN") : "");
const fq = (n: number | null | undefined) => (n == null ? "" : n.toLocaleString("vi-VN", { maximumFractionDigits: 2 }));
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase();

// Nút "Xem DT-CP": mở ngăn bên PHẢI hiện bảng TH Nhân Công (giá đội) / TH Thầu Phụ (thầu phụ) của DT-CP gắn với hồ sơ, để đối chiếu khi lập / duyệt
export default function DtcpDrawer({ rows, title, fullHref, heading = "Bảng tổng hợp nhân công của DT-CP", sheet = "TH Nhân Công" }: { rows: DtcpRow[]; title: string; fullHref: string; heading?: string; sheet?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const nq = norm(q.trim());
  const shown = nq ? rows.filter((r) => r.level === "ITEM" && norm(r.name).includes(nq)) : rows;
  const hasB1 = rows.some((r) => r.base1 !== undefined);
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} className={`rounded-md border px-3 py-1.5 text-sm font-medium ${open ? "border-sky-700 bg-sky-700 text-white" : "border-sky-600 bg-white text-sky-800 hover:bg-sky-50"}`}>
        📋 Xem DT-CP
      </button>
      {open && (
        <aside className="fixed bottom-0 right-0 top-0 z-[70] flex w-full max-w-[41rem] flex-col border-l-2 border-sky-600 bg-white shadow-2xl">
          <div className="flex items-start gap-2 bg-sky-700 px-3 py-2 text-white">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{heading}</p>
              <p className="truncate text-xs text-sky-100">{title}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded px-2 py-0.5 text-lg leading-none hover:bg-sky-800" aria-label="Đóng">
              ✕
            </button>
          </div>
          <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm công việc trong DT-CP…" className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm" />
            <a href={fullHref} target="_blank" className="whitespace-nowrap text-xs text-sky-700 underline">
              Mở đầy đủ ↗
            </a>
          </div>
          <div className="flex-1 overflow-auto">
            {rows.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">DT-CP này chưa có dữ liệu {sheet}.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-100 text-slate-700">
                  <tr>
                    <th className="px-1.5 py-1 text-left">STT</th>
                    <th className="px-1.5 py-1 text-left">Nội dung</th>
                    <th className="px-1.5 py-1 text-center">ĐVT</th>
                    <th className="px-1.5 py-1 text-right">KL</th>
                    {hasB1 && <th className="px-1.5 py-1 text-right" title="Đơn giá thời điểm 1 — đơn giá cơ sở để so giá thầu phụ">ĐG TĐ1</th>}
                    <th className="px-1.5 py-1 text-right">{hasB1 ? "ĐG hiện hành" : "Đơn giá"}</th>
                    <th className="px-1.5 py-1 text-right">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, i) =>
                    r.level === "ITEM" ? (
                      <tr key={i} className="border-t border-slate-100 align-top hover:bg-sky-50">
                        <td className="px-1.5 py-1 text-slate-500">{r.stt}</td>
                        <td className="px-1.5 py-1">{r.name}</td>
                        <td className="px-1.5 py-1 text-center">{r.unit}</td>
                        <td className="px-1.5 py-1 text-right">{fq(r.qty)}</td>
                        {hasB1 && <td className="px-1.5 py-1 text-right font-semibold text-violet-800">{fm(r.base1)}</td>}
                        <td className="px-1.5 py-1 text-right">{fm(r.price)}</td>
                        <td className="px-1.5 py-1 text-right">{fm(r.amount)}</td>
                      </tr>
                    ) : (
                      <tr key={i} className={`border-t border-slate-200 font-semibold ${r.level === "GROUP" ? "bg-orange-50" : "bg-amber-50"}`}>
                        <td className="px-1.5 py-1">{r.stt}</td>
                        <td className="px-1.5 py-1" colSpan={hasB1 ? 5 : 4}>
                          {r.name}
                        </td>
                        <td className="px-1.5 py-1 text-right">{fm(r.amount)}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            )}
          </div>
        </aside>
      )}
    </>
  );
}
