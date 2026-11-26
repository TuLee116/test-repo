"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import NumInput from "../../../NumInput";
import { updateOrderAction } from "@/lib/proc-actions";
import ExcelGrid, { xcell, type GridPaste } from "../../../ExcelGrid";

type Item = { id: string; name: string; spec: string; unit: string; quantity: number; note: string; reqCode: string };

// Sửa thông tin & dòng vật tư của đơn hàng khi chưa trình PTGĐ (cán bộ vật tư / kế toán vật tư)
export default function OrderItemsEditor({ orderId, head, items: init }: { orderId: string; head: { title: string; deliveryPlace: string; note: string }; items: Item[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [h, setH] = useState(head);
  const [items, setItems] = useState(init);
  const set = (id: string, patch: Partial<Item>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const inp = "w-full rounded border border-slate-300 px-2 py-1 text-sm";
  // dán vùng copy từ Excel
  const pasteGrid = (cells: GridPaste[]) =>
    setItems((xs) =>
      xs.map((x) => {
        const cs = cells.filter((c) => c.row === x.id);
        if (!cs.length) return x;
        const p = { ...x };
        for (const c of cs) {
          if (c.col === "quantity") p.quantity = c.num ?? 0;
          else if (c.col === "name" || c.col === "spec" || c.col === "unit" || c.col === "note") p[c.col] = c.text;
        }
        return p;
      }),
    );
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ["title", "Nội dung đơn hàng"],
            ["deliveryPlace", "Địa điểm giao hàng"],
            ["note", "Ghi chú"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="text-sm">
            <span className="font-medium text-slate-700">{label}</span>
            <input className={`${inp} mt-1`} value={h[k]} onChange={(e) => setH({ ...h, [k]: e.target.value })} />
          </label>
        ))}
      </div>
      <ExcelGrid cols={["name", "spec", "unit", "quantity", "note"]} onPaste={pasteGrid}>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="w-8 px-1 py-2">#</th>
            <th className="px-1 py-2 text-left">Tên vật tư</th>
            <th className="px-1 py-2 text-left">Quy cách</th>
            <th className="w-20 px-1 py-2 text-left">ĐVT</th>
            <th className="w-28 px-1 py-2 text-right">Số lượng</th>
            <th className="px-1 py-2 text-left">Ghi chú</th>
            <th className="px-1 py-2 text-left">Phiếu ĐN</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.id} className="border-t border-slate-100">
              <td className="px-1 py-1 text-center text-slate-400">{i + 1}</td>
              <td className="px-1 py-1" {...xcell(it.id, "name")}>
                <input className={inp} value={it.name} onChange={(e) => set(it.id, { name: e.target.value })} />
              </td>
              <td className="px-1 py-1" {...xcell(it.id, "spec")}>
                <input className={inp} value={it.spec} onChange={(e) => set(it.id, { spec: e.target.value })} />
              </td>
              <td className="px-1 py-1" {...xcell(it.id, "unit")}>
                <input className={inp} value={it.unit} onChange={(e) => set(it.id, { unit: e.target.value })} />
              </td>
              <td className="px-1 py-1" {...xcell(it.id, "quantity")}>
                <NumInput decimals qty allowFormula value={it.quantity || null} className={`${inp} text-right`} onCommit={(v) => set(it.id, { quantity: v ?? 0 })} onLive={(v) => set(it.id, { quantity: v })} />
              </td>
              <td className="px-1 py-1" {...xcell(it.id, "note")}>
                <input className={inp} value={it.note} onChange={(e) => set(it.id, { note: e.target.value })} />
              </td>
              <td className="px-1 py-1 text-xs text-slate-500">{it.reqCode}</td>
              <td className="px-1 py-1 text-center">
                <button type="button" title="Bỏ dòng khỏi đơn (dòng đề nghị quay lại danh sách chờ lên đơn)" className="text-red-500" onClick={() => setItems((xs) => xs.filter((x) => x.id !== it.id))}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </ExcelGrid>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            if (!items.length) return window.alert("Đơn hàng phải còn ít nhất 1 dòng (muốn bỏ hết thì Huỷ đơn).");
            const r = await updateOrderAction(orderId, { ...h, items });
            if (!r.ok) return window.alert(r.error);
            router.refresh();
          })
        }
        className="rounded-md bg-slate-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? "Đang lưu..." : "Lưu đơn hàng"}
      </button>
    </div>
  );
}
