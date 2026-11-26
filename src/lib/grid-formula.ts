// Bộ công thức kiểu Excel cho "bảng tự do": tham chiếu ô (B2, $B$2), vùng (B2:B10), toán tử + - * / ^ & % = <> < > <= >=,
// hàm SUM AVERAGE MIN MAX COUNT COUNTA ROUND ROUNDUP ROUNDDOWN ABS SQRT POWER MOD INT IF AND OR NOT IFERROR CONCAT LEN TEXT...
// Đối số phân cách bằng ; hoặc , — số thập phân dùng dấu chấm (0.5). Hàm thuần: chạy được cả server lẫn client.
import { parsePastedNumber } from "@/lib/parse-number";

export type CellValue = number | string | boolean | null; // null = ô trống
export class GridError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
type Range = { kind: "range"; r1: number; c1: number; r2: number; c2: number };
type Val = CellValue | Range;

export const colLetter = (c: number): string => {
  let s = "";
  let n = c + 1;
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
};
const colIndex = (letters: string): number => letters.toUpperCase().split("").reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

type Tok = { t: "num"; v: number } | { t: "str"; v: string } | { t: "ref"; r: number; c: number } | { t: "id"; v: string } | { t: "op"; v: string };

const REF = /^\$?([A-Za-z]{1,2})\$?(\d+)/;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '"') {
      let j = i + 1;
      let v = "";
      while (j < src.length && src[j] !== '"') v += src[j++];
      if (j >= src.length) throw new GridError("#VALUE!");
      out.push({ t: "str", v });
      i = j + 1;
    } else if (/[0-9.]/.test(ch)) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?|^\d+\.?/.exec(src.slice(i));
      if (!m) throw new GridError("#VALUE!");
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z$]/.test(ch)) {
      const m = REF.exec(src.slice(i));
      const after = m ? src[i + m[0].length] : undefined;
      if (m && after !== "(" && !/[A-Za-z_0-9.]/.test(after ?? "")) {
        out.push({ t: "ref", r: Number(m[2]) - 1, c: colIndex(m[1]) });
        i += m[0].length;
      } else {
        const id = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i));
        if (!id) throw new GridError("#NAME?");
        out.push({ t: "id", v: id[0].toUpperCase() });
        i += id[0].length;
      }
    } else if (src.startsWith("<>", i) || src.startsWith("<=", i) || src.startsWith(">=", i)) {
      out.push({ t: "op", v: src.slice(i, i + 2) });
      i += 2;
    } else if ("+-*/^&%=<>(),;:".includes(ch)) {
      out.push({ t: "op", v: ch === ";" ? "," : ch });
      i++;
    } else {
      throw new GridError("#NAME?");
    }
  }
  return out;
}

const ERR = /^#(REF!|DIV\/0!|VALUE!|NAME\?|NUM!|CIRC!)$/;
const isRange = (v: Val): v is Range => typeof v === "object" && v !== null && (v as Range).kind === "range";

export type Evaluator = {
  valueOf: (row: number, col: number) => CellValue; // giá trị đã tính của ô (lỗi trả về chuỗi "#...")
  raw: (row: number, col: number) => string;
};

// raw: hàm trả về nội dung gõ vào ô (công thức bắt đầu bằng "=")
// Ô là tổng phụ =SUBTOTAL(...): giống Excel, không cộng vào SUBTOTAL khác / tổng đầu mục / tổng cả bảng (tránh cộng 2 lần)
export const isSubtotalFormula = (raw: string) => /^=\s*SUBTOTAL\s*\(/i.test(raw.trim());

export function createEvaluator(raw: (row: number, col: number) => string, rowCount: number, colCount: number, links?: Record<string, number>): Evaluator {
  const memo = new Map<string, CellValue>();
  const computing = new Set<string>();

  function scalar(v: Val): CellValue {
    if (isRange(v)) throw new GridError("#VALUE!");
    return v;
  }
  const num = (v: Val): number => {
    const s = scalar(v);
    if (s === null || s === "") return 0;
    if (typeof s === "number") return s;
    if (typeof s === "boolean") return s ? 1 : 0;
    const n = parsePastedNumber(s);
    if (n === null) throw new GridError("#VALUE!");
    return n;
  };
  const truthy = (v: Val): boolean => {
    const s = scalar(v);
    if (typeof s === "boolean") return s;
    if (typeof s === "number") return s !== 0;
    if (typeof s === "string") return s !== "";
    return false;
  };
  const text = (v: Val): string => {
    const s = scalar(v);
    if (s === null) return "";
    if (typeof s === "boolean") return s ? "TRUE" : "FALSE";
    return String(s);
  };

  function cellValue(r: number, c: number): CellValue {
    if (r < 0 || c < 0 || r >= Math.max(rowCount, 1) + 2000 || c >= 60) throw new GridError("#REF!");
    const key = `${r}:${c}`;
    if (memo.has(key)) {
      const m = memo.get(key)!;
      if (typeof m === "string" && ERR.test(m)) throw new GridError(m);
      return m;
    }
    if (computing.has(key)) throw new GridError("#CIRC!");
    const s = raw(r, c).trim();
    let out: CellValue;
    if (s === "") out = null;
    else if (s.startsWith("=")) {
      computing.add(key);
      try {
        out = evaluate(s.slice(1));
      } catch (e) {
        out = e instanceof GridError ? e.code : "#VALUE!";
      } finally {
        computing.delete(key);
      }
    } else if (/^-?[\d.,]+%?$/.test(s)) {
      const pct = s.endsWith("%");
      const n = parsePastedNumber(pct ? s.slice(0, -1) : s);
      out = n === null ? s : pct ? n / 100 : n;
    } else out = s;
    memo.set(key, out);
    if (typeof out === "string" && ERR.test(out)) throw new GridError(out);
    return out;
  }

  function flatten(args: Val[]): CellValue[] {
    const out: CellValue[] = [];
    for (const a of args) {
      if (isRange(a)) {
        for (let r = Math.min(a.r1, a.r2); r <= Math.max(a.r1, a.r2); r++)
          for (let c = Math.min(a.c1, a.c2); c <= Math.max(a.c1, a.c2); c++) out.push(cellValue(r, c));
      } else out.push(a);
    }
    return out;
  }
  const nums = (args: Val[]): number[] =>
    flatten(args).flatMap((v) => (typeof v === "number" ? [v] : typeof v === "boolean" ? [] : typeof v === "string" && v !== "" && parsePastedNumber(v) !== null && !/[a-zA-Z]/.test(v) ? [parsePastedNumber(v) as number] : []));

  const round = (x: number, d: number, mode: "r" | "u" | "d") => {
    const f = 10 ** d;
    const y = x * f;
    return (mode === "r" ? Math.round(Math.abs(y)) * Math.sign(y) : mode === "u" ? Math.ceil(Math.abs(y)) * Math.sign(y) : Math.floor(Math.abs(y)) * Math.sign(y)) / f;
  };

  const FUNCS: Record<string, (a: Val[]) => CellValue> = {
    // LINK("khoá"): giá trị nguồn liên kết từ sheet khác (BOQ, TH Thiết Bị...); khoá lạ → #NAME?
    LINK: (a) => {
      const k = text(a[0]);
      if (!links || !Object.prototype.hasOwnProperty.call(links, k)) throw new GridError("#NAME?");
      return links[k];
    },
    SUM: (a) => nums(a).reduce((s, v) => s + v, 0),
    AVERAGE: (a) => {
      const n = nums(a);
      if (!n.length) throw new GridError("#DIV/0!");
      return n.reduce((s, v) => s + v, 0) / n.length;
    },
    MIN: (a) => (nums(a).length ? Math.min(...nums(a)) : 0),
    MAX: (a) => (nums(a).length ? Math.max(...nums(a)) : 0),
    COUNT: (a) => nums(a).length,
    COUNTA: (a) => flatten(a).filter((v) => v !== null && v !== "").length,
    ROUND: (a) => round(num(a[0]), a[1] === undefined ? 0 : num(a[1]), "r"),
    ROUNDUP: (a) => round(num(a[0]), a[1] === undefined ? 0 : num(a[1]), "u"),
    ROUNDDOWN: (a) => round(num(a[0]), a[1] === undefined ? 0 : num(a[1]), "d"),
    ABS: (a) => Math.abs(num(a[0])),
    SQRT: (a) => {
      const x = num(a[0]);
      if (x < 0) throw new GridError("#NUM!");
      return Math.sqrt(x);
    },
    POWER: (a) => num(a[0]) ** num(a[1]),
    MOD: (a) => {
      const d = num(a[1]);
      if (d === 0) throw new GridError("#DIV/0!");
      return ((num(a[0]) % d) + d) % d;
    },
    INT: (a) => Math.floor(num(a[0])),
    PI: () => Math.PI,
    AND: (a) => flatten(a).every((v) => truthy(v)),
    OR: (a) => flatten(a).some((v) => truthy(v)),
    NOT: (a) => !truthy(a[0]),
    CONCAT: (a) => flatten(a).map((v) => text(v)).join(""),
    CONCATENATE: (a) => flatten(a).map((v) => text(v)).join(""),
    LEN: (a) => text(a[0]).length,
    UPPER: (a) => text(a[0]).toUpperCase(),
    LOWER: (a) => text(a[0]).toLowerCase(),
    TRIM: (a) => text(a[0]).trim().replace(/\s+/g, " "),
    LEFT: (a) => text(a[0]).slice(0, a[1] === undefined ? 1 : Math.max(0, num(a[1]))),
    RIGHT: (a) => {
      const t = text(a[0]);
      const n = a[1] === undefined ? 1 : Math.max(0, num(a[1]));
      return n === 0 ? "" : t.slice(-n);
    },
    MID: (a) => text(a[0]).substr(Math.max(0, num(a[1]) - 1), Math.max(0, num(a[2]))),
    SUBSTITUTE: (a) => text(a[0]).split(text(a[1])).join(text(a[2])),
    ISNUMBER: (a) => typeof scalar(a[0]) === "number",
    ISTEXT: (a) => {
      const v = scalar(a[0]);
      return typeof v === "string" && v !== "";
    },
    ISBLANK: (a) => scalar(a[0]) === null,
    CEILING: (a) => {
      const sig = a[1] === undefined ? 1 : num(a[1]);
      return sig === 0 ? 0 : Math.ceil(num(a[0]) / sig) * sig;
    },
    FLOOR: (a) => {
      const sig = a[1] === undefined ? 1 : num(a[1]);
      return sig === 0 ? 0 : Math.floor(num(a[0]) / sig) * sig;
    },
    SUMIF: (a) => {
      const rg = rangeOf(a[0]);
      const sumRg = a[2] === undefined ? rg : rangeOf(a[2]);
      let sum = 0;
      for (let r = rg.r1; r <= rg.r2; r++)
        for (let c = rg.c1; c <= rg.c2; c++) {
          if (!matchesCriteria(cellValue(r, c), a[1])) continue;
          const v = cellValue(sumRg.r1 + (r - rg.r1), sumRg.c1 + (c - rg.c1));
          if (typeof v === "number") sum += v;
        }
      return sum;
    },
    COUNTIF: (a) => {
      const rg = rangeOf(a[0]);
      let n = 0;
      for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) if (matchesCriteria(cellValue(r, c), a[1])) n++;
      return n;
    },
    AVERAGEIF: (a) => {
      const rg = rangeOf(a[0]);
      const avgRg = a[2] === undefined ? rg : rangeOf(a[2]);
      let sum = 0;
      let n = 0;
      for (let r = rg.r1; r <= rg.r2; r++)
        for (let c = rg.c1; c <= rg.c2; c++) {
          if (!matchesCriteria(cellValue(r, c), a[1])) continue;
          const v = cellValue(avgRg.r1 + (r - rg.r1), avgRg.c1 + (c - rg.c1));
          if (typeof v === "number") {
            sum += v;
            n++;
          }
        }
      if (n === 0) throw new GridError("#DIV/0!");
      return sum / n;
    },
    SUMPRODUCT: (a) => {
      const rgs = a.map(rangeOf);
      const h = rgs[0].r2 - rgs[0].r1;
      const w = rgs[0].c2 - rgs[0].c1;
      if (rgs.some((g) => g.r2 - g.r1 !== h || g.c2 - g.c1 !== w)) throw new GridError("#VALUE!");
      let sum = 0;
      for (let i = 0; i <= h; i++)
        for (let j = 0; j <= w; j++) {
          let prod = 1;
          for (const g of rgs) {
            const v = cellValue(g.r1 + i, g.c1 + j);
            prod *= typeof v === "number" ? v : 0;
          }
          sum += prod;
        }
      return sum;
    },
    // SUBTOTAL(9; vùng) = tổng, bỏ qua các ô cũng là SUBTOTAL (tổng phụ lồng nhau); hỗ trợ 1 AVERAGE, 2 COUNT, 4 MAX, 5 MIN, 9 SUM
    SUBTOTAL: (a) => {
      const fn = num(a[0]);
      const vals: number[] = [];
      for (const arg of a.slice(1)) {
        const rg = rangeOf(arg);
        for (let r = rg.r1; r <= rg.r2; r++)
          for (let c = rg.c1; c <= rg.c2; c++) {
            if (isSubtotalFormula(raw(r, c))) continue;
            const v = cellValue(r, c);
            if (typeof v === "number") vals.push(v);
          }
      }
      if (fn === 1 || fn === 101) {
        if (!vals.length) throw new GridError("#DIV/0!");
        return vals.reduce((s, v) => s + v, 0) / vals.length;
      }
      if (fn === 2 || fn === 102 || fn === 3 || fn === 103) return vals.length;
      if (fn === 4 || fn === 104) return vals.length ? Math.max(...vals) : 0;
      if (fn === 5 || fn === 105) return vals.length ? Math.min(...vals) : 0;
      return vals.reduce((s, v) => s + v, 0);
    },
    VLOOKUP: (a) => {
      const rg = rangeOf(a[1]);
      const idx = Math.round(num(a[2]));
      if (idx < 1 || rg.c1 + idx - 1 > rg.c2) throw new GridError("#REF!");
      const exact = a[3] !== undefined && !truthy(a[3]);
      const key = scalar(a[0]);
      let found = -1;
      for (let r = rg.r1; r <= rg.r2; r++) {
        const v = cellValue(r, rg.c1);
        if (exact ? looseEquals(v, key) : looseCompare(v, key) <= 0 && v !== null) found = r;
        if (exact && found === r) break;
      }
      if (found < 0) throw new GridError("#VALUE!");
      return cellValue(found, rg.c1 + idx - 1);
    },
    MATCH: (a) => {
      const rg = rangeOf(a[1]);
      const type = a[2] === undefined ? 1 : num(a[2]);
      const key = scalar(a[0]);
      const horizontal = rg.r1 === rg.r2;
      const n = horizontal ? rg.c2 - rg.c1 + 1 : rg.r2 - rg.r1 + 1;
      const at = (i: number) => (horizontal ? cellValue(rg.r1, rg.c1 + i) : cellValue(rg.r1 + i, rg.c1));
      let found = -1;
      for (let i = 0; i < n; i++) {
        const v = at(i);
        if (type === 0) {
          if (looseEquals(v, key)) {
            found = i;
            break;
          }
        } else if (type > 0) {
          if (v !== null && looseCompare(v, key) <= 0) found = i;
        } else if (v !== null && looseCompare(v, key) >= 0) found = i;
      }
      if (found < 0) throw new GridError("#VALUE!");
      return found + 1;
    },
    INDEX: (a) => {
      const rg = rangeOf(a[0]);
      const horizontal = rg.r1 === rg.r2;
      const i = a[1] === undefined ? 1 : Math.round(num(a[1]));
      const j = a[2] === undefined ? (horizontal ? i : 1) : Math.round(num(a[2]));
      const r = horizontal ? rg.r1 : rg.r1 + i - 1;
      const c = horizontal && a[2] === undefined ? rg.c1 + j - 1 : rg.c1 + j - 1;
      if (r < rg.r1 || r > rg.r2 || c < rg.c1 || c > rg.c2) throw new GridError("#REF!");
      return cellValue(r, c);
    },
  };

  // vùng ô (đối số là 1 ô đơn cũng coi là vùng 1 ô)
  function rangeOf(v: Val): Range {
    if (isRange(v)) return { kind: "range", r1: Math.min(v.r1, v.r2), r2: Math.max(v.r1, v.r2), c1: Math.min(v.c1, v.c2), c2: Math.max(v.c1, v.c2) };
    throw new GridError("#VALUE!");
  }
  function looseEquals(a: CellValue, b: CellValue): boolean {
    if (typeof a === "number" && typeof b === "number") return a === b;
    return String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
  }
  function looseCompare(a: CellValue, b: CellValue): number {
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a ?? "").localeCompare(String(b ?? ""), "vi");
  }
  // điều kiện của SUMIF / COUNTIF: số, chữ (có * ?), hoặc ">5", "<>x", "=abc"
  function matchesCriteria(value: CellValue, crit: Val): boolean {
    const cr = scalar(crit);
    if (typeof cr === "number") return typeof value === "number" ? value === cr : false;
    let s = text(cr);
    let op = "=";
    const m = /^(<>|<=|>=|=|<|>)([\s\S]*)$/.exec(s);
    if (m) {
      op = m[1];
      s = m[2];
    }
    const asNum = s.trim() !== "" && /^-?[\d.,]+$/.test(s.trim()) ? parsePastedNumber(s.trim()) : null;
    if (asNum !== null && typeof value === "number") {
      const d = value - asNum;
      return op === "=" ? d === 0 : op === "<>" ? d !== 0 : op === "<" ? d < 0 : op === ">" ? d > 0 : op === "<=" ? d <= 0 : d >= 0;
    }
    const str = value === null ? "" : String(value);
    if (op === "=" || op === "<>") {
      const escaped = s.replace(/[.+^${}()|[\]\\]/g, (ch) => "\\" + ch);
      const re = new RegExp("^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
      return op === "=" ? re.test(str) : !re.test(str);
    }
    const cmp = str.localeCompare(s, "vi");
    return op === "<" ? cmp < 0 : op === ">" ? cmp > 0 : op === "<=" ? cmp <= 0 : cmp >= 0;
  }

  function evaluate(src: string): CellValue {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const isOp = (v: string) => peek()?.t === "op" && (peek() as { v: string }).v === v;

    function expr(): Val {
      return comparison();
    }
    function comparison(): Val {
      let x = concat();
      while (peek()?.t === "op" && ["=", "<>", "<", ">", "<=", ">="].includes((peek() as { v: string }).v)) {
        const op = (toks[p++] as { v: string }).v;
        const y = concat();
        const a = scalar(x);
        const b = scalar(y);
        const cmp = typeof a === "string" && typeof b === "string" ? a.localeCompare(b, "vi") : num(a) - num(b);
        x = op === "=" ? cmp === 0 : op === "<>" ? cmp !== 0 : op === "<" ? cmp < 0 : op === ">" ? cmp > 0 : op === "<=" ? cmp <= 0 : cmp >= 0;
      }
      return x;
    }
    function concat(): Val {
      let x = additive();
      while (isOp("&")) {
        p++;
        x = text(x) + text(additive());
      }
      return x;
    }
    function additive(): Val {
      let x = multiplicative();
      while (isOp("+") || isOp("-")) {
        const op = (toks[p++] as { v: string }).v;
        const y = multiplicative();
        x = op === "+" ? num(x) + num(y) : num(x) - num(y);
      }
      return x;
    }
    function multiplicative(): Val {
      let x = power();
      while (isOp("*") || isOp("/")) {
        const op = (toks[p++] as { v: string }).v;
        const y = power();
        if (op === "/") {
          const d = num(y);
          if (d === 0) throw new GridError("#DIV/0!");
          x = num(x) / d;
        } else x = num(x) * num(y);
      }
      return x;
    }
    function power(): Val {
      const base = unary();
      if (isOp("^")) {
        p++;
        return num(base) ** num(power());
      }
      return base;
    }
    function unary(): Val {
      if (isOp("-")) {
        p++;
        return -num(unary());
      }
      if (isOp("+")) {
        p++;
        return unary();
      }
      return postfix();
    }
    function postfix(): Val {
      let x = primary();
      while (isOp("%")) {
        p++;
        x = num(x) / 100;
      }
      return x;
    }
    function primary(): Val {
      const t = toks[p++];
      if (!t) throw new GridError("#VALUE!");
      if (t.t === "num") return t.v;
      if (t.t === "str") return t.v;
      if (t.t === "ref") {
        if (isOp(":")) {
          p++;
          const t2 = toks[p++];
          if (!t2 || t2.t !== "ref") throw new GridError("#REF!");
          return { kind: "range", r1: t.r, c1: t.c, r2: t2.r, c2: t2.c };
        }
        return cellValue(t.r, t.c);
      }
      if (t.t === "op" && t.v === "(") {
        const x = expr();
        if (!isOp(")")) throw new GridError("#VALUE!");
        p++;
        return x;
      }
      if (t.t === "id") {
        if (t.v === "TRUE") return true;
        if (t.v === "FALSE") return false;
        if (!isOp("(")) throw new GridError("#NAME?");
        p++;
        // IF / IFERROR: nhánh lỗi không lan ra nếu không được chọn
        if (t.v === "IF") {
          const cond = expr();
          const branches: Captured[] = [];
          while (isOp(",")) {
            p++;
            branches.push(capture());
          }
          if (!isOp(")")) throw new GridError("#VALUE!");
          p++;
          const pick = truthy(cond) ? branches[0] : branches[1];
          if (!pick) return truthy(cond);
          if (pick.e) throw pick.e;
          return pick.v as Val;
        }
        if (t.v === "IFERROR") {
          const first = capture();
          const alt: Captured[] = [];
          while (isOp(",")) {
            p++;
            alt.push(capture());
          }
          if (!isOp(")")) throw new GridError("#VALUE!");
          p++;
          if (!first.e) return first.v as Val;
          if (!alt[0]) return "";
          if (alt[0].e) throw alt[0].e;
          return alt[0].v as Val;
        }
        const args: Val[] = [];
        if (!isOp(")")) {
          args.push(expr());
          while (isOp(",")) {
            p++;
            args.push(expr());
          }
        }
        if (!isOp(")")) throw new GridError("#VALUE!");
        p++;
        const fn = FUNCS[t.v];
        if (!fn) throw new GridError("#NAME?");
        return fn(args);
      }
      throw new GridError("#VALUE!");
    }
    type Captured = { v?: Val; e?: GridError };
    // Đánh giá 1 đối số nhưng giữ lỗi lại (không ném); nếu lỗi, bỏ qua các token còn lại của đối số đó
    function capture(): Captured {
      const start = p;
      try {
        return { v: expr() };
      } catch (e) {
        if (!(e instanceof GridError)) throw e;
        p = start;
        let depth = 0;
        while (p < toks.length) {
          const tk = toks[p];
          if (tk.t === "op") {
            if (tk.v === "(") depth++;
            else if (tk.v === ")") {
              if (depth === 0) break;
              depth--;
            } else if (tk.v === "," && depth === 0) break;
          }
          p++;
        }
        return { e };
      }
    }

    const result = expr();
    if (p < toks.length) throw new GridError("#VALUE!");
    return scalar(result);
  }

  return {
    raw,
    valueOf(row, col) {
      try {
        return cellValue(row, col);
      } catch (e) {
        return e instanceof GridError ? e.code : "#VALUE!";
      }
    },
  };
}

// Hiển thị giá trị đã tính
export function formatCellValue(v: CellValue): string {
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return v.toLocaleString("vi-VN", { maximumFractionDigits: 6 });
  return v;
}
export const isNumberValue = (v: CellValue): v is number => typeof v === "number";

// ---- Chỉnh lại tham chiếu khi chèn / xoá / chuyển dòng cột (giống Excel) ----
export function remapFormula(formula: string, rowMap: (r: number) => number | null, colMap: (c: number) => number | null): string {
  if (!formula.startsWith("=")) return formula;
  let out = "";
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '"') {
      const j = formula.indexOf('"', i + 1);
      const end = j === -1 ? formula.length : j + 1;
      out += formula.slice(i, end);
      i = end;
      continue;
    }
    const prev = i > 0 ? formula[i - 1] : "";
    const m = /[A-Za-z$]/.test(ch) && !/[A-Za-z0-9_.]/.test(prev) ? /^(\$?)([A-Za-z]{1,2})(\$?)(\d+)/.exec(formula.slice(i)) : null;
    const after = m ? formula[i + m[0].length] : undefined;
    if (m && after !== "(" && !/[A-Za-z_0-9.]/.test(after ?? "")) {
      const nr = rowMap(Number(m[4]) - 1);
      const nc = colMap(colIndex(m[2]));
      out += nr === null || nc === null ? "#REF!" : `${m[1]}${colLetter(nc)}${m[3]}${nr + 1}`;
      i += m[0].length;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

// Các tham chiếu ô / vùng trong 1 công thức (để tô màu từng ô được dùng như Excel). Số dòng là số như đang gõ (1-based).
export type FormulaRef = { start: number; end: number; r1: number; c1: number; r2: number; c2: number };
export function formulaRefs(f: string): FormulaRef[] {
  const out: FormulaRef[] = [];
  let i = 0;
  while (i < f.length) {
    const ch = f[i];
    if (ch === '"') {
      const j = f.indexOf('"', i + 1);
      i = j === -1 ? f.length : j + 1;
      continue;
    }
    const prev = i > 0 ? f[i - 1] : "";
    if (/[A-Za-z$]/.test(ch) && !/[A-Za-z0-9_.]/.test(prev)) {
      const m = /^(\$?)([A-Za-z]{1,2})(\$?)(\d+)/.exec(f.slice(i));
      if (m) {
        const after = f[i + m[0].length];
        if (after !== "(" && !/[A-Za-z_0-9.]/.test(after ?? "")) {
          let end = i + m[0].length;
          let c2 = colIndex(m[2]);
          let r2 = Number(m[4]);
          if (f[end] === ":") {
            const m2 = /^:(\$?)([A-Za-z]{1,2})(\$?)(\d+)/.exec(f.slice(end));
            if (m2) {
              c2 = colIndex(m2[2]);
              r2 = Number(m2[4]);
              end += m2[0].length;
            }
          }
          const c1 = colIndex(m[2]);
          const r1 = Number(m[4]);
          out.push({ start: i, end, r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) });
          i = end;
          continue;
        }
      }
    }
    i++;
  }
  return out;
}

// Công thức được LƯU theo số dòng của vùng dữ liệu (dòng dữ liệu đầu tiên = dòng 1); hiển thị / gõ theo số dòng như Excel,
// trong đó dòng 1 là dòng trên cùng của tiêu đề (h = số dòng tiêu đề nằm trên vùng dữ liệu). Tham chiếu vào dòng tiêu đề → #REF!
export function toDisplayFormula(formula: string, h: number): string {
  const f = formula.trimStart();
  if (h === 0 || !f.startsWith("=")) return formula;
  return remapFormula(f, (r) => r + h, (c) => c);
}
export function toStoredFormula(formula: string, h: number): string {
  const f = formula.trimStart();
  if (h === 0 || !f.startsWith("=")) return formula;
  return remapFormula(f, (r) => (r - h >= 0 ? r - h : null), (c) => c);
}

// Điền xuống (Ctrl+D): dời số dòng của các tham chiếu tương đối
export function shiftRefsDown(formula: string, dRow: number): string {
  return shiftRefs(formula, dRow, 0);
}
// Sao chép / dán / điền công thức: dời cả dòng lẫn cột của các tham chiếu tương đối (tham chiếu có $ giữ nguyên)
export function shiftRefs(formula: string, dRow: number, dCol: number): string {
  if (!formula.startsWith("=")) return formula;
  return remapFormulaRel(formula, dRow, dCol);
}
function remapFormulaRel(formula: string, dRow: number, dCol = 0): string {
  let out = "";
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '"') {
      const j = formula.indexOf('"', i + 1);
      const end = j === -1 ? formula.length : j + 1;
      out += formula.slice(i, end);
      i = end;
      continue;
    }
    const prev = i > 0 ? formula[i - 1] : "";
    const m = /[A-Za-z$]/.test(ch) && !/[A-Za-z0-9_.]/.test(prev) ? /^(\$?)([A-Za-z]{1,2})(\$?)(\d+)/.exec(formula.slice(i)) : null;
    const after = m ? formula[i + m[0].length] : undefined;
    if (m && after !== "(" && !/[A-Za-z_0-9.]/.test(after ?? "")) {
      const row = m[3] === "$" ? Number(m[4]) : Math.max(1, Number(m[4]) + dRow);
      const col = m[1] === "$" ? colIndex(m[2]) : Math.max(0, colIndex(m[2]) + dCol);
      out += `${m[1]}${colLetter(col)}${m[3]}${row}`;
      i += m[0].length;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}
