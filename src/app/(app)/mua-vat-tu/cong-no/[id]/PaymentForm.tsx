"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import NumInput from "../../../NumInput";
import { addPaymentAction } from "@/lib/proc-actions";

// Phòng kế toán ghi nhận 1 lần chi tiền cho NCC (có thể chi nhiều lần cho 1 đợt công nợ)
export default function PaymentForm({ payableId, remaining }: { payableId: string; remaining: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState<number>(Math.round(remaining));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const inp = "rounded border border-slate-300 px-2 py-1.5 text-sm";
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 print:hidden">
      <label className="text-sm">
        <span className="block font-medium text-slate-700">Số tiền chi</span>
        <NumInput allowFormula value={amount || null} onCommit={(v) => setAmount(v ?? 0)} onLive={setAmount} className={`${inp} w-44 text-right`} />
      </label>
      <label className="text-sm">
        <span className="block font-medium text-slate-700">Ngày chi</span>
        <input type="date" className={inp} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="flex-1 text-sm">
        <span className="block font-medium text-slate-700">Số UNC / hình thức / ghi chú</span>
        <input className={`${inp} w-full`} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button
        type="button"
        disabled={pending}
        className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
        onClick={() =>
          start(async () => {
            const r = await addPaymentAction(payableId, { amount, paidDate: date, note });
            if (!r.ok) return window.alert(r.error);
            setNote("");
            router.refresh();
          })
        }
      >
        Ghi nhận đã chi
      </button>
    </div>
  );
}
