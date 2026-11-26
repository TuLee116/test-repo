"use client";

import { useState, useTransition } from "react";
import { setLineTotalQtyAction, updateWorkItemLineQuantityAction } from "@/lib/actions";
import { parseQtyWithKL, parseQuantityInput } from "@/lib/formula";
import { fmtNorm } from "@/lib/fmt-norm";

const fmt = fmtNorm; // hiển thị tối đa 2 số lẻ; bấm vào ô để thấy / sửa giá trị đầy đủ

// Ô Định mức hao phí: nhập số thường hoặc công thức kiểu Excel (=1/3, =0.5*2+0.1, =ROUND(10/3;2)...).
// Không focus: hiện kết quả (có ký hiệu ƒ nếu là công thức). Focus: hiện công thức để sửa.
// factor: hệ số quy đổi ĐVT BOQ ↔ ĐVT định mức của dòng BOQ này (VD ×1000) - lúc xem hiện định mức đã quy đổi,
// lúc sửa vẫn sửa định mức GỐC theo ĐVT định mức (định mức dùng chung cho mọi dự án / mọi ĐVT BOQ).
export function LineQtyInput({ lineId, value, formula, factor = 1, sharedCount = 1 }: { lineId: string; value: number; formula: string | null; factor?: number; sharedCount?: number }) {
  const shown = fmt(value * factor);
  const editText = formula ? "=" + formula : value ? String(value).replace(".", ",") : "";
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [dirty, setDirty] = useState(false);

  const preview = editing && dirty ? parseQuantityInput(text) : null;

  return (
    <div className="relative">
      <input
        value={editing ? text : shown}
        disabled={pending}
        title={(formula ? "Công thức: =" + formula : "Nhập số hoặc công thức, VD: =1/3") + (factor !== 1 ? `
Đang hiện định mức đã quy đổi ĐVT (gốc ${fmt(value)} × ${+factor.toPrecision(6)}). Bấm vào để sửa định mức gốc.` : "")}
        placeholder="0"
        onFocus={(e) => {
          setEditing(true);
          setError("");
          setDirty(false);
          setText(editText);
          const t = e.currentTarget;
          setTimeout(() => t.select(), 0);
        }}
        onChange={(e) => {
          setDirty(true);
          setText(e.target.value);
        }}
        onBlur={() => {
          setEditing(false);
          if (!dirty) return;
          setDirty(false);
          const parsed = parseQuantityInput(text);
          if (!parsed.ok) {
            setError(parsed.error);
            return;
          }
          if (parsed.value === value && parsed.formula === formula) return;
          // định mức dùng chung: báo trước số dòng BOQ (mọi dự án) bị đổi theo
          if (sharedCount > 1 && !window.confirm(`Định mức này đang dùng ở ${sharedCount} dòng BOQ (mọi dự án) — sửa thì tất cả cùng đổi theo. Vẫn sửa?`)) {
            setText(shown);
            return;
          }
          start(async () => {
            const res = await updateWorkItemLineQuantityAction(lineId, text);
            if (!res.ok) setError(res.error ?? "Lỗi");
          });
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className={`w-full min-w-0 rounded border px-0.5 text-right text-[10px] ${error ? "border-red-500 bg-red-50" : formula && !editing ? "border-violet-400 bg-violet-50" : "border-slate-300"}`}
      />
      {formula && !editing && <span className="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 text-[10px] font-bold text-violet-600">ƒ</span>}
      {editing && factor !== 1 && (
        <div className="absolute left-0 top-full z-30 whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-normal not-italic text-amber-900">Sửa định mức gốc (theo ĐVT định mức) · hiện ×{+factor.toPrecision(6)}</div>
      )}
      {error && <div className="absolute left-0 top-full z-30 whitespace-nowrap rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-normal not-italic text-white">{error}</div>}
      {preview && preview.ok && preview.formula && (
        <div className="absolute right-0 top-full z-30 whitespace-nowrap rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-normal not-italic text-white">= {fmt(preview.value)}</div>
      )}
      {preview && !preview.ok && (
        <div className="absolute right-0 top-full z-30 whitespace-nowrap rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-normal not-italic text-white">{preview.error}</div>
      )}
    </div>
  );
}

// Ô Tổng KL của dòng hao phí (CHI TIẾT): sửa khối lượng hao phí cho riêng dòng BOQ này, KHÔNG đổi định mức chung.
// Gõ số, hoặc công thức dùng KL = khối lượng BOQ của dòng, VD "=KL/0.2" (quy m3 → m2 theo bề rộng tường 0,2 m).
// Xoá trắng ô rồi Enter = bỏ ghi đè, về theo định mức.
export function LineTotalQtyInput({ projectId, boqItemId, lineId, boqQty, value, overridden, formula }: { projectId: string; boqItemId: string; lineId: string; boqQty: number; value: number; overridden: boolean; formula: string }) {
  const shown = fmt(value);
  const editText = overridden ? (formula ? "=" + formula : String(+value.toFixed(6)).replace(".", ",")) : "=KL";
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const preview = editing && dirty ? parseQtyWithKL(text, boqQty) : null;

  const save = (raw: string) =>
    start(async () => {
      const res = await setLineTotalQtyAction(projectId, boqItemId, lineId, raw);
      if (!res.ok) setError(res.error ?? "Lỗi");
    });

  return (
    <div className="relative flex items-center gap-0.5">
      <input
        value={editing ? text : shown}
        disabled={pending}
        title={"Tổng khối lượng hao phí của dòng này — sửa được (chỉ đổi cho dòng BOQ này, không đổi định mức chung). Gõ số, hoặc công thức dùng KL = khối lượng BOQ, VD: =KL/0.2 (quy m3 sang m2 theo bề rộng tường 0,2 m). Xoá trắng rồi Enter để về theo định mức."}
        onFocus={(e) => {
          setEditing(true);
          setError("");
          setDirty(false);
          setText(editText);
          const t = e.currentTarget;
          setTimeout(() => t.select(), 0);
        }}
        onChange={(e) => {
          setDirty(true);
          setText(e.target.value);
        }}
        onBlur={() => {
          setEditing(false);
          if (!dirty) return;
          setDirty(false);
          if (text.trim()) {
            const parsed = parseQtyWithKL(text, boqQty);
            if (!parsed.ok) {
              setError(parsed.error);
              return;
            }
          }
          save(text);
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className={`w-full min-w-0 rounded border px-0.5 text-right text-[11px] ${error ? "border-red-500 bg-red-50" : overridden ? "border-blue-500 bg-blue-50 font-medium text-blue-800" : "border-slate-200 bg-transparent text-slate-600 hover:border-slate-400"}`}
      />
      {overridden && !editing && (
        <button type="button" disabled={pending} title="Bỏ số đã sửa, về theo định mức" onClick={() => save("")} className="shrink-0 rounded px-0.5 text-[10px] text-blue-700 hover:bg-blue-100">
          ↺
        </button>
      )}
      {error && <div className="absolute left-0 top-full z-30 whitespace-nowrap rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-normal not-italic text-white">{error}</div>}
      {preview && preview.ok && (
        <div className="absolute right-0 top-full z-30 whitespace-nowrap rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-normal not-italic text-white">= {fmt(preview.value)}</div>
      )}
      {preview && !preview.ok && (
        <div className="absolute right-0 top-full z-30 whitespace-nowrap rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-normal not-italic text-white">{preview.error}</div>
      )}
    </div>
  );
}
