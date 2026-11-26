"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import NumInput from "../../../NumInput";
import { createReceiptAction } from "@/lib/proc-actions";
import { fmtQty } from "@/lib/fmt-qty";
import ExcelGrid, { xcell, type GridPaste } from "../../../ExcelGrid";

type Line = { itemId: string; supplierId: string; name: string; spec: string; unit: string; ordered: number; received: number };
const fq = fmtQty;

// BCH báo số lượng thực nhận tại công trình cho 1 lần giao hàng của 1 nhà cung cấp
export default function ReceiptForm({ orderId, suppliers, lines }: { orderId: string; suppliers: { id: string; name: string }[]; lines: Line[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState(suppliers.length === 1 ? suppliers[0].id : "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [noteNo, setNoteNo] = useState("");
  const [note, setNote] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [lineNote, setLineNote] = useState<Record<string, string>>({});
  const mine = lines.filter((l) => l.supplierId === supplierId);
  const inp = "w-full rounded border border-slate-300 px-2 py-1 text-sm";
  // dán vùng copy từ Excel (cột SL nhận + Ghi chú)
  const pasteGrid = (cells: GridPaste[]) => {
    const q = { ...qty };
    const n = { ...lineNote };
    for (const c of cells) {
      if (c.col === "qty") q[c.row] = c.num ?? 0;
      else n[c.row] = c.text;
    }
    setQty(q);
    setLineNote(n);
  };

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 print:hidden">
        + Báo nhận hàng (BCH)
      </button>
    );
  return (
    <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 print:hidden">
      <h3 className="font-medium text-slate-900">Báo số lượng hàng đã nhận tại công trình</h3>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="text-sm">
          <span className="font-medium text-slate-700">Nhà cung cấp giao</span>
          <select className={`${inp} mt-1`} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">— Chọn —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="font-medium text-slate-700">Ngày nhận</span>
          <input type="date" className={`${inp} mt-1`} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="font-medium text-slate-700">Số phiếu giao hàng / biên bản</span>
          <input className={`${inp} mt-1`} value={noteNo} onChange={(e) => setNoteNo(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="font-medium text-slate-700">Ghi chú</span>
          <input className={`${inp} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      {supplierId && (
        <ExcelGrid cols={["qty", "note"]} onPaste={pasteGrid}>
        <table className="w-full bg-white text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-2 py-2 text-left">Tên vật tư</th>
              <th className="px-2 py-2 text-left">ĐVT</th>
              <th className="px-2 py-2 text-right">SL đặt</th>
              <th className="px-2 py-2 text-right">Đã nhận trước</th>
              <th className="px-2 py-2 text-right">Còn lại</th>
              <th className="w-32 px-2 py-2 text-right">SL nhận lần này</th>
              <th className="px-2 py-2 text-left">Ghi chú (hư hỏng, thiếu...)</th>
            </tr>
          </thead>
          <tbody>
            {mine.map((l) => {
              const left = l.ordered - l.received;
              const over = (qty[l.itemId] ?? 0) > left + 1e-9;
              return (
                <tr key={l.itemId} className="border-t border-slate-100">
                  <td className="px-2 py-1">
                    {l.name}
                    {l.spec && <span className="block text-xs text-slate-400">{l.spec}</span>}
                  </td>
                  <td className="px-2 py-1">{l.unit}</td>
                  <td className="px-2 py-1 text-right">{fq(l.ordered)}</td>
                  <td className="px-2 py-1 text-right">{l.received ? fq(l.received) : ""}</td>
                  <td className="px-2 py-1 text-right">{fq(left)}</td>
                  <td className="px-2 py-1" {...xcell(l.itemId, "qty")}>
                    <NumInput decimals qty allowFormula value={qty[l.itemId] || null} className={`${inp} text-right ${over ? "border-amber-500 bg-amber-50" : ""}`} onCommit={(v) => setQty({ ...qty, [l.itemId]: v ?? 0 })} onLive={(v) => setQty((q) => ({ ...q, [l.itemId]: v }))} />
                    {over && <span className="text-xs text-amber-700">vượt SL đặt</span>}
                  </td>
                  <td className="px-2 py-1" {...xcell(l.itemId, "note")}>
                    <input className={inp} value={lineNote[l.itemId] ?? ""} onChange={(e) => setLineNote({ ...lineNote, [l.itemId]: e.target.value })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </ExcelGrid>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || !supplierId}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          onClick={() =>
            start(async () => {
              const r = await createReceiptAction({
                orderId,
                supplierId,
                receivedDate: date,
                deliveryNoteNo: noteNo,
                note,
                lines: mine.map((l) => ({ itemId: l.itemId, quantity: qty[l.itemId] ?? 0, note: lineNote[l.itemId] ?? "" })),
              });
              if (!r.ok) return window.alert(r.error);
              setOpen(false);
              setQty({});
              router.refresh();
            })
          }
        >
          Gửi cán bộ vật tư
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">
          Huỷ
        </button>
      </div>
    </div>
  );
}
