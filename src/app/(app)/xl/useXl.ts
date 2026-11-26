"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { balanceParens, evalGrid, forEval, numRaw, toDisplay, toStable, xlAddr, type XlLayout } from "@/lib/xl-formula";

// ---- Công thức kiểu Excel trên bảng dữ liệu ở state (xem src/lib/xl-formula.ts) ----
// Mỗi dòng có `formulas` {khoáCột: "=[[mãDòng|cột]]*1,05"}; ô có công thức thì giá trị số được TÍNH LẠI mỗi khi dữ liệu đổi.
export type XlLine = { id: string; formulas: Record<string, string> };

export function useXlFormulas<L extends XlLine>(opts: {
  lines: L[];
  setLines: (fn: (ls: L[]) => L[]) => void;
  cols: string[]; // khoá cột theo thứ tự hiện (A, B, C...)
  valueOf: (l: L, col: string, index: number) => number | string | null; // giá trị ô KHÔNG phải công thức (kể cả cột tính sẵn như thành tiền)
  silent?: () => void; // báo cho lịch sử Ctrl+Z: lần cập nhật tới là tự tính lại, không phải thao tác của người dùng
  // ô số không nằm thẳng trên dòng (VD giá thầu phụ nằm trong bids): đọc giá trị đang lưu + ghi kết quả tính được
  read?: (l: L, col: string) => unknown;
  apply?: (l: L, patch: Record<string, number | null>) => L;
}) {
  const { lines, setLines, cols, valueOf, silent, read, apply } = opts;
  const lay: XlLayout = useMemo(() => ({ rows: lines.map((l) => l.id), cols }), [lines, cols]);
  const addr = useCallback((id: string, col: string) => xlAddr(lay, id, col), [lay]);
  const formulaOf = useCallback((l: L, col: string) => (l.formulas?.[col] ? toDisplay(l.formulas[col], lay) : ""), [lay]);

  // tính các ô có công thức: giá trị mới (patch) + lỗi (#REF!, #CIRC!...)
  const result = useMemo(() => {
    const patch = new Map<string, Record<string, number | null>>();
    const errors: Record<string, string> = {};
    if (!lines.some((l) => l.formulas && Object.keys(l.formulas).length)) return { patch, errors };
    const ev = evalGrid(lay, (r, c) => {
      const l = lines[r];
      const col = cols[c];
      if (!l || !col) return "";
      const f = l.formulas?.[col];
      if (f) return forEval(toDisplay(f, lay)); // 1,05 = số thập phân như Excel tiếng Việt
      const v = valueOf(l, col, r);
      return typeof v === "number" ? numRaw(v) : (v ?? "");
    });
    lines.forEach((l, r) => {
      for (const col of Object.keys(l.formulas ?? {})) {
        const c = cols.indexOf(col);
        if (c < 0) continue;
        const v: unknown = ev.valueOf(r, c);
        let n: number | null = null;
        if (typeof v === "number") n = v;
        else if (typeof v === "string" && v.startsWith("#")) errors[`${l.id}|${col}`] = v;
        const cur = read ? read(l, col) : (l as unknown as Record<string, unknown>)[col];
        const curN = typeof cur === "number" ? cur : null;
        if ((n == null) !== (curN == null) || (n != null && curN != null && Math.abs(n - curN) > 1e-9)) patch.set(l.id, { ...(patch.get(l.id) ?? {}), [col]: n });
      }
    });
    return { patch, errors };
  }, [lines, lay, cols, valueOf, read]);

  // ghi giá trị vừa tính vào ô (không tính là 1 bước Ctrl+Z)
  useEffect(() => {
    const { patch } = result;
    if (!patch.size) return;
    silent?.();
    setLines((ls) => ls.map((l) => (patch.has(l.id) ? (apply ? apply(l, patch.get(l.id)!) : ({ ...l, ...patch.get(l.id) } as L)) : l)));
  }, [result, setLines, silent, apply]);
  const errors = result.errors;

  // ghi công thức (dạng địa chỉ) vào ô; chuỗi không bắt đầu bằng "=" thì xoá công thức của ô
  const setFormula = useCallback(
    (id: string, col: string, display: string) =>
      setLines((ls) =>
        ls.map((l) => {
          if (l.id !== id) return l;
          const f = { ...(l.formulas ?? {}) };
          if (display.trim().startsWith("=")) f[col] = toStable(balanceParens(display.trim()), { rows: ls.map((x) => x.id), cols });
          else delete f[col];
          return { ...l, formulas: f };
        }),
      ),
    [setLines, cols],
  );
  const clearFormula = useCallback((l: L, col: string): Record<string, string> => {
    if (!l.formulas?.[col]) return l.formulas ?? {};
    const f = { ...l.formulas };
    delete f[col];
    return f;
  }, []);

  return { lay, addr, formulaOf, setFormula, clearFormula, errors };
}

// ---- Hoàn tác / làm lại (Ctrl+Z / Ctrl+Y) trên state của bảng ----
// Gõ liên tục trong < 0,7 giây gộp thành 1 bước. Lần cập nhật đánh dấu silent() (tự tính lại công thức) không thành bước riêng.
export function useUndo<T>(state: T, restore: (t: T) => void) {
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const last = useRef(state);
  const skip = useRef(false);
  const quiet = useRef(false);
  const lastPush = useRef(0);
  const [counts, setCounts] = useState({ u: 0, r: 0 });
  const force = () => setCounts({ u: past.current.length, r: future.current.length });

  useEffect(() => {
    if (state === last.current) return;
    if (skip.current || quiet.current) {
      skip.current = false;
      quiet.current = false;
      last.current = state;
      return;
    }
    const now = Date.now();
    if (now - lastPush.current > 700 || !past.current.length) {
      past.current.push(last.current);
      if (past.current.length > 100) past.current.shift();
      lastPush.current = now;
    }
    future.current = [];
    last.current = state;
    force();
  }, [state]);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (prev === undefined) return false;
    future.current.push(last.current);
    skip.current = true;
    lastPush.current = 0;
    restore(prev);
    force();
    return true;
  }, [restore]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next === undefined) return false;
    past.current.push(last.current);
    skip.current = true;
    lastPush.current = 0;
    restore(next);
    force();
    return true;
  }, [restore]);
  const silent = useCallback(() => {
    quiet.current = true;
  }, []);
  return { undo, redo, silent, canUndo: counts.u > 0, canRedo: counts.r > 0 };
}
