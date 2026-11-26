"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import NumInput from "../../../NumInput";
import { createOrderAction } from "@/lib/proc-actions";
import { fmtQty } from "@/lib/fmt-qty";

type Item = { id: string; reqCode: string; reqTitle: string; neededDate: string; name: string; spec: string; unit: string; quantity: number; ordered: number; remaining: number; note: string };
const fq = fmtQty;

// Cán bộ vật tư chọn các dòng đề nghị đã duyệt (có thể gộp nhiều phiếu, lên đơn một phần khối lượng) để lập 1 đơn hàng
export default function OrderCreator({ projectId, defaultPlace, items }: { projectId: string; defaultPlace: string; items: Item[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [place, setPlace] = useState(defaultPlace);
  const [note, setNote] = useState("");
  const [qty, setQty] = useState<Record<string, number>>(Object.fromEntries(items.map((i) => [i.id, i.remaining])));
  const [on, setOn] = useState<Record<string, boolean>>(Object.fromEntries(items.map((i) => [i.id, true])));
  const picked = items.filter((i) => on[i.id] && qty[i.id] > 0);
  const input = "w-full rounded border border-slate-300 px-2 py-1 text-sm";

  if (!items.length) return <p className="text-sm text-slate-500">Dự án không còn dòng đề nghị nào chờ lên đơn.</p>;
  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="font-medium text-slate-700">Nội dung đơn hàng</span>
          <input className={`${input} mt-1`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VD: Thép xây dựng đợt 3" />
        </label>
        <label className="text-sm">
          <span className="font-medium text-slate-700">Địa điểm giao hàng</span>
          <input className={`${input} mt-1`} value={place} onChange={(e) => setPlace(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="font-medium text-slate-700">Ghi chú</span>
          <input className={`${input} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="w-8 px-1 py-2">
                <input type="checkbox" checked={items.every((i) => on[i.id])} onChange={(e) => setOn(Object.fromEntries(items.map((i) => [i.id, e.target.checked])))} />
              </th>
              <th className="px-1 py-2 text-left">Phiếu ĐN</th>
              <th className="px-1 py-2 text-left">Tên vật tư</th>
              <th className="px-1 py-2 text-left">Quy cách</th>
              <th className="px-1 py-2 text-left">ĐVT</th>
              <th className="px-1 py-2 text-right">KL đề nghị</th>
              <th className="px-1 py-2 text-right">Đã lên đơn</th>
              <th className="w-28 px-1 py-2 text-right">KL đặt lần này</th>
              <th className="px-1 py-2 text-left">Cần ngày</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className={`border-t border-slate-100 ${on[i.id] ? "" : "opacity-50"}`}>
                <td className="px-1 py-1 text-center">
                  <input type="checkbox" checked={!!on[i.id]} onChange={(e) => setOn({ ...on, [i.id]: e.target.checked })} />
                </td>
                <td className="px-1 py-1">
                  {i.reqCode}
                  <span className="block text-xs text-slate-400">{i.reqTitle}</span>
                </td>
                <td className="px-1 py-1">
                  {i.name}
                  {i.note && <span className="block text-xs text-slate-400">{i.note}</span>}
                </td>
                <td className="px-1 py-1">{i.spec}</td>
                <td className="px-1 py-1">{i.unit}</td>
                <td className="px-1 py-1 text-right">{fq(i.quantity)}</td>
                <td className="px-1 py-1 text-right">{i.ordered ? fq(i.ordered) : ""}</td>
                <td className="px-1 py-1">
                  <NumInput decimals qty value={qty[i.id] || null} onCommit={(v) => setQty({ ...qty, [i.id]: v ?? 0 })} onLive={(v) => setQty((q) => ({ ...q, [i.id]: v }))} className={`${input} text-right`} />
                </td>
                <td className="px-1 py-1 text-xs">{i.neededDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        disabled={pending || !picked.length}
        onClick={() =>
          start(async () => {
            const r = await createOrderAction({ projectId, title, deliveryPlace: place, note, items: picked.map((i) => ({ requestItemId: i.id, quantity: qty[i.id] })) });
            if (!r.ok) return window.alert(r.error);
            router.push(`/mua-vat-tu/don-hang/${r.id}`);
          })
        }
        className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        Tạo đơn hàng ({picked.length} dòng)
      </button>
    </div>
  );
}
