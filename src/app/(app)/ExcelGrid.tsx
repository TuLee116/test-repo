"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parsePastedNumber } from "@/lib/parse-number";
import { cycleAbsAt, shiftDisplay } from "@/lib/xl-formula";
import { formulaRefs } from "@/lib/grid-formula";

// Bảng nhập liệu thao tác như Excel (dùng cho các bảng nhập ở state phía client, VD phân hệ Mua vật tư, duyệt giá).
// Bọc quanh <table>; mỗi ô nhập đặt trong phần tử có data-xr (khoá dòng) + data-xc (khoá cột), dùng helper xcell().
//  - Enter: xuống ô cùng cột dòng dưới · Shift+Enter: lên · Tab / Shift+Tab: sang phải / trái (mặc định trình duyệt)
//  - ↑ ↓: lên / xuống ô cùng cột · ← →: sang ô bên trái / phải khi con trỏ đang ở đầu / cuối chữ trong ô
//  - Ctrl+V: dán cả vùng copy từ Excel (nhiều dòng × nhiều cột) bắt đầu từ ô đang đứng, theo thứ tự dòng / cột đang hiện
//  - Ô số: gõ công thức như Excel (=300*1,05 hoặc 300*1.05) — xem NumInput allowFormula
// Có prop `xl` (bảng duyệt giá) thì thêm:
//  - THANH CÔNG THỨC trên đầu bảng: tên ô (K5) + nội dung / công thức ô đang chọn, sửa rồi Enter để ghi
//  - đang gõ công thức (bắt đầu bằng "=") ở ô hoặc thanh công thức: BẤM vào ô khác → chèn địa chỉ ô đó (như Excel)
//  - CHỌN VÙNG: kéo chuột hoặc Shift + bấm · Ctrl+C chép vùng (dán sang Excel được) · Delete xoá cả vùng · Ctrl+D điền xuống
//  - Ctrl+Z hoàn tác · Ctrl+Y (hoặc Ctrl+Shift+Z) làm lại
// CHUỘT PHẢI vào ô: menu Chép / Xoá nội dung (có xl) + Chèn dòng phía trên / dưới, Xoá dòng (có rowOps; nhiều dòng đang chọn → chèn / xoá đúng chừng ấy dòng)
export type GridPaste = { row: string; col: string; text: string; num: number | null };
export type XlGridApi = {
  addr: (row: string, col: string) => string; // địa chỉ ô kiểu Excel
  raw: (row: string, col: string) => string; // nội dung hiện ở thanh công thức (công thức hoặc giá trị)
  text?: (row: string, col: string) => string; // GIÁ TRỊ hiện của ô (không phải công thức) — để Ctrl+C dán sang Excel / nơi khác ra số, không ra công thức
  set: (row: string, col: string, text: string) => void; // ghi ô: "=..." công thức · số · chữ · "" xoá
  onUndo?: () => void;
  onRedo?: () => void;
};

// CHÈN / XOÁ DÒNG bằng menu chuột phải (như Excel). `rows` = mã các dòng đang chọn (theo thứ tự trên màn hình);
// chèn: số dòng chèn = số dòng đang chọn (như Excel), chèn phía trên dòng đầu / phía dưới dòng cuối vùng chọn.
export type GridRowOps = {
  insert: (anchor: string, where: "above" | "below", count: number) => void;
  remove: (rows: string[]) => void;
};

// LỌC theo cột (như AutoFilter): ẩn các dòng không khớp điều kiện ở cột đó; dòng không có ô ở cột đó (tổng cộng...) luôn hiện
export type GridFilter = { col: string; kind: "contains" | "empty" | "notEmpty"; value: string };
// GHI CHÚ Ô (như Note/Comment của Excel): góc ô có tam giác đỏ, rê chuột vào là đọc; lưu ngay (không chờ Lưu nháp)
export type GridNote = { id: string; row: string; col: string; text: string; user: string; at: string; mine: boolean };
export type GridNotesApi = {
  list: GridNote[];
  add: (row: string, col: string, text: string) => Promise<string | null>; // trả về lỗi (null = đã lưu)
  remove: (id: string) => Promise<string | null>;
  canAdd?: boolean;
};

export const xcell = (row: string, col: string) => ({ "data-xr": row, "data-xc": col });
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().trim();
// số kiểu Việt Nam đang hiện trong ô (1.234.567,5 · -12 · 15%) → số; không phải số → null
const numOfText = (s: string): number | null => {
  const t = s.replace(/\s/g, "").replace(/%$/, "");
  if (!/^-?[\d.]*\d(,\d+)?$/.test(t)) return null;
  const v = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
};
// nội dung gốc của ô (dạng lưu) là số thường (không công thức) → số
const numOfRaw = (s: string): number | null => (/^-?\d+(,\d+)?$/.test(s.trim()) ? Number(s.trim().replace(",", ".")) : null);
const rawOfNum = (v: number) => String(Math.round(v * 1e9) / 1e9).replace(".", ",");
const fmtStat = (v: number) => v.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

const FOCUSABLE = "input:not([type=checkbox]):not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])";
const SEL_BG = "#dbeafe";
// màu viền các ô / vùng được công thức tham chiếu (như Excel: mỗi địa chỉ trong công thức 1 màu)
const REF_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#be185d", "#65a30d"];
const colNum = (letters: string) => letters.split("").reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

type Pos = { r: number; c: number };

// Vùng vừa Ctrl+C trong bảng: giữ CÔNG THỨC từng ô để Ctrl+V dán lại có dời địa chỉ tương đối như Excel (VD =E5*F5 ở dòng 5 → =E6*F6 ở dòng 6).
// `text` = chữ đã đưa lên clipboard hệ thống; chỉ khi chữ dán vào giống hệt thì mới dùng bản có công thức (dán từ nơi khác thì xử lý như dán chữ thường).
type XlClip = { text: string; srcRows: string[]; srcCols: string[]; cells: string[][] };
let xlClip: XlClip | null = null;

// ĐANG GÕ CÔNG THỨC (ô bắt đầu bằng "=") — như Excel:
//  - sau dấu = ( , ; + - * / ^ ... : phím ↑ ↓ ← → CHỌN ô tham chiếu (chèn địa chỉ K5, ↑↓←→ tiếp thì dời ô, Shift+mũi tên = chọn vùng K5:K9)
//  - kéo chuột trên các ô = chọn vùng (K5:K9); bấm 1 ô = chèn địa chỉ ô đó
//  - F2 (hoặc bấm đúp) = chế độ sửa: ← → chỉ dời con trỏ trong ô, ↑ ↓ không rời ô · Enter ghi + xuống ô dưới · Tab ghi + sang phải · Esc huỷ
//  - thiếu dấu ")" thì tự thêm khi ghi (như Excel)
type PointState = { el: HTMLInputElement; start: number; end: number; anchor: Pos; cur: Pos; drag: boolean };

export default function ExcelGrid({
  cols,
  refCols,
  onPaste,
  children,
  className,
  xl,
  rowOps,
  notes,
  widthKey,
}: {
  cols: string[]; // thứ tự cột để dán ngang (khoá data-xc)
  refCols?: string[]; // thứ tự TẤT CẢ cột (kể cả cột chỉ đọc) để chọn ô tham chiếu bằng phím mũi tên khi gõ công thức; mặc định = cols
  onPaste?: (cells: GridPaste[]) => void; // nhận các ô cần ghi khi dán vùng nhiều ô
  children: React.ReactNode;
  className?: string;
  xl?: XlGridApi;
  rowOps?: GridRowOps;
  notes?: GridNotesApi;
  widthKey?: string; // có → kéo mép phải tiêu đề cột để giãn độ rộng, nhớ theo trình duyệt của từng người (localStorage)
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pointRef = useRef<PointState | null>(null); // ô / vùng tham chiếu đang chọn bằng phím mũi tên hoặc kéo chuột
  const inserting = useRef(false); // đang tự chèn địa chỉ (không coi là người dùng gõ)
  const editEl = useRef<HTMLElement | null>(null); // ô đang ở chế độ sửa (F2 / bấm đúp): mũi tên chỉ dời con trỏ
  const barRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState<{ row: string; col: string } | null>(null);
  const [bar, setBar] = useState("");
  const activeRef = useRef<{ row: string; col: string } | null>(null); // ô đang chọn mới nhất (cho các hàm trễ setTimeout)
  const barEditing = useRef(false);
  // ô / thanh công thức mà người dùng ĐÃ GÕ (hoặc chèn địa chỉ) kể từ lúc vào ô — chỉ khi đó bấm ô khác mới chèn địa chỉ ô đó (như Excel).
  // Chỉ bấm vào ô có công thức (công thức hiện sẵn để xem) thì bấm chỗ khác = chuyển ô, KHÔNG sửa công thức. Esc = thôi gõ.
  const typedEl = useRef<HTMLElement | null>(null);
  const [hideRef, setHideRef] = useState(false); // Esc: tắt luôn khung tô viền các ô tham chiếu (cho tới khi chọn ô khác / gõ lại)
  const [, setSelState] = useState<{ a: Pos; b: Pos } | null>(null); // chỉ để vẽ lại khi vùng chọn đổi
  // vùng chọn giữ thêm ở ref: sự kiện chuột liên tiếp đọc được ngay (state React chưa kịp cập nhật)
  const selRef = useRef<{ a: Pos; b: Pos } | null>(null);
  const setSel = (v: { a: Pos; b: Pos } | null) => {
    selRef.current = v;
    setSelState(v);
  };
  const dragging = useRef(false);
  // menu chuột phải: vị trí + các dòng đang chọn lúc bấm
  const [menu, setMenu] = useState<{ x: number; y: number; rows: string[]; row: string; col: string } | null>(null);

  // cột dùng cho CHỌN VÙNG / chép / điền: mọi cột của bảng (kể cả cột chỉ đọc như thành tiền) để chọn vùng như Excel; ghi chỉ vào ô nhập được
  const sc = refCols ?? cols;
  const fillRef = useRef<{ q: { r1: number; r2: number; c1: number; c2: number }; t: { r1: number; r2: number; c1: number; c2: number } | null } | null>(null);
  const [filters, setFilters] = useState<GridFilter[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [fDraft, setFDraft] = useState<GridFilter | null>(null);
  const [noteEdit, setNoteEdit] = useState<{ row: string; col: string; x: number; y: number } | null>(null);
  const [noteTip, setNoteTip] = useState<{ row: string; col: string; x: number; y: number } | null>(null);

  const cellOf = (el: EventTarget | null) => (el instanceof Element ? el.closest<HTMLElement>("[data-xr][data-xc]") : null);
  // các dòng đang HIỆN theo thứ tự trên màn hình (dòng bị lọc ẩn thì bỏ qua)
  const rowsInDom = () => {
    const rows: string[] = [];
    const seen = new Set<string>();
    rootRef.current?.querySelectorAll<HTMLElement>("[data-xr]").forEach((el) => {
      const k = el.dataset.xr!;
      if (seen.has(k) || el.closest("[data-xhide]")) return;
      seen.add(k);
      rows.push(k);
    });
    return rows;
  };
  const posOf = (cell: HTMLElement): Pos | null => {
    const r = rowsInDom().indexOf(cell.dataset.xr!);
    const c = sc.indexOf(cell.dataset.xc!);
    return r < 0 || c < 0 ? null : { r, c };
  };
  const rect = () => {
    const s = selRef.current;
    return s ? { r1: Math.min(s.a.r, s.b.r), r2: Math.max(s.a.r, s.b.r), c1: Math.min(s.a.c, s.b.c), c2: Math.max(s.a.c, s.b.c) } : null;
  };
  const multi = () => {
    const q = rect();
    return !!q && (q.r1 !== q.r2 || q.c1 !== q.c2);
  };
  const cellAt = (row: string, col: string) => rootRef.current?.querySelector<HTMLElement>(`[data-xr="${CSS.escape(row)}"][data-xc="${CSS.escape(col)}"]`) ?? null;
  const cellsInRect = () => {
    const q = rect();
    if (!q) return [] as { row: string; col: string; r: number; c: number; el: HTMLElement | null }[];
    const rows = rowsInDom();
    const out: { row: string; col: string; r: number; c: number; el: HTMLElement | null }[] = [];
    for (let r = q.r1; r <= q.r2; r++) for (let c = q.c1; c <= q.c2; c++) if (rows[r] && sc[c]) out.push({ row: rows[r], col: sc[c], r, c, el: cellAt(rows[r], sc[c]) });
    return out;
  };

  // tô nền vùng đang chọn (≥ 2 ô)
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !xl) return;
    root.querySelectorAll<HTMLElement>("[data-xsel]").forEach((el) => {
      el.removeAttribute("data-xsel");
      el.style.removeProperty("background-color");
      el.style.removeProperty("box-shadow");
    });
    if (!multi()) return;
    for (const x of cellsInRect()) {
      if (!x.el) continue;
      x.el.setAttribute("data-xsel", "1");
      x.el.style.backgroundColor = SEL_BG;
      x.el.style.boxShadow = "inset 0 0 0 1px #3b82f6";
    }
  });

  // GIÁ TRỊ đang hiện của ô (để lọc / thanh trạng thái)
  const valueText = (row: string, col: string, el?: HTMLElement | null): string => {
    if (xl?.text) return xl.text(row, col);
    const cell = el ?? cellAt(row, col);
    const inp = cell?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input:not([type=checkbox]), textarea, select");
    return inp ? (inp instanceof HTMLSelectElement ? (inp.selectedOptions[0]?.text ?? "") : inp.value) : (cell?.textContent ?? "");
  };

  // đặt position:relative cho ô để gắn lớp phủ (ô dính sticky giữ nguyên)
  const anchorCell = (el: HTMLElement) => {
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
  };

  // TAY NẮM KÉO ĐIỀN (ô vuông nhỏ góc dưới phải vùng chọn, như Excel) + khung nét đứt vùng sẽ điền khi đang kéo
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !xl) return;
    root.querySelectorAll<HTMLElement>("[data-xfh]").forEach((o) => o.remove());
    root.querySelectorAll<HTMLElement>("[data-xfill]").forEach((el) => {
      el.removeAttribute("data-xfill");
      el.style.removeProperty("outline");
      el.style.removeProperty("outline-offset");
    });
    const f = fillRef.current;
    const rows = rowsInDom();
    if (f?.t) {
      for (let r = f.t.r1; r <= f.t.r2; r++)
        for (let c = f.t.c1; c <= f.t.c2; c++) {
          const el = rows[r] && sc[c] ? cellAt(rows[r], sc[c]) : null;
          if (!el) continue;
          el.setAttribute("data-xfill", "1");
          el.style.outline = "1px dashed #2563eb";
          el.style.outlineOffset = "-2px";
        }
    }
    const q = rect();
    if (!q || !cols.length) return; // không có ô nào sửa được (chỉ xem) → không hiện tay nắm
    const el = rows[q.r2] && sc[q.c2] ? cellAt(rows[q.r2], sc[q.c2]) : null;
    if (!el) return;
    const h = document.createElement("div");
    h.setAttribute("data-xfh", "1");
    h.title = "Kéo để điền (như Excel): 1 ô → chép; 2 ô số trở lên → dãy số tăng đều; công thức dời địa chỉ";
    h.style.cssText = "position:absolute;right:0;bottom:0;width:7px;height:7px;background:#2563eb;border:1px solid #fff;cursor:crosshair;z-index:6";
    anchorCell(el);
    el.appendChild(h);
  });

  // LỌC: ẩn dòng không khớp
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>("tr[data-xhide]").forEach((tr) => {
      tr.removeAttribute("data-xhide");
      tr.style.removeProperty("display");
    });
    if (!filters.length) return;
    const trs = new Set<HTMLTableRowElement>();
    root.querySelectorAll<HTMLElement>("[data-xr]").forEach((el) => {
      const tr = el.closest("tr");
      if (tr) trs.add(tr);
    });
    for (const tr of trs) {
      const ok = filters.every((f) => {
        const cell = tr.querySelector<HTMLElement>(`[data-xc="${CSS.escape(f.col)}"][data-xr]`);
        if (!cell) return true;
        const v = fold(valueText(cell.dataset.xr!, f.col, cell));
        return f.kind === "empty" ? !v : f.kind === "notEmpty" ? !!v : v.includes(fold(f.value)) || v.replace(/[.\s]/g, "").includes(fold(f.value).replace(/[.\s]/g, ""));
      });
      if (!ok) {
        tr.setAttribute("data-xhide", "1");
        tr.style.display = "none";
      }
    }
  });

  // GHI CHÚ Ô: tam giác đỏ góc trên phải ô có ghi chú
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>("[data-xnote]").forEach((o) => o.remove());
    if (!notes?.list.length) return;
    const done = new Set<string>();
    for (const n of notes.list) {
      const k = `${n.row}\u0000${n.col}`;
      if (done.has(k)) continue;
      done.add(k);
      const el = cellAt(n.row, n.col);
      if (!el) continue;
      const t = document.createElement("div");
      t.setAttribute("data-xnote", "1");
      t.style.cssText = "position:absolute;top:0;right:0;width:0;height:0;border-top:7px solid #dc2626;border-left:7px solid transparent;pointer-events:none;z-index:6";
      anchorCell(el);
      el.appendChild(t);
    }
  });

  // ĐỘ RỘNG CỘT: áp độ rộng đã kéo (nhớ trong trình duyệt) + gắn tay kéo ở mép phải ô tiêu đề cột (dòng tiêu đề dưới cùng)
  const wKey = (n: number) => `xlw:${widthKey}:${n}`;
  useEffect(() => {
    const root = rootRef.current;
    const table = root?.querySelector<HTMLTableElement>("table");
    const colEls = table ? Array.from(table.querySelectorAll<HTMLTableColElement>(":scope > colgroup > col")) : [];
    if (!widthKey || !table || !colEls.length) return;
    let saved: Record<string, number> = {};
    try {
      saved = JSON.parse(localStorage.getItem(wKey(colEls.length)) || "{}");
    } catch {}
    const fit = () => {
      const sum = colEls.reduce((s, c) => s + (c.style.visibility === "collapse" ? 0 : parseFloat(c.style.width) || c.getBoundingClientRect().width || 0), 0);
      if (sum > 0) {
        table.style.width = `${sum}px`;
        table.style.minWidth = `${sum}px`;
      }
    };
    let changed = false;
    for (const [i, w] of Object.entries(saved)) {
      const c = colEls[Number(i)];
      if (c && w > 0 && c.style.width !== `${w}px`) {
        if (!c.dataset.xw0) c.dataset.xw0 = c.style.width;
        c.style.width = `${w}px`;
        changed = true;
      }
    }
    if (changed || Object.keys(saved).length) fit();
    // tay kéo: tính vị trí cột của từng ô tiêu đề (rowSpan / colSpan) → ô chiếm đúng 1 cột thì gắn tay kéo cho cột đó (lấy ô ở dòng tiêu đề thấp nhất)
    const thead = table.tHead;
    if (!thead) return;
    thead.querySelectorAll<HTMLElement>("[data-xgrip]").forEach((g) => g.remove());
    const taken: boolean[][] = [];
    const leaf = new Map<number, HTMLTableCellElement>();
    Array.from(thead.rows).forEach((tr, ri) => {
      let ci = 0;
      for (const cell of Array.from(tr.cells)) {
        while (taken[ri]?.[ci]) ci++;
        for (let a = 0; a < cell.rowSpan; a++) for (let b = 0; b < cell.colSpan; b++) (taken[ri + a] ??= [])[ci + b] = true;
        if (cell.colSpan === 1) leaf.set(ci, cell);
        ci += cell.colSpan;
      }
    });
    for (const [ci, th] of leaf) {
      const col = colEls[ci];
      if (!col) continue;
      const g = document.createElement("div");
      g.setAttribute("data-xgrip", "1");
      g.title = "Kéo để giãn / thu độ rộng cột · bấm đúp: về độ rộng mặc định";
      g.style.cssText = "position:absolute;top:0;right:-3px;width:6px;height:100%;cursor:col-resize;z-index:7";
      g.onmousedown = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const x0 = ev.clientX;
        const w0 = parseFloat(col.style.width) || th.getBoundingClientRect().width;
        if (!col.dataset.xw0) col.dataset.xw0 = col.style.width || `${w0}px`;
        const move = (m: MouseEvent) => {
          col.style.width = `${Math.max(24, Math.round(w0 + m.clientX - x0))}px`;
          fit();
        };
        const up = () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
          try {
            const cur = JSON.parse(localStorage.getItem(wKey(colEls.length)) || "{}");
            cur[ci] = parseFloat(col.style.width);
            localStorage.setItem(wKey(colEls.length), JSON.stringify(cur));
          } catch {}
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      };
      g.ondblclick = (ev) => {
        ev.preventDefault();
        try {
          const cur = JSON.parse(localStorage.getItem(wKey(colEls.length)) || "{}");
          delete cur[ci];
          localStorage.setItem(wKey(colEls.length), JSON.stringify(cur));
        } catch {}
        if (col.dataset.xw0) col.style.width = col.dataset.xw0;
        fit();
      };
      anchorCell(th);
      th.appendChild(g);
    }
  });

  // ĐIỀN theo tay nắm: vùng nguồn q → vùng đích t (kéo dọc hoặc ngang). Số thường ≥ 2 ô → dãy tăng đều; còn lại chép lặp lại (công thức dời địa chỉ)
  const doFill = (q: { r1: number; r2: number; c1: number; c2: number }, t: { r1: number; r2: number; c1: number; c2: number }) => {
    if (!xl) return;
    const rows = rowsInDom();
    const vertical = t.c1 === q.c1 && t.c2 === q.c2;
    const writes: [string, string, string][] = [];
    const lines = vertical ? [...Array(q.c2 - q.c1 + 1)].map((_, i) => q.c1 + i) : [...Array(q.r2 - q.r1 + 1)].map((_, i) => q.r1 + i);
    const [s1, s2, d1, d2] = vertical ? [q.r1, q.r2, t.r1, t.r2] : [q.c1, q.c2, t.c1, t.c2];
    const n = s2 - s1 + 1;
    for (const ln of lines) {
      const at = (k: number) => (vertical ? { row: rows[k], col: sc[ln] } : { row: rows[ln], col: sc[k] });
      const src = [...Array(n)].map((_, i) => {
        const p = at(s1 + i);
        return p.row && p.col ? xl.raw(p.row, p.col) : "";
      });
      const nums = src.map(numOfRaw);
      const series = n >= 2 && nums.every((v) => v !== null);
      const step = series ? ((nums[n - 1] as number) - (nums[0] as number)) / (n - 1) : 0;
      for (let k = d1; k <= d2; k++) {
        if (k >= s1 && k <= s2) continue;
        const p = at(k);
        if (!p.row || !p.col || !cellAt(p.row, p.col)?.querySelector(FOCUSABLE)) continue;
        if (series) {
          writes.push([p.row, p.col, rawOfNum((nums[0] as number) + step * (k - s1))]);
          continue;
        }
        const i = (((k - s1) % n) + n) % n;
        const sp = at(s1 + i);
        writes.push([p.row, p.col, shifted(src[i], sp.row, sp.col, p.row, p.col)]);
      }
    }
    writes.forEach(([r, c, x]) => xl.set(r, c, x));
    setSel({ a: { r: Math.min(q.r1, t.r1), c: Math.min(q.c1, t.c1) }, b: { r: Math.max(q.r2, t.r2), c: Math.max(q.c2, t.c2) } });
  };

  // ô đang chọn → sang ô (r, c) theo thứ tự đang hiện (ô nhập: vào ô; ô chỉ đọc: chọn ô)
  const gotoPos = (p: Pos) => {
    const rows = rowsInDom();
    const el = rows[p.r] && sc[p.c] ? cellAt(rows[p.r], sc[p.c]) : null;
    if (!el) return false;
    setSel({ a: p, b: p });
    if (el.querySelector(FOCUSABLE)) focusCell(el);
    else {
      el.tabIndex = -1;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    return true;
  };
  // Ctrl+mũi tên: nhảy tới ô cuối vùng có dữ liệu / ô có dữ liệu kế tiếp (như Excel)
  const jumpPos = (p: Pos, d: [number, number]): Pos => {
    const rows = rowsInDom();
    const inside = (x: Pos) => x.r >= 0 && x.r < rows.length && x.c >= 0 && x.c < sc.length;
    const filled = (x: Pos) => {
      const el = cellAt(rows[x.r], sc[x.c]);
      return !!el && valueText(rows[x.r], sc[x.c], el).trim() !== "";
    };
    let cur = p;
    let nx = { r: p.r + d[0], c: p.c + d[1] };
    if (!inside(nx)) return p;
    if (filled(cur) && filled(nx)) {
      while (inside(nx) && filled(nx)) {
        cur = nx;
        nx = { r: nx.r + d[0], c: nx.c + d[1] };
      }
      return cur;
    }
    while (inside(nx)) {
      cur = nx;
      if (filled(nx)) return nx;
      nx = { r: nx.r + d[0], c: nx.c + d[1] };
    }
    return cur;
  };

  // TÔ VIỀN các ô / vùng mà công thức đang chọn hoặc đang gõ tham chiếu tới (VD =SUBTOTAL(9;I6:I59) → khoanh cả vùng I6:I59), mỗi địa chỉ 1 màu
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !xl) return;
    // khung tô viền là 1 lớp phủ (không bắt chuột) đặt TRÊN ô: ô nhập có nền riêng che mất viền nếu vẽ bằng box-shadow của <td>
    root.querySelectorAll<HTMLElement>("[data-xrefo]").forEach((o) => o.remove());
    root.querySelectorAll<HTMLElement>("[data-xrefc]").forEach((el) => {
      el.removeAttribute("data-xrefc");
      el.style.removeProperty("position");
    });
    if (hideRef || !active || !bar.trim().startsWith("=")) return;
    const refs = formulaRefs(bar).map((x, i) => ({ ...x, color: REF_COLORS[i % REF_COLORS.length] }));
    if (!refs.length) return;
    root.querySelectorAll<HTMLElement>("[data-xr][data-xc]").forEach((el) => {
      const m = /^([A-Z]+)(\d+)$/.exec(xl.addr(el.dataset.xr!, el.dataset.xc!));
      if (!m) return;
      const c = colNum(m[1]);
      const r = Number(m[2]);
      for (const x of refs) {
        if (r < x.r1 || r > x.r2 || c < x.c1 || c > x.c2) continue;
        const sh: string[] = [];
        if (r === x.r1) sh.push(`inset 0 3px 0 0 ${x.color}`);
        if (r === x.r2) sh.push(`inset 0 -3px 0 0 ${x.color}`);
        if (c === x.c1) sh.push(`inset 3px 0 0 0 ${x.color}`);
        if (c === x.c2) sh.push(`inset -3px 0 0 0 ${x.color}`);
        const o = document.createElement("div");
        o.setAttribute("data-xrefo", "1");
        o.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:5;box-shadow:${sh.join(",")};background:${x.color}26`;
        el.setAttribute("data-xrefc", "1");
        if (getComputedStyle(el).position === "static") el.style.position = "relative"; // ô dính (sticky) giữ nguyên
        el.appendChild(o);
        break;
      }
    });
  });

  activeRef.current = active;
  // thanh công thức: theo ô đang chọn
  useEffect(() => {
    if (!xl || barEditing.current) return;
    setBar(active ? xl.raw(active.row, active.col) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.row, active?.col]);

  const focusCell = (cell: HTMLElement | undefined | null) => {
    const input = cell?.querySelector<HTMLInputElement>(FOCUSABLE);
    if (!input) return false;
    setTimeout(() => {
      input.focus();
      if (input instanceof HTMLInputElement && input.type !== "date") input.select?.();
      input.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, 0);
    return true;
  };

  // ghi lại nội dung ô đang gõ (ô thường: báo cho React qua sự kiện input; thanh công thức: setBar)
  const writeValue = (el: HTMLInputElement, next: string, caret: number) => {
    if (el === barRef.current) setBar(next);
    else {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      inserting.current = true;
      setter.call(el, next);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      inserting.current = false;
    }
    el.setSelectionRange(caret, caret);
    requestAnimationFrame(() => el.setSelectionRange(caret, caret)); // lần nữa sau khi React vẽ lại ô
  };
  // chèn địa chỉ ô vào ô đang gõ công thức (giữ nguyên tiêu điểm); trả về vị trí bắt đầu chèn
  const insertRef = (el: HTMLInputElement, ref: string) => {
    const s = el.selectionStart ?? el.value.length;
    const e = el.selectionEnd ?? el.value.length;
    writeValue(el, el.value.slice(0, s) + ref + el.value.slice(e), s + ref.length);
    return s;
  };
  // địa chỉ ô / vùng (K5 hoặc K5:K9) của 2 góc, theo thứ tự dòng đang hiện × cột refCols
  const rangeText = (a: Pos, b: Pos) => {
    if (!xl) return "";
    const rows = rowsInDom();
    const rc = refCols ?? cols;
    const one = (p: Pos) => xl.addr(rows[p.r], rc[p.c]);
    if (a.r === b.r && a.c === b.c) return one(a);
    return `${one({ r: Math.min(a.r, b.r), c: Math.min(a.c, b.c) })}:${one({ r: Math.max(a.r, b.r), c: Math.max(a.c, b.c) })}`;
  };
  const refPosOf = (cell: HTMLElement): Pos | null => {
    const r = rowsInDom().indexOf(cell.dataset.xr!);
    const c = (refCols ?? cols).indexOf(cell.dataset.xc!);
    return r < 0 || c < 0 ? null : { r, c };
  };
  // thay phần địa chỉ đang chọn (start..end) trong ô bằng địa chỉ / vùng mới
  const setPointed = (st: PointState, anchor: Pos, cur: Pos) => {
    const text = rangeText(anchor, cur);
    if (!text) return;
    const v = st.el.value;
    writeValue(st.el, v.slice(0, st.start) + text + v.slice(st.end), st.start + text.length);
    pointRef.current = { ...st, anchor, cur, end: st.start + text.length };
  };
  // phím mũi tên khi đang gõ công thức: chọn ô tham chiếu như Excel. Trả về true nếu đã xử lý.
  const pointKey = (e: React.KeyboardEvent, input: HTMLInputElement): boolean => {
    const d = ({ ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] } as Record<string, [number, number]>)[e.key];
    const here = cellOf(input);
    if (!xl || !d || !here) return false;
    const rows = rowsInDom();
    const rc = refCols ?? cols;
    let st = pointRef.current;
    if (!(st && st.el === input && input.selectionStart === st.end && input.selectionEnd === st.end)) {
      // chưa chọn ô nào: chỉ vào chế độ chọn khi con trỏ đứng sau toán tử / dấu mở ngoặc / dấu phẩy (chỗ cần 1 địa chỉ)
      if (input.selectionStart !== input.selectionEnd) return false;
      const caret = input.selectionStart ?? input.value.length;
      if (!/[=(,;+\-*/^&<>:]\s*$/.test(input.value.slice(0, caret))) return false;
      const p = refPosOf(here);
      if (!p) return false;
      st = { el: input, start: caret, end: caret, anchor: p, cur: p, drag: false };
    }
    const cur = { r: Math.max(0, Math.min(rows.length - 1, st.cur.r + d[0])), c: Math.max(0, Math.min(rc.length - 1, st.cur.c + d[1])) };
    e.preventDefault();
    e.stopPropagation();
    setPointed(st, e.shiftKey ? st.anchor : cur, cur);
    return true;
  };

  // số dòng / số cột của địa chỉ kiểu Excel (K5 → dòng 5, cột theo thứ tự refCols) — để dời công thức khi chép / dán / điền
  const rowNo = (row: string) => {
    const a = xl ? xl.addr(row, (refCols ?? cols)[0]) : "";
    const m = /(\d+)$/.exec(a);
    return m ? Number(m[1]) : NaN;
  };
  const colNo = (col: string) => (refCols ?? cols).indexOf(col);
  // nội dung ô nguồn (công thức dạng "=...") dời theo vị trí đích như Excel: tham chiếu tương đối dời, $K$5 giữ nguyên
  const shifted = (src: string, srcRow: string, srcCol: string, tRow: string, tCol: string) => {
    if (!src.startsWith("=")) return src;
    const dr = rowNo(tRow) - rowNo(srcRow);
    const dc = colNo(tCol) - colNo(srcCol);
    return Number.isFinite(dr) && Number.isFinite(dc) ? shiftDisplay(src, dr, dc) : src;
  };

  const copyRect = async () => {
    const q = rect();
    if (!q) return;
    const rows = rowsInDom();
    const lines: string[] = [];
    const cells: string[][] = [];
    const srcRows: string[] = [];
    const srcCols: string[] = [];
    for (let c = q.c1; c <= q.c2; c++) srcCols.push(sc[c]);
    for (let r = q.r1; r <= q.r2; r++) {
      const vals: string[] = [];
      const raws: string[] = [];
      srcRows.push(rows[r]);
      for (let c = q.c1; c <= q.c2; c++) {
        const el = rows[r] && sc[c] ? cellAt(rows[r], sc[c]) : null;
        const inp = el?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input:not([type=checkbox]), textarea, select");
        // clipboard hệ thống: GIÁ TRỊ (dán sang Excel ra số); bản trong phần mềm: CÔNG THỨC
        const v = xl?.text && rows[r] && sc[c] ? xl.text(rows[r], sc[c]) : inp ? (inp instanceof HTMLSelectElement ? (inp.selectedOptions[0]?.text ?? "") : inp.value) : (el?.textContent ?? "");
        vals.push(v.replace(/[\t\n]/g, " ").trim());
        raws.push(xl && rows[r] && sc[c] ? xl.raw(rows[r], sc[c]) : v);
      }
      lines.push(vals.join("\t"));
      cells.push(raws);
    }
    const text = lines.join("\n");
    xlClip = { text, srcRows, srcCols, cells };
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  };

  const bodyEvents = xl
    ? {
        onMouseDownCapture: (e: React.MouseEvent) => {
          // bấm vào TAY NẮM KÉO ĐIỀN: bắt đầu kéo điền (thả chuột ở đâu cũng được)
          if (e.button === 0 && e.target instanceof HTMLElement && e.target.hasAttribute("data-xfh")) {
            const q = rect();
            if (!q) return;
            e.preventDefault();
            e.stopPropagation();
            (document.activeElement as HTMLElement | null)?.blur?.();
            fillRef.current = { q, t: null };
            const up = () => {
              window.removeEventListener("mouseup", up);
              const f = fillRef.current;
              fillRef.current = null;
              if (f?.t) setTimeout(() => doFill(f.q, f.t!), 0);
              else setSelState((x) => (x ? { ...x } : x));
            };
            window.addEventListener("mouseup", up);
            return;
          }
          const cell = cellOf(e.target);
          if (!cell || e.button !== 0) return;
          // đang gõ công thức → bấm ô khác = chèn địa chỉ ô đó
          const ed = document.activeElement;
          const editing = ed instanceof HTMLInputElement && ed === typedEl.current && ed.value.trim().startsWith("=") && (ed === barRef.current || (rootRef.current?.contains(ed) && cellOf(ed) !== cell));
          if (editing) {
            e.preventDefault();
            e.stopPropagation();
            // bấm = chèn địa chỉ ô; giữ chuột kéo sang ô khác = chọn vùng (K5:K9)
            const el = ed as HTMLInputElement;
            const start = insertRef(el, xl.addr(cell.dataset.xr!, cell.dataset.xc!));
            const p = refPosOf(cell);
            pointRef.current = p ? { el, start, end: start + xl.addr(cell.dataset.xr!, cell.dataset.xc!).length, anchor: p, cur: p, drag: true } : null;
            return;
          }
          // Ô CHỈ ĐỌC (thành tiền, tổng đầu mục... không có ô nhập): bấm = chọn ô → thanh công thức hiện công thức, tô viền các ô nằm trong công thức;
          // F2 hiện lại (sau Esc), ↑ ↓ ← → di chuyển sang ô bên cạnh, Esc tắt khung tô viền
          // Ô chỉ đọc cũng chọn vùng được (kéo chuột / Shift+bấm) — để xem tổng ở thanh trạng thái, chép sang Excel
          if (!cell.querySelector(`${FOCUSABLE}, input, button, a`)) {
            const p0 = posOf(cell);
            if (p0 && e.shiftKey && selRef.current) {
              e.preventDefault();
              setSel({ a: selRef.current.a, b: p0 });
              return;
            }
            setSel(p0 ? { a: p0, b: p0 } : null);
            if (p0) dragging.current = true;
            cell.tabIndex = -1;
            setTimeout(() => cell.focus({ preventScroll: true }), 0);
            return;
          }
          const p = posOf(cell);
          if (!p) return;
          if (e.shiftKey && selRef.current) {
            e.preventDefault();
            setSel({ a: selRef.current.a, b: p });
          } else {
            setSel({ a: p, b: p });
            dragging.current = true;
          }
        },
        onMouseOver: (e: React.MouseEvent) => {
          const f = fillRef.current;
          if (f) {
            const cell = cellOf(e.target);
            const p = cell && posOf(cell);
            if (!p) return;
            const q = f.q;
            const dr = p.r > q.r2 ? p.r - q.r2 : p.r < q.r1 ? p.r - q.r1 : 0;
            const dc = p.c > q.c2 ? p.c - q.c2 : p.c < q.c1 ? p.c - q.c1 : 0;
            const t = !dr && !dc ? null : Math.abs(dr) >= Math.abs(dc) ? { r1: Math.min(q.r1, p.r), r2: Math.max(q.r2, p.r), c1: q.c1, c2: q.c2 } : { r1: q.r1, r2: q.r2, c1: Math.min(q.c1, p.c), c2: Math.max(q.c2, p.c) };
            if (JSON.stringify(t) !== JSON.stringify(f.t)) {
              fillRef.current = { q, t };
              setSelState((x) => (x ? { ...x } : x)); // vẽ lại khung nét đứt
            }
            return;
          }
          const pt = pointRef.current;
          if (pt?.drag && e.buttons & 1) {
            const cell = cellOf(e.target);
            const p = cell && refPosOf(cell);
            if (p && (p.r !== pt.cur.r || p.c !== pt.cur.c)) setPointed(pt, pt.anchor, p);
            return;
          }
          if (!dragging.current || !(e.buttons & 1)) return;
          const cell = cellOf(e.target);
          const p = cell && posOf(cell);
          const cur = selRef.current;
          if (p && cur && (p.r !== cur.b.r || p.c !== cur.b.c)) {
            setSel({ a: cur.a, b: p });
            (document.activeElement as HTMLElement | null)?.blur?.();
            window.getSelection()?.removeAllRanges();
          }
        },
        onMouseUp: () => {
          dragging.current = false;
          if (pointRef.current) pointRef.current = { ...pointRef.current, drag: false };
        },
        onDoubleClick: (e: React.MouseEvent) => {
          // bấm đúp = chế độ sửa (mũi tên chỉ dời con trỏ trong ô)
          const t = e.target;
          if (t instanceof HTMLInputElement && cellOf(t)) editEl.current = t;
        },
        onFocusCapture: (e: React.FocusEvent) => {
          const cell = cellOf(e.target);
          if (cell) {
            setHideRef(false);
            if (e.target === cell) {
              cell.style.outline = "2px solid #2563eb"; // ô chỉ đọc đang chọn
              cell.style.outlineOffset = "-2px";
            }
            setActive({ row: cell.dataset.xr!, col: cell.dataset.xc! });
            if (!barEditing.current) setBar(xl.raw(cell.dataset.xr!, cell.dataset.xc!));
            if (!dragging.current && !multi()) {
              const p = posOf(cell);
              if (p) setSel({ a: p, b: p });
            }
          }
        },
        onInputCapture: (e: React.FormEvent) => {
          if ((e.nativeEvent as InputEvent).isComposing) return; // đang ghép dấu tiếng Việt: chưa cập nhật thanh công thức
          // thanh công thức hiện theo nội dung đang gõ trong ô
          const t = e.target as HTMLInputElement;
          if (!inserting.current) pointRef.current = null; // người dùng gõ → thôi chọn ô tham chiếu
          typedEl.current = t;
          setHideRef(false);
          if (cellOf(t) && "value" in t) setBar(t.value);
        },
        onBlurCapture: (e: React.FocusEvent) => {
          if (e.target === pointRef.current?.el) pointRef.current = null;
          if (e.target === typedEl.current) typedEl.current = null;
          if (e.target === editEl.current) editEl.current = null;
          // rời ô: thanh công thức hiện lại nội dung đã lưu (công thức / giá trị)
          const cell = cellOf(e.target);
          if (cell && e.target === cell) {
            cell.style.removeProperty("outline");
            cell.style.removeProperty("outline-offset");
          }
          // chỉ làm mới thanh công thức nếu ô vừa rời vẫn là ô đang chọn (đã chuyển sang ô khác thì giữ công thức của ô mới)
          if (cell) setTimeout(() => { const a = activeRef.current; if (!barEditing.current && a && a.row === cell.dataset.xr && a.col === cell.dataset.xc) setBar(xl.raw(cell.dataset.xr!, cell.dataset.xc!)); }, 0);
        },
      }
    : {};

  // CHUỘT PHẢI vào ô: bấm trong vùng đang chọn thì giữ vùng; bấm ngoài vùng thì chọn ô đó (như Excel)
  const onContextMenu = (e: React.MouseEvent) => {
    if (!rowOps && !xl && !notes) return;
    const cell = cellOf(e.target);
    if (!cell) return;
    const p = posOf(cell);
    if (!p) return;
    e.preventDefault();
    const q = rect();
    const inside = !!q && p.r >= q.r1 && p.r <= q.r2 && p.c >= q.c1 && p.c <= q.c2;
    if (!inside) setSel({ a: p, b: p });
    const rows = inside && q ? rowsInDom().slice(q.r1, q.r2 + 1) : [cell.dataset.xr!];
    (document.activeElement as HTMLElement | null)?.blur?.(); // lưu ô đang gõ trước
    setMenu({ x: e.clientX, y: e.clientY, rows, row: cell.dataset.xr!, col: cell.dataset.xc! });
  };
  const menuAct = (fn: () => void) => () => {
    setMenu(null);
    setTimeout(fn, 0);
  };
  const mItem = "flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-100";
  // chữ cột kiểu Excel (K) của 1 khoá cột
  const colLetterOf = (col: string) => {
    const anyRow = rootRef.current?.querySelector<HTMLElement>("[data-xr]")?.dataset.xr ?? "";
    return (xl?.addr(anyRow, col) ?? "").replace(/\$?\d+$/, "") || col;
  };
  const applyDraft = () => {
    if (!fDraft || (fDraft.kind === "contains" && !fDraft.value.trim())) return;
    setFilters((fs) => [...fs.filter((f) => f.col !== fDraft.col), { ...fDraft, value: fDraft.value.trim() }]);
    setFilterOpen(false);
    setSel(null);
  };
  // THANH TRẠNG THÁI (như Excel): chọn ≥ 2 ô → Tổng / Trung bình / Đếm / Nhỏ nhất / Lớn nhất của các ô số
  const stats = (() => {
    if (!xl || !multi() || menu) return null;
    const vals = cellsInRect().filter((x) => x.el).map((x) => valueText(x.row, x.col, x.el).trim());
    const nums = vals.map(numOfText).filter((v): v is number => v !== null);
    return { count: vals.filter(Boolean).length, n: nums.length, sum: nums.reduce((a, v) => a + v, 0), min: nums.length ? Math.min(...nums) : 0, max: nums.length ? Math.max(...nums) : 0 };
  })();
  // rê chuột vào ô có ghi chú → hiện ghi chú
  const onNoteHover = (e: React.MouseEvent) => {
    if (!notes?.list.length) return;
    const cell = cellOf(e.target);
    const has = cell && notes.list.some((n) => n.row === cell.dataset.xr && n.col === cell.dataset.xc);
    if (!has) {
      if (noteTip) setNoteTip(null);
      return;
    }
    if (noteTip?.row === cell.dataset.xr && noteTip?.col === cell.dataset.xc) return;
    const r = cell.getBoundingClientRect();
    setNoteTip({ row: cell.dataset.xr!, col: cell.dataset.xc!, x: r.right + 4, y: r.top });
  };
  const mN = menu?.rows.length ?? 0;
  const mTxt = mN > 1 ? `${mN} dòng` : "dòng";

  return (
    <div className={className}>
      {menu &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[80]" onMouseDown={() => setMenu(null)} onContextMenu={(e) => (e.preventDefault(), setMenu(null))} />
            <div
              className="fixed z-[85] w-64 rounded-md bg-white py-1 font-sans text-[13px] text-slate-800 shadow-xl ring-1 ring-slate-300"
              style={{ left: Math.max(4, Math.min(menu.x, window.innerWidth - 264)), top: Math.max(4, Math.min(menu.y, window.innerHeight - 220)) }}
              onContextMenu={(e) => e.preventDefault()}
            >
              {xl && (
                <>
                  <button type="button" className={mItem} onClick={menuAct(() => void copyRect())}>
                    <b className="w-4 text-center">⧉</b> Chép <span className="ml-auto text-xs text-slate-400">Ctrl+C</span>
                  </button>
                  <div className="px-3 pb-1 text-xs text-slate-400">Dán: đứng ở ô rồi bấm Ctrl+V</div>
                </>
              )}
              {rowOps && (
                <>
                  {xl && <div className="my-1 border-t border-slate-200" />}
                  <button type="button" className={`${mItem} text-emerald-700`} onClick={menuAct(() => rowOps.insert(menu.rows[0], "above", mN))}>
                    <b className="w-4 text-center">＋</b> Chèn {mTxt} phía trên
                  </button>
                  <button type="button" className={`${mItem} text-emerald-700`} onClick={menuAct(() => rowOps.insert(menu.rows[mN - 1], "below", mN))}>
                    <b className="w-4 text-center">＋</b> Chèn {mTxt} phía dưới
                  </button>
                  <button type="button" className={`${mItem} text-red-600 hover:bg-red-50`} onClick={menuAct(() => rowOps.remove(menu.rows))}>
                    <b className="w-4 text-center">✕</b> Xoá {mTxt}
                  </button>
                </>
              )}
              {xl && (
                <>
                  <div className="my-1 border-t border-slate-200" />
                  <button type="button" className={mItem} onClick={menuAct(() => cellsInRect().filter((x) => x.el?.querySelector(FOCUSABLE)).forEach((x) => xl.set(x.row, x.col, "")))}>
                    <b className="w-4 text-center">⌫</b> Xoá nội dung ô <span className="ml-auto text-xs text-slate-400">Delete</span>
                  </button>
                  <div className="my-1 border-t border-slate-200" />
                  <button
                    type="button"
                    className={mItem}
                    title="Chỉ hiện các dòng có cùng nội dung với ô này ở cột này"
                    onClick={menuAct(() => {
                      const v = valueText(menu.row, menu.col).trim();
                      setFilters((fs) => [...fs.filter((f) => f.col !== menu.col), v ? { col: menu.col, kind: "contains", value: v } : { col: menu.col, kind: "empty", value: "" }]);
                      setSel(null);
                    })}
                  >
                    <b className="w-4 text-center">⏷</b> Lọc theo giá trị ô này
                  </button>
                  <button type="button" className={mItem} onClick={menuAct(() => (setFDraft({ col: menu.col, kind: "contains", value: "" }), setFilterOpen(true)))}>
                    <b className="w-4 text-center">⏷</b> Lọc cột {colLetterOf(menu.col)}…
                  </button>
                  {filters.length > 0 && (
                    <button type="button" className={mItem} onClick={menuAct(() => setFilters([]))}>
                      <b className="w-4 text-center">✕</b> Bỏ lọc ({filters.length})
                    </button>
                  )}
                </>
              )}
                {notes && (
                  <>
                    <div className="my-1 border-t border-slate-200" />
                    <button type="button" className={mItem} onClick={menuAct(() => setNoteEdit({ row: menu.row, col: menu.col, x: menu.x, y: menu.y }))}>
                      <b className="w-4 text-center text-red-600">◥</b> {notes.list.some((n) => n.row === menu.row && n.col === menu.col) ? "Xem / thêm ghi chú" : "Thêm ghi chú"}
                    </button>
                  </>
                )}
            </div>
          </>,
          document.body,
        )}
      {noteEdit && notes && createPortal(<NotePanel api={notes} at={noteEdit} addr={xl?.addr(noteEdit.row, noteEdit.col) ?? ""} onClose={() => setNoteEdit(null)} />, document.body)}
      {noteTip &&
        !noteEdit &&
        createPortal(
          <div className="pointer-events-none fixed z-[90] w-72 rounded-md bg-amber-50 p-2 font-sans text-[12px] text-slate-800 shadow-lg ring-1 ring-amber-300" style={{ left: Math.min(noteTip.x, window.innerWidth - 300), top: Math.min(noteTip.y, window.innerHeight - 160) }}>
            {notes?.list
              .filter((n) => n.row === noteTip.row && n.col === noteTip.col)
              .map((n) => (
                <div key={n.id} className="mb-1 last:mb-0">
                  <b>{n.user}</b> <span className="text-slate-500">{n.at}</span>
                  <div className="whitespace-pre-wrap">{n.text}</div>
                </div>
              ))}
          </div>,
          document.body,
        )}
      {xl && (filterOpen || filters.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 font-sans text-[12px]">
          <b className="text-amber-900">⏷ Lọc:</b>
          {filters.map((f, i) => (
            <span key={i} className="rounded-full bg-white px-2 py-0.5 ring-1 ring-amber-300">
              Cột {colLetterOf(f.col)} {f.kind === "empty" ? "trống" : f.kind === "notEmpty" ? "có dữ liệu" : `chứa "${f.value}"`}
              <button type="button" className="ml-1 text-red-600" title="Bỏ điều kiện này" onClick={() => setFilters((fs) => fs.filter((_, j) => j !== i))}>
                ✕
              </button>
            </span>
          ))}
          {filterOpen && fDraft && (
            <span className="flex flex-wrap items-center gap-1">
              Cột
              <select className="rounded border border-slate-300 px-1" value={fDraft.col} onChange={(e) => setFDraft({ ...fDraft, col: e.target.value })}>
                {sc.map((c) => (
                  <option key={c} value={c}>
                    {colLetterOf(c)}
                  </option>
                ))}
              </select>
              <select className="rounded border border-slate-300 px-1" value={fDraft.kind} onChange={(e) => setFDraft({ ...fDraft, kind: e.target.value as GridFilter["kind"] })}>
                <option value="contains">chứa</option>
                <option value="empty">ô trống</option>
                <option value="notEmpty">có dữ liệu</option>
              </select>
              {fDraft.kind === "contains" && (
                <input
                  autoFocus
                  className="w-40 rounded border border-slate-300 px-1"
                  value={fDraft.value}
                  placeholder="chữ / số cần tìm"
                  onChange={(e) => setFDraft({ ...fDraft, value: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && applyDraft()}
                />
              )}
              <button type="button" className="rounded bg-amber-600 px-2 py-0.5 font-medium text-white hover:bg-amber-700" onClick={applyDraft}>
                Lọc
              </button>
            </span>
          )}
          <span className="flex-1" />
          {!filterOpen && (
            <button type="button" className="text-amber-800 hover:underline" onClick={() => (setFDraft({ col: activeRef.current?.col ?? sc[0], kind: "contains", value: "" }), setFilterOpen(true))}>
              + thêm điều kiện
            </button>
          )}
          <button type="button" className="text-red-700 hover:underline" onClick={() => (setFilters([]), setFilterOpen(false))}>
            Bỏ lọc
          </button>
        </div>
      )}
      {xl && (
        <div className="mt-2 flex items-center gap-1 rounded border border-slate-300 bg-white font-sans text-[12px]">
          <span className="w-16 shrink-0 border-r border-slate-300 px-2 py-1 text-center font-mono font-semibold text-slate-700" title="Ô đang chọn">
            {active ? xl.addr(active.row, active.col) || "—" : "—"}
          </span>
          <span className="px-1 font-serif italic text-slate-500" title="Thanh công thức">
            fx
          </span>
          <input
            ref={barRef}
            className="min-w-0 flex-1 px-1 py-1 outline-none focus:bg-sky-50"
            value={bar}
            disabled={!active}
            placeholder={active ? "" : "Chọn 1 ô để xem / sửa nội dung, công thức (VD =K5*1,05 — đang gõ công thức thì bấm vào ô khác để chèn địa chỉ)"}
            title="Thanh công thức: sửa nội dung / công thức ô đang chọn rồi Enter. Ctrl+Z hoàn tác, Ctrl+Y làm lại."
            onFocus={() => (barEditing.current = true)}
            onBlur={() => {
              barEditing.current = false;
              if (typedEl.current === barRef.current) typedEl.current = null;
              if (active) setBar(xl.raw(active.row, active.col));
            }}
            onChange={(e) => {
              typedEl.current = barRef.current;
              setBar(e.target.value);
            }}
            onKeyDown={(e) => {
              if (!active) return;
              if (e.key === "F4" && bar.trim().startsWith("=")) {
                e.preventDefault();
                const el = e.currentTarget;
                const r = cycleAbsAt(el.value, el.selectionEnd ?? el.value.length);
                if (r) {
                  typedEl.current = el;
                  writeValue(el, r.text, r.caret);
                }
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                xl.set(active.row, active.col, bar);
                barEditing.current = false;
                focusCell(cellAt(active.row, active.col));
              } else if (e.key === "Escape") {
                typedEl.current = null;
                setHideRef(true);
                setBar(xl.raw(active.row, active.col));
                focusCell(cellAt(active.row, active.col));
              }
            }}
          />
        </div>
      )}
      <div
        ref={rootRef}
        {...bodyEvents}
        onContextMenu={onContextMenu}
        onMouseMove={onNoteHover}
        onMouseLeave={() => noteTip && setNoteTip(null)}
        onKeyDownCapture={(e) => {
          if (e.nativeEvent.isComposing) return;
          // ---- phím tắt kiểu Excel (chỉ khi có xl) ----
          // F4 khi đang gõ công thức: đổi K5 → $K$5 → K$5 → $K5 tại con trỏ
          if (xl && e.key === "F4" && e.target instanceof HTMLInputElement && e.target.value.trim().startsWith("=")) {
            const el = e.target;
            const r = cycleAbsAt(el.value, el.selectionEnd ?? el.value.length);
            e.preventDefault();
            if (r) {
              typedEl.current = el;
              writeValue(el, r.text, r.caret);
            }
            return;
          }
          // đang sửa chữ trong ô (F2 / bấm đúp / đang gõ) thì phím giữ nghĩa sửa chữ; còn lại phím chọn ô như Excel
          const tgt = e.target as HTMLElement;
          const textMode = tgt === editEl.current || tgt === typedEl.current;
          const dirOf = (key: string): [number, number] | null => (key === "ArrowDown" ? [1, 0] : key === "ArrowUp" ? [-1, 0] : key === "ArrowRight" ? [0, 1] : key === "ArrowLeft" ? [0, -1] : null);
          if (xl && !textMode && !e.altKey && cellOf(tgt)) {
            const hereP = posOf(cellOf(tgt)!);
            const d = dirOf(e.key);
            const ctrl = e.ctrlKey || e.metaKey;
            const lastP = () => ({ r: rowsInDom().length - 1, c: sc.length - 1 });
            // Ctrl+A: chọn cả bảng
            if (ctrl && e.key.toLowerCase() === "a" && !e.shiftKey) {
              e.preventDefault();
              e.stopPropagation();
              setSel({ a: { r: 0, c: 0 }, b: lastP() });
              return;
            }
            if (hereP && (d || ((e.key === "Home" || e.key === "End") && ctrl))) {
              const from = e.shiftKey && selRef.current ? selRef.current.b : hereP;
              const to = d ? (ctrl ? jumpPos(from, d) : { r: Math.max(0, Math.min(rowsInDom().length - 1, from.r + d[0])), c: Math.max(0, Math.min(sc.length - 1, from.c + d[1])) }) : e.key === "Home" ? { r: 0, c: 0 } : lastP();
              if (e.shiftKey) {
                // Shift (+Ctrl) + mũi tên / Home / End: mở rộng vùng chọn, ô đang đứng giữ nguyên
                e.preventDefault();
                e.stopPropagation();
                setSel({ a: selRef.current?.a ?? hereP, b: to });
                const rows = rowsInDom();
                cellAt(rows[to.r], sc[to.c])?.scrollIntoView({ block: "nearest", inline: "nearest" });
                return;
              }
              if (ctrl) {
                e.preventDefault();
                e.stopPropagation();
                (document.activeElement as HTMLElement | null)?.blur?.();
                gotoPos(to);
                return;
              }
              if (multi()) setSel(null); // mũi tên thường: bỏ vùng chọn, đi tiếp như cũ
            }
          }
          if (xl && (e.ctrlKey || e.metaKey) && !e.altKey) {
            const k = e.key.toLowerCase();
            if (k === "z" || k === "y") {
              const fn = k === "y" || (k === "z" && e.shiftKey) ? xl.onRedo : xl.onUndo;
              if (!fn) return;
              e.preventDefault();
              e.stopPropagation();
              (document.activeElement as HTMLElement | null)?.blur?.(); // lưu ô đang gõ trước
              setTimeout(fn, 0);
              return;
            }
            if (k === "c") {
              // Ctrl+C: chép ô / vùng đang chọn (kèm công thức). Đang bôi đen 1 phần chữ trong ô hoặc đang ở chế độ sửa (F2) thì chép chữ như thường.
              const t = e.target;
              const partial = t instanceof HTMLInputElement && t.selectionStart !== t.selectionEnd && !(t.selectionStart === 0 && t.selectionEnd === t.value.length);
              if (multi() || (rect() && cellOf(t) && !partial && editEl.current !== t)) {
                e.preventDefault();
                void copyRect();
                return;
              }
            }
            if (k === "d" || k === "r") {
              // Ctrl+D điền xuống / Ctrl+R điền sang phải: nhiều ô → chép ô đầu vùng; 1 ô → chép từ ô phía trên (Ctrl+D) / bên trái (Ctrl+R). Công thức dời tham chiếu như Excel.
              const q = rect();
              if (!q) return;
              const down = k === "d";
              const rows = rowsInDom();
              const span = down ? q.r2 > q.r1 : q.c2 > q.c1;
              const srcIdx = span ? (down ? q.r1 : q.c1) : (down ? q.r1 : q.c1) - 1;
              if (srcIdx < 0) return;
              e.preventDefault();
              (document.activeElement as HTMLElement | null)?.blur?.();
              setTimeout(() => {
                const writes: [string, string, string][] = [];
                if (down) {
                  for (let c = q.c1; c <= q.c2; c++) {
                    const col = sc[c];
                    const src = xl.raw(rows[srcIdx], col);
                    for (let r = span ? q.r1 + 1 : q.r1; r <= q.r2; r++) if (cellAt(rows[r], col)?.querySelector(FOCUSABLE)) writes.push([rows[r], col, shifted(src, rows[srcIdx], col, rows[r], col)]);
                  }
                } else {
                  for (let r = q.r1; r <= q.r2; r++) {
                    const src = xl.raw(rows[r], sc[srcIdx]);
                    for (let c = span ? q.c1 + 1 : q.c1; c <= q.c2; c++) if (cellAt(rows[r], sc[c])?.querySelector(FOCUSABLE)) writes.push([rows[r], sc[c], shifted(src, rows[r], sc[srcIdx], rows[r], sc[c])]);
                  }
                }
                writes.forEach(([r, c, t]) => xl.set(r, c, t));
              }, 0);
              return;
            }
          }
          if (xl && (e.key === "Delete" || e.key === "Backspace") && multi()) {
            e.preventDefault();
            e.stopPropagation();
            (document.activeElement as HTMLElement | null)?.blur?.();
            const cells = cellsInRect().filter((x) => x.el?.querySelector(FOCUSABLE));
            setTimeout(() => cells.forEach((x) => xl.set(x.row, x.col, "")), 0);
            return;
          }
          if (e.key === "Escape") {
            typedEl.current = null;
            setHideRef(true);
          } // Esc: thôi gõ công thức — bấm ô khác không chèn địa chỉ nữa
          if (xl && e.key === "Escape" && multi()) {
            setSel(null);
            return;
          }
          const here = cellOf(e.target);
          if (!here || e.altKey || e.ctrlKey || e.metaKey) return;
          const root = e.currentTarget;
          const target = e.target as HTMLInputElement;
          // ô chỉ đọc đang chọn (focus nằm ở chính ô): F2 = hiện công thức + tô viền các ô tham chiếu; mũi tên = sang ô bên cạnh
          if (xl && e.target === here) {
            if (e.key === "F2") {
              e.preventDefault();
              setHideRef(false);
              setBar(xl.raw(here.dataset.xr!, here.dataset.xc!));
              return;
            }
            const d = e.key === "ArrowDown" ? [1, 0] : e.key === "ArrowUp" ? [-1, 0] : e.key === "ArrowRight" ? [0, 1] : e.key === "ArrowLeft" ? [0, -1] : null;
            if (d) {
              e.preventDefault();
              const rows = rowsInDom();
              const rc = refCols ?? cols;
              let r = rows.indexOf(here.dataset.xr!) + d[0];
              let c = rc.indexOf(here.dataset.xc!) + d[1];
              while (r >= 0 && r < rows.length && c >= 0 && c < rc.length) {
                const nx = cellAt(rows[r], rc[c]);
                if (nx) {
                  if (nx.querySelector(FOCUSABLE)) focusCell(nx);
                  else {
                    nx.tabIndex = -1;
                    nx.focus({ preventScroll: true });
                    nx.scrollIntoView({ block: "nearest", inline: "nearest" });
                  }
                  return;
                }
                r += d[0];
                c += d[1];
              }
            }
            return;
          }
          // F2 = chế độ sửa; ở chế độ sửa mũi tên chỉ dời con trỏ trong ô (không rời ô, không chọn ô tham chiếu)
          if (e.key === "F2" && target instanceof HTMLInputElement) {
            editEl.current = target;
            return;
          }
          const arrow = e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight";
          if (arrow && editEl.current === e.target) return;
          // đang gõ công thức: mũi tên chọn ô tham chiếu
          if (xl && arrow && target instanceof HTMLInputElement && target.value.trim().startsWith("=") && pointKey(e, target)) return;
          const isSelect = target.tagName === "SELECT";
          const isDate = target instanceof HTMLInputElement && target.type === "date";
          const col = here.dataset.xc!;
          // chỉ tính các ô NHẬP được (ô chỉ đọc cũng có data-xr/xc để chọn làm ô tham chiếu công thức, nhưng không nhảy tới)
          const inCol = () => Array.from(root.querySelectorAll<HTMLElement>(`[data-xc="${CSS.escape(col)}"]`)).filter((x) => x === here || x.querySelector(FOCUSABLE));
          const inRow = () => Array.from(root.querySelectorAll<HTMLElement>(`[data-xr="${CSS.escape(here.dataset.xr!)}"]`)).filter((x) => x === here || x.querySelector(FOCUSABLE));
          let next: HTMLElement | undefined;
          if (e.key === "Enter" && target.tagName !== "TEXTAREA") {
            const c = inCol();
            next = c[c.indexOf(here) + (e.shiftKey ? -1 : 1)];
            // ô cuối cột: Enter vẫn lưu (blur) như cũ
            if (!next) {
              target.blur();
              return;
            }
          } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !isSelect && !isDate) {
            const c = inCol();
            next = c[c.indexOf(here) + (e.key === "ArrowDown" ? 1 : -1)];
          } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !isSelect && !isDate && !e.shiftKey) {
            const len = target.value?.length ?? 0;
            const atStart = target.selectionStart === 0 && target.selectionEnd === 0;
            const atEnd = target.selectionStart === len && target.selectionEnd === len;
            const allSel = target.selectionStart === 0 && target.selectionEnd === len && len > 0;
            if (e.key === "ArrowLeft" ? atStart || allSel : atEnd || allSel) {
              const r = inRow();
              next = r[r.indexOf(here) + (e.key === "ArrowRight" ? 1 : -1)];
            }
          } else return;
          if (!next) return;
          e.preventDefault();
          e.stopPropagation();
          target.blur(); // lưu ô đang sửa (NumInput lưu khi rời ô)
          focusCell(next);
        }}
        onPasteCapture={(e) => {
          const here = cellOf(e.target);
          // dán vùng vừa Ctrl+C trong bảng: dán CÔNG THỨC, dời tham chiếu tương đối như Excel; chép 1 ô mà đang chọn vùng nhiều ô → điền cả vùng
          if (xl && here && xlClip && e.clipboardData.getData("text").replace(/\r/g, "").replace(/\n+$/, "") === xlClip.text.replace(/\n+$/, "")) {
            const clip = xlClip;
            const rows = rowsInDom();
            const r0 = rows.indexOf(here.dataset.xr!);
            const c0 = sc.indexOf(here.dataset.xc!);
            if (r0 >= 0 && c0 >= 0) {
              e.preventDefault();
              e.stopPropagation();
              const writes: [string, string, string][] = [];
              if (clip.cells.length === 1 && clip.cells[0].length === 1 && multi()) {
                for (const x of cellsInRect()) if (x.el?.querySelector(FOCUSABLE)) writes.push([x.row, x.col, shifted(clip.cells[0][0], clip.srcRows[0], clip.srcCols[0], x.row, x.col)]);
              } else {
                clip.cells.forEach((line, i) =>
                  line.forEach((raw, j) => {
                    const row = rows[r0 + i];
                    const col = sc[c0 + j];
                    if (!row || !col || !cellAt(row, col)?.querySelector(FOCUSABLE)) return;
                    writes.push([row, col, shifted(raw, clip.srcRows[i], clip.srcCols[j], row, col)]);
                  }),
                );
              }
              (document.activeElement as HTMLElement | null)?.blur();
              setTimeout(() => writes.forEach(([r, c, t]) => xl.set(r, c, t)), 0);
              return;
            }
          }
          if (!here || !onPaste) return;
          const text = e.clipboardData.getData("text").replace(/\r/g, "");
          const lines = text.split("\n");
          while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
          const matrix = lines.map((l) => l.split("\t"));
          if (matrix.length === 1 && matrix[0].length === 1) return; // 1 giá trị: để ô tự xử lý
          e.preventDefault();
          e.stopPropagation();
          const root = e.currentTarget;
          // các dòng đang hiện theo thứ tự trên màn hình
          const rows: string[] = [];
          root.querySelectorAll<HTMLElement>("[data-xr]").forEach((el) => {
            if (!rows.includes(el.dataset.xr!)) rows.push(el.dataset.xr!);
          });
          const r0 = rows.indexOf(here.dataset.xr!);
          const c0 = cols.indexOf(here.dataset.xc!);
          if (r0 < 0 || c0 < 0) return;
          const out: GridPaste[] = [];
          matrix.forEach((line, i) =>
            line.forEach((t, j) => {
              const row = rows[r0 + i];
              const col = cols[c0 + j];
              if (!row || !col) return;
              // chỉ ghi vào ô thực sự có ô nhập (dòng vật tư DT-CP không sửa được tên / ĐVT...)
              const cell = root.querySelector(`[data-xr="${CSS.escape(row)}"][data-xc="${CSS.escape(col)}"]`);
              if (!cell?.querySelector(FOCUSABLE)) return;
              out.push({ row, col, text: t.trim(), num: parsePastedNumber(t) });
            }),
          );
          (document.activeElement as HTMLElement | null)?.blur();
          onPaste(out);
        }}
      >
        {children}
      </div>
      {stats &&
        createPortal(
          <div className="fixed bottom-16 right-4 z-[60] flex flex-wrap items-center gap-x-4 gap-y-0.5 rounded-md bg-slate-800/95 px-3 py-1.5 font-sans text-[12px] text-white shadow-lg">
            {stats.n > 0 && (
              <>
                <span>
                  Tổng: <b>{fmtStat(stats.sum)}</b>
                </span>
                <span>
                  Trung bình: <b>{fmtStat(stats.sum / stats.n)}</b>
                </span>
                <span>
                  Nhỏ nhất: <b>{fmtStat(stats.min)}</b>
                </span>
                <span>
                  Lớn nhất: <b>{fmtStat(stats.max)}</b>
                </span>
              </>
            )}
            <span>
              Đếm: <b>{stats.count}</b>
            </span>
          </div>,
          document.body,
        )}
    </div>
  );
}

// Ô GHI CHÚ: danh sách ghi chú của ô (ai ghi, lúc nào) + ô gõ ghi chú mới; xoá được ghi chú của mình
function NotePanel({ api, at, addr, onClose }: { api: GridNotesApi; at: { row: string; col: string; x: number; y: number }; addr: string; onClose: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const list = api.list.filter((n) => n.row === at.row && n.col === at.col);
  const isNew = at.row.startsWith("new:");
  const save = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const err = await api.add(at.row, at.col, text.trim());
    setBusy(false);
    if (err) return window.alert(err);
    setText("");
  };
  return (
    <>
      <div className="fixed inset-0 z-[88]" onMouseDown={onClose} />
      <div className="fixed z-[89] w-80 rounded-md bg-white p-3 font-sans text-[12px] text-slate-800 shadow-xl ring-1 ring-slate-300" style={{ left: Math.max(4, Math.min(at.x, window.innerWidth - 330)), top: Math.max(4, Math.min(at.y, window.innerHeight - 320)) }}>
        <div className="mb-2 flex items-center">
          <b className="text-red-700">◥ Ghi chú ô {addr}</b>
          <button type="button" className="ml-auto text-slate-500 hover:text-slate-800" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="max-h-44 space-y-1.5 overflow-y-auto">
          {list.map((n) => (
            <div key={n.id} className="rounded bg-amber-50 px-2 py-1 ring-1 ring-amber-200">
              <div className="flex items-center gap-1">
                <b>{n.user}</b>
                <span className="text-slate-500">{n.at}</span>
                {n.mine && (
                  <button
                    type="button"
                    className="ml-auto text-red-600 hover:underline"
                    onClick={async () => {
                      if (!window.confirm("Xoá ghi chú này?")) return;
                      const err = await api.remove(n.id);
                      if (err) window.alert(err);
                    }}
                  >
                    xoá
                  </button>
                )}
              </div>
              <div className="whitespace-pre-wrap">{n.text}</div>
            </div>
          ))}
          {!list.length && <div className="text-slate-500">Chưa có ghi chú.</div>}
        </div>
        {api.canAdd === false ? null : isNew ? (
          <div className="mt-2 text-amber-700">Dòng mới thêm chưa lưu — bấm Lưu nháp trước rồi mới ghi chú được.</div>
        ) : (
          <>
            <textarea
              autoFocus
              rows={3}
              className="mt-2 w-full rounded border border-slate-300 px-2 py-1"
              placeholder="Gõ ghi chú (VD lý do sửa giá)… Ctrl+Enter để lưu"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && void save()}
            />
            <div className="mt-1 flex justify-end gap-2">
              <span className="mr-auto self-center text-slate-500">Lưu ngay, không cần Lưu nháp</span>
              <button type="button" disabled={busy || !text.trim()} className="rounded bg-sky-700 px-3 py-1 font-medium text-white hover:bg-sky-800 disabled:opacity-50" onClick={() => void save()}>
                {busy ? "Đang lưu…" : "Lưu ghi chú"}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
