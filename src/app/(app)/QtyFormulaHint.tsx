"use client";

import { parseQuantityInput } from "@/lib/formula";

// Hiện ngay kết quả của ô định mức khi người dùng gõ công thức (VD "=0,07*0,07*380" → = 1,862),
// hoặc báo lỗi nếu công thức sai. Số thường thì không cần hiện.
export default function QtyFormulaHint({ value }: { value: string }) {
  const s = value.trim();
  if (!s || /^[+-]?\d+([.,]\d+)?$/.test(s)) return null;
  const r = parseQuantityInput(s);
  return r.ok ? (
    <div className="mt-0.5 text-right text-[10px] font-medium text-emerald-700" title="Kết quả công thức">
      = {r.value.toLocaleString("vi-VN", { maximumFractionDigits: 6 })}
    </div>
  ) : (
    <div className="mt-0.5 text-right text-[10px] text-red-600" title={r.error}>
      Công thức lỗi
    </div>
  );
}
