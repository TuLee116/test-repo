"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { parsePriceFormulaInput } from "@/lib/formula";
import { fmtQty } from "@/lib/fmt-qty";

// Ô nhập số dùng chung: tự thêm dấu chấm hàng nghìn NGAY KHI GÕ (70000 → 70.000), dấu phẩy là số lẻ.
// Lưu (onCommit) khi bấm Enter hoặc bấm ra ngoài; onLive báo giá trị ngay lúc gõ để chỗ khác hiện theo liền.
// allowFormula: cho phép gõ công thức đơn giản (+ - * / ^), VD "1830000*1.05" - khi rời ô sẽ tính ra số rồi
// hiện kết quả như gõ số thường (không lưu lại công thức).

const FORMULA_CHARS = /[=+\-*/^]/;
function isFormulaText(s: string): boolean {
  return FORMULA_CHARS.test(s);
}

function fmtValue(n: number | null | undefined, decimals: boolean, qty = false, money = false, showZero = false): string {
  if (n === null || n === undefined) return "";
  if (n === 0) return showZero ? "0" : "";
  if (qty) return fmtQty(n);
  if (money) return Math.round(n).toLocaleString("vi-VN");
  return (decimals ? n : Math.round(n)).toLocaleString("vi-VN", { maximumFractionDigits: decimals ? 6 : 0 });
}

function group(intDigits: string): string {
  return intDigits.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Chuẩn hoá chuỗi đang gõ thành chuỗi hiển thị (có dấu chấm nghìn)
function normalize(raw: string, decimals: boolean): string {
  const s = raw.trim();
  if (!decimals) return group(s.replace(/\D/g, ""));
  const comma = s.indexOf(",");
  let intPart = s;
  let dec: string | null = null;
  if (comma >= 0) {
    intPart = s.slice(0, comma);
    dec = s.slice(comma + 1).replace(/\D/g, "");
  } else if (s.endsWith(".")) {
    // gõ dấu chấm ở cuối = muốn nhập số lẻ
    intPart = s.slice(0, -1);
    dec = "";
  }
  const g = group(intPart.replace(/\D/g, ""));
  return dec === null ? g : `${g || "0"},${dec.slice(0, 6)}`;
}

function parse(text: string): number {
  const n = Number(text.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

// Dán "1.5" (dấu chấm số lẻ) hoặc "1.234.567" (nghìn) từ Excel
function fromPasted(raw: string, decimals: boolean): string {
  const s = raw.trim().replace(/\s/g, "");
  if (!decimals) return normalize(String(Math.round(parse(s.replace(/,\d*$/, "")))), false);
  const dots = (s.match(/\./g) ?? []).length;
  const last = s.lastIndexOf(".");
  if (!s.includes(",") && dots === 1 && s.length - last - 1 !== 3) return normalize(s.replace(".", ","), true);
  return normalize(s, true);
}

export default function NumInput({
  value,
  onCommit,
  onLive,
  decimals = false,
  qty = false,
  money = false,
  allowEmpty = false,
  className,
  placeholder = "0",
  disabled,
  title,
  suffix,
  onMultiPaste,
  allowFormula = false,
  showZero = false,
  formula,
  onCommitFormula,
  onActiveChange,
  onTyping,
  formulaAddr,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  onLive?: (v: number) => void;
  decimals?: boolean;
  qty?: boolean; // ô khối lượng: lúc không sửa hiện đúng 2 số lẻ (VD 123,21), bấm vào ô mới hiện đủ số lẻ đã lưu
  money?: boolean; // ô đơn giá / tiền: lúc không sửa hiện số tròn đồng (không số lẻ), bấm vào ô mới hiện đủ số lẻ đã lưu
  allowEmpty?: boolean; // ô để trống = null (VD: chưa nhập giá báo)
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  title?: string;
  suffix?: string; // đơn vị hiện ngay trong ô, VD "%"
  onMultiPaste?: (lines: string[]) => void; // dán nhiều dòng (VD: 1 cột copy từ Excel) → điền lần lượt xuống các ô bên dưới
  allowFormula?: boolean; // cho phép gõ công thức đơn giản (+ - * / ^)
  showZero?: boolean; // hiện số 0 đã nhập (VD giá chi tiết vật tư = 0) thay vì để trống; ô để trống vẫn là chưa nhập
  // Công thức "sống" kiểu Excel (lưu lại, tính lại khi dữ liệu nguồn đổi): có onCommitFormula thì gõ bắt đầu bằng "=" sẽ được lưu
  // nguyên văn qua onCommitFormula thay vì tính ra số rồi bỏ công thức; formula = công thức đang lưu (hiện lại khi bấm vào ô).
  formula?: string;
  onCommitFormula?: (f: string) => void;
  onActiveChange?: (active: boolean) => void; // ô đang được chọn / rời đi (để thanh công thức biết)
  onTyping?: (text: string) => void; // nội dung đang gõ (để thanh công thức hiện theo)
  formulaAddr?: string; // địa chỉ ô kiểu Excel (VD D15), gắn vào ô để chèn liên kết đúng ô
}) {
  // Có suffix: các class về chiều rộng chuyển ra khung bọc, ô nhập luôn rộng đủ khung
  const tokens = (className ?? "").split(/\s+/).filter(Boolean);
  const wrapClass = tokens.filter((t) => /^(w|min-w|max-w)-/.test(t)).join(" ") || "w-full";
  const inputClass = ["w-full", ...tokens.filter((t) => !/^(w|min-w|max-w)-/.test(t))].join(" ");
  const [text, setText] = useState(() => fmtValue(value, decimals, qty, money, showZero));
  const [error, setError] = useState("");
  const focused = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(fmtValue(value, decimals, qty, money, showZero));
  }, [value, decimals, qty, money, showZero]);

  useLayoutEffect(() => {
    if (caret.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  });

  function apply(nextText: string, rawCaret: number | null, raw: string) {
    // giữ vị trí con trỏ theo số chữ số đứng trước nó
    if (rawCaret !== null && rawCaret < raw.length) {
      const digitsBefore = raw.slice(0, rawCaret).replace(/[^\d,]/g, "").length;
      let seen = 0;
      let pos = 0;
      while (pos < nextText.length && seen < digitsBefore) {
        if (/[\d,]/.test(nextText[pos])) seen++;
        pos++;
      }
      caret.current = pos;
    }
    dirty.current = true;
    setText(nextText);
    onLive?.(parse(nextText));
  }

  const input = (
    <input
      ref={inputRef}
      value={text}
      disabled={disabled}
      title={title}
      inputMode="decimal"
      placeholder={placeholder}
      data-fcell={formulaAddr}
      onFocus={(e) => {
        focused.current = true;
        setError("");
        const el = e.currentTarget;
        if (formula && onCommitFormula) {
          // ô đang có công thức: hiện công thức để sửa (như Excel)
          setText(formula);
          onTyping?.(formula);
          requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
        } else if ((qty || money) && value) {
          // khối lượng / đơn giá: hiện đủ số lẻ đã lưu để sửa cho đúng
          const full = fmtValue(value, decimals);
          setText(full);
          onTyping?.(full);
          requestAnimationFrame(() => el.select());
        } else {
          el.select();
          onTyping?.(text);
        }
        onActiveChange?.(true);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        // Đang gõ công thức (có =, +, -, *, /, ^): giữ nguyên chuỗi gõ, không chèn dấu chấm nghìn
        // (nếu không sẽ mất mấy ký tự phép tính ngay khi gõ)
        if (allowFormula && isFormulaText(raw)) {
          dirty.current = true;
          setText(raw);
          onTyping?.(raw);
          return;
        }
        apply(normalize(raw, decimals), e.target.selectionStart, raw);
        onTyping?.(raw);
      }}
      onPaste={(e) => {
        e.preventDefault();
        const pasted = e.clipboardData.getData("text");
        const lines = pasted.replace(/\r/g, "").split("\n");
        while (lines.length > 1 && lines[lines.length - 1].trim() === "") lines.pop();
        if (lines.length > 1 && onMultiPaste) {
          onMultiPaste(lines);
          return;
        }
        apply(fromPasted(pasted, decimals), null, pasted);
      }}
      onBlur={() => {
        focused.current = false;
        onActiveChange?.(false);
        if (onCommitFormula && dirty.current && text.trim().startsWith("=")) {
          dirty.current = false;
          setError("");
          if (text.trim() !== (formula ?? "")) onCommitFormula(text.trim());
          setText(fmtValue(value, decimals, qty, money, showZero));
          return;
        }
        if (!dirty.current) {
          setText(fmtValue(value, decimals, qty, money, showZero));
          return;
        }
        dirty.current = false;
        if (text === "" && allowEmpty) {
          if (value !== null) onCommit(null);
          setError("");
          return;
        }
        let v: number;
        if (allowFormula && isFormulaText(text)) {
          const parsed = parsePriceFormulaInput(text);
          if (!parsed.ok) {
            setError(parsed.error);
            return; // giữ nguyên công thức đang gõ để người dùng sửa lại
          }
          v = decimals ? parsed.value : Math.round(parsed.value);
        } else {
          v = parse(text);
        }
        setError("");
        const same = value === null && allowEmpty && showZero && text.trim() !== "" ? false : decimals ? v === (value ?? 0) : v === Math.round(value ?? 0);
        if (!same) onCommit(v);
        setText(fmtValue(v, decimals, qty, money, showZero));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          // Esc = huỷ nội dung đang gõ, trả về giá trị đã lưu (như Excel)
          dirty.current = false;
          setError("");
          setText(fmtValue(value, decimals, qty, money, showZero));
          e.currentTarget.blur();
        }
      }}
      className={suffix ? inputClass : className}
      style={{
        ...(suffix ? { paddingRight: 16 } : undefined),
        ...(error ? { borderColor: "#ef4444", backgroundColor: "#fef2f2" } : undefined),
      }}
    />
  );
  if (!suffix && !error) return input;
  return (
    <span className={`relative inline-block ${wrapClass}`}>
      {input}
      {suffix && <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-500">{suffix}</span>}
      {error && (
        <div className="absolute left-0 top-full z-30 whitespace-nowrap rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-normal not-italic text-white">
          {error}
        </div>
      )}
    </span>
  );
}
