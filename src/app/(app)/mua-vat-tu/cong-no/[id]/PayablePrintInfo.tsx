"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import NumInput from "../../../NumInput";
import { updatePayablePrintAction } from "@/lib/proc-actions";

type Info = { periodFrom: string; periodTo: string; invoiceAdjust: number; advanceDeduct: number };

// Thông tin in trên Bảng kê chi tiết công nợ: đợt thanh toán (từ - đến), cân đối đủ hoá đơn, trừ tạm ứng
export default function PayablePrintInfo({ payableId, editable, initial }: { payableId: string; editable: boolean; initial: Info }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const input = "mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50";
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-2.5">
        <h2 className="font-medium text-slate-900">Thông tin bảng kê công nợ</h2>
        <p className="text-xs text-slate-500">
          In trên &quot;Bảng kê chi tiết công nợ&quot;. Để trống đợt thanh toán = lấy ngày nhận hàng sớm nhất / muộn nhất.
          {!editable && " Chỉ sửa được khi công nợ còn nháp."}
        </p>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-sm">
          <span className="font-medium text-slate-700">Đợt thanh toán từ ngày</span>
          <input type="date" disabled={!editable} className={input} value={v.periodFrom} onChange={(e) => setV({ ...v, periodFrom: e.target.value })} />
        </label>
        <label className="text-sm">
          <span className="font-medium text-slate-700">đến ngày</span>
          <input type="date" disabled={!editable} className={input} value={v.periodTo} onChange={(e) => setV({ ...v, periodTo: e.target.value })} />
        </label>
        <label className="text-sm">
          <span className="font-medium text-slate-700">Cân đối đủ hoá đơn (đ, gồm VAT)</span>
          <NumInput disabled={!editable} allowFormula title="Gõ số âm như -34051" value={v.invoiceAdjust || null} onCommit={(x) => setV({ ...v, invoiceAdjust: x ?? 0 })} className={`${input} text-right`} />
        </label>
        <label className="text-sm">
          <span className="font-medium text-slate-700">Trừ tạm ứng (C)</span>
          <NumInput disabled={!editable} allowFormula value={v.advanceDeduct || null} onCommit={(x) => setV({ ...v, advanceDeduct: x ?? 0 })} className={`${input} text-right`} />
        </label>
        {editable && (
          <div className="flex items-end">
            <button
              type="button"
              disabled={pending || !dirty}
              onClick={() =>
                start(async () => {
                  const r = await updatePayablePrintAction(payableId, v);
                  if (!r.ok) return window.alert(r.error);
                  router.refresh();
                })
              }
              className="rounded-md bg-sky-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-40"
            >
              Lưu
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
