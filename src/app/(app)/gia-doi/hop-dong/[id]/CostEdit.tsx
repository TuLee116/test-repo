"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { tpEditCostLineAction, type CostLinePatch } from "@/lib/hop-dong-actions";
import { parsePastedNumber } from "@/lib/parse-number";

// Ô sửa nhanh của TRƯỞNG PHÒNG trên bảng DT-CP (TH Nhân Công / Thầu Phụ): bấm vào ô, sửa, Enter hoặc bấm ra ngoài để lưu, Esc để huỷ.
export default function CostEdit({ contractId, lineKey, field, ver = 0, value, text, align = "right", wide }: { contractId: string; lineKey: string; field: "name" | "unit" | "qty" | "price"; ver?: number; value: number | string | null; text: string; align?: "left" | "right" | "center"; wide?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState<string | null>(null); // null = không đang sửa
  const raw = value == null ? "" : String(value).replace(".", ",");
  const commit = () => {
    const cur = v;
    setV(null);
    if (cur == null || cur.trim() === raw.trim()) return;
    let patch: CostLinePatch;
    if (field === "name") patch = { name: cur };
    else if (field === "unit") patch = { unit: cur };
    else {
      const n = cur.trim() === "" ? null : parsePastedNumber(cur);
      if (cur.trim() !== "" && n == null) return window.alert("Nhập số hợp lệ");
      patch = field === "qty" ? { qty: n } : { price: { ver, value: n } };
    }
    start(async () => {
      const r = await tpEditCostLineAction(contractId, lineKey, patch);
      if (!r.ok) return window.alert(r.error);
      router.refresh();
    });
  };
  const al = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  if (v !== null)
    return (
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") setV(null);
        }}
        className={`w-full min-w-0 rounded border border-blue-400 bg-white px-1 py-0.5 text-xs outline-none ${al} ${wide ? "min-w-[240px]" : ""}`}
      />
    );
  return (
    <button type="button" disabled={pending} onClick={() => setV(raw)} title="Trưởng phòng: bấm để điều chỉnh" className={`block w-full rounded px-0.5 hover:bg-blue-50 hover:outline hover:outline-1 hover:outline-blue-300 ${al} ${pending ? "opacity-50" : ""}`}>
      {text || <span className="text-slate-300">—</span>}
    </button>
  );
}
