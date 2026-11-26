"use client";

import { createContext, useContext, useState } from "react";
import NumInput from "@/app/(app)/NumInput";
import LinkPicker from "./LinkPicker";
import { linkKeysOf, type GridSourceOption } from "@/lib/grid-sources-shared";

// Thanh "🔗 Liên kết sheet" cho các sheet TH Vật Tư / Nhân Công / Thiết Bị / Thầu Phụ: chọn nguồn (giá trị gói thầu, đầu mục BOQ...) để
// chèn LINK("khoá") vào ô số đang sửa. Ô số dùng <FormulaNum> bên trong thanh này.
const Ctx = createContext<{ setText: (t: string | null) => void } | null>(null);

export function LinkBarProvider({ options, values, children }: { options: GridSourceOption[]; values: Record<string, number>; children: React.ReactNode }) {
  const [text, setText] = useState<string | null>(null);
  const labelOf = new Map(options.map((o) => [o.value, o.label]));
  function insertLink(key: string) {
    const el = document.activeElement;
    if (!(el instanceof HTMLInputElement) || !el.hasAttribute("data-fcell")) {
      window.alert("Bấm vào ô đơn giá / số lượng cần tính trước, rồi mới chọn nguồn liên kết.");
      return;
    }
    const tok = `LINK("${key}")`;
    const cur = el.value;
    const startsF = cur.startsWith("=");
    const from = startsF ? (el.selectionStart ?? cur.length) : 1;
    const to = startsF ? (el.selectionEnd ?? from) : 1;
    const base = startsF ? cur : "=";
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, base.slice(0, from) + tok + base.slice(to));
    el.setSelectionRange(from + tok.length, from + tok.length);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const keys = [...new Set(linkKeysOf(text ?? ""))];
  return (
    <Ctx.Provider value={{ setText }}>
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600">
        <LinkPicker options={options} values={values} onPick={insertLink} />
        <span>Bấm vào ô đơn giá / số lượng rồi chọn nguồn để lấy số từ BOQ (hoặc gõ công thức như =LINK(&quot;boq_work&quot;)*0.5%).</span>
        {keys.map((k) => (
          <span key={k} className="text-[11px]">
            <b className="font-mono text-blue-700">LINK</b> = {labelOf.get(k) ?? "(nguồn không tồn tại)"}: <span className="font-mono">{k in values ? Math.round(values[k]).toLocaleString("vi-VN") : "#NAME?"}</span>
          </span>
        ))}
      </div>
      {children}
    </Ctx.Provider>
  );
}

// Ô số cho phép gõ công thức bắt đầu bằng = (lưu lại, tính lại theo dữ liệu BOQ); gõ số thường như cũ
export function FormulaNum({
  value,
  formula = "",
  err = "",
  onFormula,
  onCommit,
  decimals,
  qty,
  money,
  className,
  suffix,
  onMultiPaste,
}: {
  value: number;
  formula?: string;
  err?: string;
  onFormula: (f: string) => void;
  onCommit: (v: number | null) => void;
  decimals?: boolean;
  qty?: boolean; // ô khối lượng: hiện 2 số lẻ
  money?: boolean; // ô đơn giá: hiện tròn đồng
  className?: string;
  suffix?: string;
  onMultiPaste?: (lines: string[]) => void; // dán nhiều dòng (1 cột từ Excel) → điền xuống các ô bên dưới
}) {
  const ctx = useContext(Ctx);
  return (
    <NumInput
      value={value}
      decimals={decimals}
      qty={qty}
      money={money}
      suffix={suffix}
      allowFormula
      formula={formula}
      formulaAddr="link"
      onCommitFormula={onFormula}
      onCommit={onCommit}
      onMultiPaste={onMultiPaste}
      onActiveChange={(on) => ctx?.setText(on ? formula : null)}
      onTyping={(t) => ctx?.setText(t)}
      title={err ? `Lỗi công thức: ${err}` : formula ? formula : undefined}
      className={`${className ?? ""} ${err ? "!border-red-400 !text-red-600" : formula ? "!text-blue-800" : ""}`}
    />
  );
}
