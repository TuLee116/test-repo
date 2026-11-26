"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markHdSubAction } from "@/lib/thau-phu-actions";

// ⑤ QSTT ghi nhận đã lên HĐ / PLHĐ gửi thầu phụ
export default function HdForm({ id, hdNo, hdAt }: { id: string; hdNo: string; hdAt: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [no, setNo] = useState(hdNo);
  const [d, setD] = useState(hdAt || new Date().toISOString().slice(0, 10));
  return (
    <section className="flex flex-wrap items-end gap-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
      <div className="flex-1">
        <h2 className="font-medium text-slate-900">⑤ Lên HĐ / PLHĐ gửi thầu phụ</h2>
        <p className="text-xs text-slate-500">{hdNo ? `Đã lên: ${hdNo}` : "Giá đã có hiệu lực — QSTT lên hợp đồng / phụ lục hợp đồng gửi thầu phụ rồi ghi số vào đây."}</p>
      </div>
      <label className="text-sm">
        <span className="block text-slate-600">Số HĐ / PLHĐ</span>
        <input className="mt-1 w-56 rounded border border-slate-300 px-2 py-1.5 text-sm" value={no} onChange={(e) => setNo(e.target.value)} />
      </label>
      <label className="text-sm">
        <span className="block text-slate-600">Ngày</span>
        <input type="date" className="mt-1 rounded border border-slate-300 px-2 py-1.5 text-sm" value={d} onChange={(e) => setD(e.target.value)} />
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await markHdSubAction(id, no, d);
            if (!r.ok) return window.alert(r.error);
            router.refresh();
          })
        }
        className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {hdNo ? "Cập nhật" : "Đã lên HĐ/PLHĐ"}
      </button>
    </section>
  );
}
