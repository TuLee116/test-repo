// Tính công thức kiểu Excel cho ô Định mức: + - * / ^ ( ), số thập phân dùng , hoặc .,
// hàm ROUND(x;n) SQRT ABS MIN MAX và hằng PI. Không dùng eval.

class FormulaError extends Error {}

type Tok = { t: "num"; v: number } | { t: "op"; v: string } | { t: "id"; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[\d.,]/.test(c)) {
      let j = i;
      while (j < src.length && /[\d.,]/.test(src[j])) j++;
      const raw = src.slice(i, j).replace(",", ".");
      const v = Number(raw);
      if (!Number.isFinite(v)) throw new FormulaError("Số không hợp lệ");
      out.push({ t: "num", v });
      i = j;
    } else if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z]/.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j).toUpperCase() });
      i = j;
    } else if ("+-*/^()×÷;".includes(c)) {
      out.push({ t: "op", v: c === "×" ? "*" : c === "÷" ? "/" : c });
      i++;
    } else {
      throw new FormulaError(`Ký tự không hợp lệ: ${c}`);
    }
  }
  return out;
}

const FUNCS: Record<string, (a: number[]) => number> = {
  ROUND: (a) => {
    const f = 10 ** (a[1] ?? 0);
    return Math.round(a[0] * f) / f;
  },
  SQRT: (a) => Math.sqrt(a[0]),
  ABS: (a) => Math.abs(a[0]),
  MIN: (a) => Math.min(...a),
  MAX: (a) => Math.max(...a),
};

function evaluate(src: string): number {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === "op" && (peek() as { v: string }).v === v;

  function expr(): number {
    let x = term();
    while (isOp("+") || isOp("-")) {
      const op = (toks[p++] as { v: string }).v;
      const y = term();
      x = op === "+" ? x + y : x - y;
    }
    return x;
  }
  function term(): number {
    let x = power();
    while (isOp("*") || isOp("/")) {
      const op = (toks[p++] as { v: string }).v;
      const y = power();
      if (op === "/" && y === 0) throw new FormulaError("Chia cho 0");
      x = op === "*" ? x * y : x / y;
    }
    return x;
  }
  function power(): number {
    const base = unary();
    if (isOp("^")) {
      p++;
      return base ** power();
    }
    return base;
  }
  function unary(): number {
    if (isOp("-")) {
      p++;
      return -unary();
    }
    if (isOp("+")) {
      p++;
      return unary();
    }
    return primary();
  }
  function primary(): number {
    const t = toks[p++];
    if (!t) throw new FormulaError("Công thức chưa đầy đủ");
    if (t.t === "num") return t.v;
    if (t.t === "op" && t.v === "(") {
      const x = expr();
      if (!isOp(")")) throw new FormulaError("Thiếu dấu )");
      p++;
      return x;
    }
    if (t.t === "id") {
      if (t.v === "PI") return Math.PI;
      const fn = FUNCS[t.v];
      if (!fn) throw new FormulaError(`Không có hàm ${t.v}`);
      if (!isOp("(")) throw new FormulaError(`Thiếu ( sau ${t.v}`);
      p++;
      const args: number[] = [expr()];
      while (isOp(";")) {
        p++;
        args.push(expr());
      }
      if (!isOp(")")) throw new FormulaError("Thiếu dấu )");
      p++;
      return fn(args);
    }
    throw new FormulaError("Công thức không hợp lệ");
  }

  const v = expr();
  if (p < toks.length) throw new FormulaError("Công thức không hợp lệ");
  if (!Number.isFinite(v)) throw new FormulaError("Kết quả không hợp lệ");
  return v;
}

// Đọc ô định mức: số thường ("0,333") hoặc công thức ("=1/3", "1/3+0.5")
export function parseQuantityInput(raw: string): { ok: true; value: number; formula: string | null } | { ok: false; error: string } {
  const s = raw.trim();
  if (s === "") return { ok: true, value: 0, formula: null };
  try {
    const isPlain = /^[+-]?\d+([.,]\d+)?$/.test(s);
    if (isPlain) return { ok: true, value: Number(s.replace(",", ".")), formula: null };
    const body = s.startsWith("=") ? s.slice(1) : s;
    const value = evaluate(body);
    return { ok: true, value, formula: body.trim() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Công thức không hợp lệ" };
  }
}

// Công thức Tổng KL của dòng hao phí (CHI TIẾT): được dùng KL = khối lượng BOQ của dòng, VD "=KL/0.2" (chia bề rộng tường)
export function parseQtyWithKL(raw: string, kl: number): { ok: true; value: number; formula: string | null } | { ok: false; error: string } {
  const klText = String(+kl.toFixed(10));
  return parseQuantityInput(raw.replace(/\bKL\b/gi, `(${klText})`));
}

// Gỡ dấu chấm hàng nghìn trong 1 số hạng (VD "200.000" -> "200000"), giữ dấu phẩy làm số lẻ
// ("1.830.000,5" -> "1830000.5"). 1 dấu chấm mà không phải đúng 3 chữ số sau nó thì coi là số thập phân
// (VD "1.05" vẫn là 1,05) - cùng quy tắc đang dùng khi dán số từ Excel (xem NumInput.fromPasted).
function stripThousandDots(numLiteral: string): string {
  if (numLiteral.includes(",")) {
    const i = numLiteral.indexOf(",");
    return numLiteral.slice(0, i).replace(/\./g, "") + "." + numLiteral.slice(i + 1);
  }
  const dots = (numLiteral.match(/\./g) ?? []).length;
  if (dots === 0) return numLiteral;
  const last = numLiteral.lastIndexOf(".");
  const trailingDigits = numLiteral.length - last - 1;
  if (dots === 1 && /^0\./.test(numLiteral)) return numLiteral; // 0.024 là số thập phân, không phải 24
  if (dots >= 2 || trailingDigits === 3) return numLiteral.replace(/\./g, "");
  return numLiteral;
}

// Đọc ô giá (tiền): số thường hoặc công thức ("200.000*1.05", "=1.830.000+50000"). Khác parseQuantityInput
// ở chỗ dấu chấm trong số tiền được hiểu là hàng nghìn (đúng thói quen gõ giá), không phải số thập phân.
export function parsePriceFormulaInput(raw: string): { ok: true; value: number; formula: string | null } | { ok: false; error: string } {
  let normalized = "";
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (/[\d.,]/.test(c)) {
      let j = i;
      while (j < raw.length && /[\d.,]/.test(raw[j])) j++;
      normalized += stripThousandDots(raw.slice(i, j));
      i = j;
    } else {
      normalized += c;
      i++;
    }
  }
  return parseQuantityInput(normalized);
}
