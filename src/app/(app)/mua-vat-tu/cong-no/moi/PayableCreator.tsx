"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPayableAction } from "@/lib/proc-actions";
import { fmtQty } from "@/lib/fmt-qty";

type Line = { id: string; receiptCode: string; receivedDate: string; deliveryNoteNo: string; orderCode: string; name: string; unit: string; quantity: number; unitPrice: number; vatRate: number; amount: number };
const fm = (n: number) => Math.round(n).toLocaleString("vi-VN");
const fq = fmtQty;

// Cán bộ vật tư chọn các dòng hàng BCH đã nhận để lập 1 đợt công nợ (đề nghị thanh toán) cho NCC
export default function PayableCreator({ projectId, supplierId, lines }: { projectId: string; supplierId: string; lines: Line[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [on, setOn] = useState<Record<string, boolean>>(Object.fromEntries(lines.map((l) => [l.id, true])));
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const picked = lines.filter((l) => on[l.id]);
  const total = picked.reduce((s, l) => s + l.amount, 0);
  const inp = "w-full rounded border border-slate-300 px-2 py-1 text-sm";
  if (!lines.length) return <p className="text-sm text-slate-500">Không còn dòng hàng nào chưa lên công nợ.</p>;
  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="font-medium text-slate-700">Nội dung đợt</span>
          <input className={`${inp} mt-1`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VD: Thanh toán đợt 2 tháng 10/2026" />
        </label>
        <label className="text-sm">
          <span className="font-medium text-slate-700">Hạn thanh toán</span>
          <input type="date" className={`${inp} mt-1`} value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="font-medium text-slate-700">Ghi chú</span>
          <input className={`${inp} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="w-8 px-1 py-2">
                <input type="checkbox" checked={lines.every((l) => on[l.id])} onChange={(e) => setOn(Object.fromEntries(lines.map((l) => [l.id, e.target.checked])))} />
              </th>
              <th className="px-1 py-2 text-left">Phiếu nhận</th>
              <th className="px-1 py-2 text-left">Ngày nhận</th>
              <th className="px-1 py-2 text-left">Đơn hàng</th>
              <th className="px-1 py-2 text-left">Vật tư</th>
              <th className="px-1 py-2 text-left">ĐVT</th>
              <th className="px-1 py-2 text-right">SL nhận</th>
              <th className="px-1 py-2 text-right">Đơn giá (chưa VAT)</th>
              <th className="px-1 py-2 text-right">VAT</th>
              <th className="px-1 py-2 text-right">Thành tiền (gồm VAT)</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className={`border-t border-slate-100 ${on[l.id] ? "" : "opacity-50"}`}>
                <td className="px-1 py-1 text-center">
                  <input type="checkbox" checked={!!on[l.id]} onChange={(e) => setOn({ ...on, [l.id]: e.target.checked })} />
                </td>
                <td className="px-1 py-1">
                  {l.receiptCode}
                  {l.deliveryNoteNo && <span className="block text-xs text-slate-400">PGH {l.deliveryNoteNo}</span>}
                </td>
                <td className="px-1 py-1">{l.receivedDate}</td>
                <td className="px-1 py-1">{l.orderCode}</td>
                <td className="px-1 py-1">{l.name}</td>
                <td className="px-1 py-1">{l.unit}</td>
                <td className="px-1 py-1 text-right">{fq(l.quantity)}</td>
                <td className="px-1 py-1 text-right">{fm(l.unitPrice)}</td>
                <td className="px-1 py-1 text-right">{l.vatRate * 100}%</td>
                <td className="px-1 py-1 text-right font-medium">{fm(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300">
              <td colSpan={9} className="px-1 py-2 text-right font-semibold">
                Tổng đợt này ({picked.length} dòng)
              </td>
              <td className="px-1 py-2 text-right text-base font-bold">{fm(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <button
        type="button"
        disabled={pending || !picked.length}
        onClick={() =>
          start(async () => {
            const r = await createPayableAction({ projectId, supplierId, title, dueDate: due, note, receiptLineIds: picked.map((l) => l.id) });
            if (!r.ok) return window.alert(r.error);
            router.push(`/mua-vat-tu/cong-no/${r.id}`);
          })
        }
        className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        Tạo công nợ đợt
      </button>
    </div>
  );
}
