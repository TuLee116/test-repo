"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import TableResize from "@/app/(app)/TableResize";
import {
  gridAddRowsAction,
  gridDeleteColAction,
  gridDeleteRowsAction,
  gridInsertColAction,
  gridInsertRowAction,
  gridSetRowsHeadingAction,
  gridMoveRowAction,
  gridRenameColAction,
  gridRenameHeadingAction,
  gridSetAmountColAction,
  gridAddHeaderRowAction,
  gridRemoveHeaderRowAction,
  gridSetAutoSttAction,
  gridSetHeaderCellAction,
  gridSetHeadingLevelAction,
  gridSetHeadingSttAction,
  gridMergeAction,
  gridUnmergeAction,
  gridSetCellsAction,
  gridSetLinkColAction,
  gridSetStylesAction,
  setGridHeadingShowInDtcpAction,
} from "@/lib/actions";
import { colLetter, createEvaluator, formatCellValue, isSubtotalFormula, formulaRefs, isNumberValue, shiftRefs, shiftRefsDown, toDisplayFormula, toStoredFormula } from "@/lib/grid-formula";
import { linkKeysOf, type GridSourceOption } from "@/lib/grid-sources-shared";
import LinkPicker from "./LinkPicker";
import { fillValue, inverseOps, parseTSV, toTSV, type CellOp } from "@/lib/grid-ops";
import { formatStyledNumber, parseStyle, shownDecimals, stringifyStyle, type CellStyle } from "@/lib/grid-style";
import ScrollTable from "./ScrollTable";
import GridFormatBar from "./GridFormatBar";
import { mergeContains, mergesIntersect, type GridMerge } from "@/lib/grid-merge";
import { headingBlockEnd, headingLabels } from "@/lib/grid-heading";
import { confirmNear } from "@/app/(app)/confirm-near";
import { collapseToLevel, OutlineBar, OutlineToggle, outlineHidden, useOutline } from "@/app/(app)/outline";

const NO_STYLE: CellStyle = {};
let measureCanvas: HTMLCanvasElement | null = null;

function growTo(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

// Ô chữ 1 hoặc nhiều dòng như Excel: tự giãn chiều cao, Enter = xong (lưu), Alt+Enter / Shift+Enter = xuống dòng trong ô
function GrowText({ value, onCommit, className, placeholder, title }: { value: string; onCommit: (v: string) => void; className: string; placeholder?: string; title?: string }) {
  return (
    <textarea
      data-grow=""
      rows={1}
      ref={growTo}
      defaultValue={value}
      placeholder={placeholder}
      title={title}
      onInput={(e) => growTo(e.currentTarget)}
      onBlur={(e) => e.currentTarget.value !== value && onCommit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (e.altKey || e.shiftKey) {
          const el = e.currentTarget;
          el.setRangeText("\n", el.selectionStart, el.selectionEnd, "end");
          growTo(el);
        } else e.currentTarget.blur();
      }}
      className={`resize-none overflow-hidden whitespace-pre-wrap break-words leading-5 ${className}`}
    />
  );
}
type Range = { r1: number; c1: number; r2: number; c2: number };

const LINK_COLS: { value: string; label: string }[] = [
  { value: "vt", label: "Vật tư" },
  { value: "nc", label: "Nhân công" },
  { value: "nck", label: "Nhân công khác" },
  { value: "tp", label: "Thầu phụ" },
  { value: "tb", label: "Thiết bị" },
  { value: "mmtb", label: "MMTB + VT phụ" },
];

// Bảng tự do làm việc như Excel: công thức (=B2*C2, =SUM(D2:D9), =IF(...)), tham chiếu ô/vùng, dán khối từ Excel,
// mũi tên lên/xuống, Enter, Ctrl+D điền xuống; có đầu mục lớn, "Chuyển tới", chọn cột "Thành tiền" để link DT-CP / CHI TIẾT.
export default function GridEditor({
  projectId,
  sheetId,
  colTitles,
  rowCount,
  amountCol,
  linkCol,
  cells,
  styles,
  merges,
  headerRows,
  autoStt,
  headings,
  linkValues,
  linkOptions,
}: {
  projectId: string;
  sheetId: string;
  colTitles: string[];
  rowCount: number;
  amountCol: number | null;
  linkCol: string | null;
  cells: Record<string, string>;
  styles: Record<string, string>; // định dạng ô (JSON CellStyle) theo "dòng:cột"
  merges: GridMerge[]; // các ô đã gộp
  autoStt: boolean; // cột đầu (STT) tự đánh số theo các dòng đã có tên công việc
  headerRows: string[][]; // dòng tiêu đề phụ phía trên dòng tên cột (phần tử 0 = dòng sát dòng tên cột nhất)
  headings: Record<number, { id: string; title: string; showInDtcp: boolean; stt: string | null; level: number }>; // theo chỉ số dòng
  linkValues: Record<string, number>; // giá trị các nguồn liên kết cho hàm LINK("khoá") (BOQ, TH Thiết Bị...)
  linkOptions: GridSourceOption[];
}) {
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const nCols = colTitles.length;

  const styleMap = useMemo(() => new Map(Object.entries(styles).map(([k, v]) => [k, parseStyle(v)])), [styles]);
  // Định dạng hiệu lực của ô: ô nào chưa được định dạng riêng thì tự theo định dạng của ô gần nhất phía trên cùng cột
  // (sửa định dạng 1 dòng thì các dòng tiếp theo tự giống); muốn khác thì định dạng riêng ô đó, "Xoá định dạng" để ngừng kế thừa.
  const effStyles = useMemo(() => {
    const out = new Map<string, CellStyle>();
    for (let c = 0; c < nCols; c++) {
      let cur: CellStyle = NO_STYLE;
      for (let r = 0; r < rowCount; r++) {
        if (headings[r]) continue;
        const own = styleMap.get(`${r}:${c}`);
        if (own) cur = own.reset ? NO_STYLE : own;
        if (cur !== NO_STYLE) out.set(`${r}:${c}`, cur);
      }
    }
    return out;
  }, [styleMap, headings, rowCount, nCols]);
  const styleOf = (r: number, c: number): CellStyle => (r < 0 ? NO_STYLE : (effStyles.get(`${r}:${c}`) ?? NO_STYLE));
  const inheritedAbove = (r: number, c: number): CellStyle => {
    for (let rr = r - 1; rr >= 0; rr--) if (!headings[rr]) return effStyles.get(`${rr}:${c}`) ?? NO_STYLE;
    return NO_STYLE;
  };

  // ô gộp: ô trên-trái (master) hiện rowSpan/colSpan, các ô còn lại bị che (không vẽ)
  const { masters, covered } = useMemo(() => {
    const masters = new Map<string, GridMerge>();
    const covered = new Set<string>();
    for (const m of merges) {
      masters.set(`${m.r1}:${m.c1}`, m);
      for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) covered.add(`${r}:${c}`);
    }
    return { masters, covered };
  }, [merges]);
  const mergeAt = (r: number, c: number) => merges.find((m) => mergeContains(m, r, c));

  // vùng ô đang chọn (bấm / kéo / Shift+bấm / bấm tên cột) để áp dụng định dạng
  const [range, setRange] = useState<Range | null>(null);
  const [painter, setPainter] = useState<{ style: CellStyle; src: string } | null>(null);
  const anchor = useRef<{ r: number; c: number } | null>(null);
  const dragging = useRef(false);
  const box = range ? { r1: Math.min(range.r1, range.r2), r2: Math.max(range.r1, range.r2), c1: Math.min(range.c1, range.c2), c2: Math.max(range.c1, range.c2) } : null;
  const boxKey = box ? `${box.r1}:${box.c1}:${box.r2}:${box.c2}` : "";
  const multi = !!box && (box.r1 !== box.r2 || box.c1 !== box.c2);
  const inBox = (r: number, c: number) => !!box && r >= box.r1 && r <= box.r2 && c >= box.c1 && c <= box.c2;

  const ev = useMemo(() => createEvaluator((r, c) => cells[`${r}:${c}`] ?? "", rowCount, nCols, linkValues), [cells, rowCount, nCols, linkValues]);

  // đầu mục theo thứ tự, và đầu mục hiện tại của từng dòng
  const headingRows = Object.keys(headings)
    .map(Number)
    .sort((a, b) => a - b);
  const headList = headingRows.map((r) => ({ id: headings[r].id, row: r, stt: headings[r].stt, level: headings[r].level }));
  // thu gọn / mở rộng nhóm theo đầu mục (giống Group của Excel)
  const outline = useOutline(`grid-${sheetId}`);
  const hiddenRows = outlineHidden(
    Array.from({ length: rowCount }, (_, r) => (headings[r] ? { headingId: headings[r].id, level: headings[r].level } : {})),
    outline.collapsed
  );
  const maxLevel = headList.reduce((m, h) => Math.max(m, h.level + 1), 0);
  const labelOf = new Map(headingLabels(headList).map((label, i) => [headList[i].id, label]));
  const groupOf = (r: number): string | null => {
    let cur: string | null = null;
    for (const h of headingRows) {
      if (h < r) cur = headings[h].id;
      else break;
    }
    return cur;
  };
  // các cột "Thành tiền" khác (VD Prelim: Trực tiếp phí và Báo giá CĐT) cũng được cộng subtotal ở đầu mục và tổng cuối bảng
  const extraAmountCols = amountCol === null ? [] : colTitles.map((t, c) => (c > amountCol && /^\s*thành\s*tiền\s*$/i.test(t) ? c : -1)).filter((c) => c >= 0);
  // dòng tổng phụ =SUBTOTAL(...) không cộng vào tổng đầu mục / tổng cuối bảng (giống Excel, tránh cộng 2 lần)
  const amountOf = (r: number, col: number | null = amountCol): number => {
    if (col === null || headings[r] || isSubtotalFormula(cells[`${r}:${col}`] ?? "")) return 0;
    const v = ev.valueOf(r, col);
    return isNumberValue(v) ? v : 0;
  };
  const subtotal = (hRow: number, col: number | null = amountCol): number => {
    let s = 0;
    // đầu mục cha cộng cả các dòng nằm trong đầu mục con của nó
    const idx = headingRows.indexOf(hRow);
    const end = idx < 0 ? rowCount : headingBlockEnd(headList, idx, rowCount);
    for (let r = hRow + 1; r < end; r++) s += amountOf(r, col);
    return s;
  };
  const total = Array.from({ length: rowCount }, (_, r) => amountOf(r)).reduce((s, v) => s + v, 0);
  const fmtMoney = (n: number) => Math.round(n).toLocaleString("vi-VN");

  // chọn ô tiêu đề (dòng tên cột r = -1, dòng tiêu đề phụ r = -2, -3...): bấm / kéo / Shift+bấm trong vùng tiêu đề
  function headerDown(e: React.MouseEvent, r: number, c: number) {
    if (e.shiftKey && anchor.current && anchor.current.r < 0) {
      e.preventDefault();
      setRange({ r1: anchor.current.r, c1: anchor.current.c, r2: r, c2: c });
      return;
    }
    anchor.current = { r, c };
    dragging.current = true;
    setRange({ r1: r, c1: c, r2: r, c2: c });
  }
  function headerEnter(r: number, c: number) {
    if (!dragging.current || !anchor.current || anchor.current.r >= 0 || (anchor.current.r === r && anchor.current.c === c)) return;
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
    window.getSelection()?.removeAllRanges();
    setRange({ r1: anchor.current.r, c1: anchor.current.c, r2: r, c2: c });
  }
  const nHeader = headerRows.length;
  // Số dòng như Excel: dòng 1 là dòng trên cùng của tiêu đề, dòng dữ liệu đầu tiên là dòng (số dòng tiêu đề + 2)
  const H = nHeader + 1;
  const dispF = (f: string) => toDisplayFormula(f, H);
  const storeF = (v: string) => toStoredFormula(v, H);
  const numTh = "w-9 whitespace-nowrap border border-slate-200 bg-slate-50 px-0.5 text-center text-[10px] font-normal text-slate-400 select-none";

  // Ô "Thêm" ở tiêu đề: thêm / xoá cột (chọn cột đứng trước / sau, hoặc cột cần xoá)
  const [colDialog, setColDialog] = useState<null | { mode: "add" | "del"; col: number; where: "before" | "after" }>(null);
  const themHead = (
    <div className="flex flex-col items-center gap-0.5">
      <span>Thêm</span>
      <select
        value=""
        title="Thêm hoặc xoá cột"
        onChange={(e) => {
          const v = e.target.value;
          if (v === "add" || v === "del") setColDialog({ mode: v, col: box && box.c1 >= 0 && box.c1 < nCols ? box.c1 : nCols - 1, where: "after" });
        }}
        className="h-5 w-16 cursor-pointer rounded border border-slate-300 bg-white px-0.5 py-0 text-[11px] font-normal"
      >
        <option value="">Cột…</option>
        <option value="add">＋ Thêm cột…</option>
        {nCols > 1 && <option value="del">✕ Xoá cột…</option>}
      </select>
    </div>
  );

  // Ô tự giãn chiều cao theo nội dung (nội dung dài tự xuống dòng)
  const autosize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el || el.style.position === "absolute") return; // ô công thức đang sửa nổi lên: không đo chiều cao lúc này
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  const focusByMouse = useRef(false); // ô vừa được focus bằng chuột (không bôi đen sẵn để kéo chọn nhiều ô không bị "lôi" chữ)
  // đổi độ rộng cột / cửa sổ thì dòng chữ ngắt khác đi → tính lại chiều cao
  useEffect(() => {
    const table = document.getElementById(`rz-grid-${sheetId}`);
    if (!table) return;
    const ro = new ResizeObserver(() => table.querySelectorAll<HTMLTextAreaElement>("textarea[data-grid], textarea[data-grow]").forEach(autosize));
    ro.observe(table);
    return () => ro.disconnect();
  }, [sheetId]);

  function focusCell(row: number, col: number) {
    const m = mergeAt(row, col); // ô nằm trong vùng gộp → nhảy vào ô trên-trái của vùng đó
    const el = document.querySelector<HTMLTextAreaElement>(`textarea[data-grid="${m ? m.r1 : row}:${m ? m.c1 : col}"]`);
    el?.focus();
  }

  function applyStyles(fn: (s: CellStyle) => CellStyle) {
    if (!box) return;
    const entries: { row: number; col: number; style: string }[] = [];
    for (let r = box.r1; r <= box.r2; r++) {
      if (r < 0 || headings[r]) continue;
      for (let c = box.c1; c <= box.c2; c++) {
        let next = stringifyStyle(fn(styleOf(r, c)));
        // định dạng trống: nếu phía trên có định dạng thì phải ghi dấu "không kế thừa", nếu không thì để trống hẳn
        if (next === "" || next === '{"reset":true}') next = Object.keys(inheritedAbove(r, c)).length ? '{"reset":true}' : "";
        const effNext = next === '{"reset":true}' ? "" : next;
        if (effNext !== stringifyStyle(styleOf(r, c))) entries.push({ row: r, col: c, style: next });
      }
    }
    commit(entries);
  }
  const active: CellStyle = box ? styleOf(box.r1, box.c1) : NO_STYLE;
  const toggle = (key: "b" | "i" | "u") => {
    const on = !active[key];
    applyStyles((st) => ({ ...st, [key]: on ? true : undefined }));
  };
  // Kết quả công thức mặc định hiện tròn số đơn vị; cần số lẻ thì dùng nút thêm số sau dấu phẩy trên thanh định dạng
  // Số gõ trực tiếp từ 1.000 trở lên mặc định hiện có dấu phân cách nghìn (250000 → 250.000) cho đồng đều với kết quả công thức
  const typedNumber = (raw: string) => (/^-?[1-9]\d{3,}(\.\d+)?$/.test(raw.trim()) ? Number(raw.trim()).toLocaleString("vi-VN", { maximumFractionDigits: 6 }) : raw);
  const fmtDefault = (v: ReturnType<typeof ev.valueOf>) => (isNumberValue(v) ? v.toLocaleString("vi-VN", { maximumFractionDigits: 0 }) : formatCellValue(v));
  function changeDecimals(delta: 1 | -1) {
    const v = box ? ev.valueOf(box.r1, box.c1) : null;
    const isF = box ? (cells[`${box.r1}:${box.c1}`] ?? "").trim().startsWith("=") : false;
    const base = active.dec ?? (isNumberValue(v) && !isF ? (active.pct ? 0 : shownDecimals(v)) : 0);
    const next = Math.max(0, Math.min(10, base + delta));
    applyStyles((st) => ({ ...st, dec: next }));
  }
  function armPainter() {
    if (painter) return setPainter(null);
    if (box) setPainter({ style: { ...active }, src: boxKey });
  }
  // Sao chép định dạng: thả chuột xong ở ô / vùng khác ô mẫu thì áp dụng
  const latest = useRef({ painter, boxKey, apply: applyStyles, doFill });
  latest.current = { painter, boxKey, apply: applyStyles, doFill };
  useEffect(() => {
    const up = () => {
      dragging.current = false;
      refDragging.current = false;
      const fd = fillDrag.current;
      if (fd) {
        const pv = fillPreviewRef.current;
        fillDrag.current = null;
        fillPreviewRef.current = null;
        setFillPreview(null);
        if (pv) latest.current.doFill(fd, pv);
      }
      setTimeout(() => {
        const { painter: pt, boxKey: key, apply } = latest.current;
        if (pt && key && key !== pt.src) {
          apply(() => ({ ...pt.style }));
          setPainter(null);
        }
      }, 0);
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  // ===================== Thao tác kiểu Excel =====================
  // ---- Hoàn tác / làm lại (chỉ cho thay đổi nội dung + định dạng ô; đổi cấu trúc bảng thì xoá lịch sử) ----
  type HistoryEntry = { undo: CellOp[]; redo: CellOp[] };
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const [, setHistTick] = useState(0);
  const structureKey = `${rowCount}|${nCols}|${headerRows.length}|${headingRows.join(",")}|${merges.length}`;
  useEffect(() => {
    undoStack.current = [];
    redoStack.current = [];
    setHistTick((t) => t + 1);
  }, [structureKey]);

  function sendOps(ops: CellOp[]) {
    const vals = ops.filter((o) => o.value !== undefined).map((o) => ({ row: o.row, col: o.col, value: o.value as string }));
    const sts = ops.filter((o) => o.style !== undefined).map((o) => ({ row: o.row, col: o.col, style: o.style as string }));
    if (!vals.length && !sts.length) return;
    start(async () => {
      if (vals.length) await gridSetCellsAction(projectId, sheetId, vals);
      if (sts.length) await gridSetStylesAction(projectId, sheetId, sts);
    });
  }
  // Mọi thay đổi nội dung / định dạng ô đều đi qua đây: lọc ô không đổi, lưu lịch sử để hoàn tác, rồi gửi lên máy chủ
  function commit(rawOps: CellOp[]) {
    const ops: CellOp[] = [];
    for (const o of rawOps) {
      const key = `${o.row}:${o.col}`;
      if (o.row < 0 || o.col < 0 || headings[o.row] || covered.has(key)) continue;
      const op: CellOp = { row: o.row, col: o.col };
      if (o.value !== undefined && o.value !== (cells[key] ?? "")) op.value = o.value;
      if (o.style !== undefined && o.style !== (styles[key] ?? "")) op.style = o.style;
      if (op.value !== undefined || op.style !== undefined) ops.push(op);
    }
    if (!ops.length) return;
    undoStack.current.push({ undo: inverseOps(ops, cells, styles), redo: ops });
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    setHistTick((t) => t + 1);
    sendOps(ops);
  }
  function undo() {
    const e = undoStack.current.pop();
    if (!e) return;
    redoStack.current.push(e);
    setHistTick((t) => t + 1);
    sendOps(e.undo);
  }
  function redo() {
    const e = redoStack.current.pop();
    if (!e) return;
    undoStack.current.push(e);
    setHistTick((t) => t + 1);
    sendOps(e.redo);
  }

  function saveCell(row: number, col: number, value: string) {
    commit([{ row, col, value }]);
  }

  // Dán văn bản dạng bảng (Tab / xuống dòng, như copy từ Excel) bắt đầu từ ô (row, col)
  function pasteBlock(row: number, col: number, text: string) {
    const ops: CellOp[] = [];
    parseTSV(text).forEach((line, i) =>
      line.forEach((v, j) => {
        if (autoStt && col + j === 0) return; // cột STT tự đánh số
        ops.push({ row: row + i, col: col + j, value: v.trim() });
      })
    );
    commit(ops);
  }

  // ---- Sao chép / cắt / dán vùng ô (giữ công thức, tham chiếu tự dời như Excel, kèm định dạng) ----
  type ClipData = { rows: string[][]; styles: string[][]; tsv: string; r0: number; c0: number; cut: Range | null };
  const clip = useRef<ClipData | null>(null);
  function copySelection(cut: boolean): string | null {
    if (!box || box.r1 < 0) return null;
    const rows: string[][] = [];
    const sts: string[][] = [];
    const shown: string[][] = [];
    for (let r = box.r1; r <= box.r2; r++) {
      const rr: string[] = [];
      const ss: string[] = [];
      const dd: string[] = [];
      for (let c = box.c1; c <= box.c2; c++) {
        const key = `${r}:${c}`;
        const raw = cells[key] ?? "";
        const v = ev.valueOf(r, c);
        const st = styleOf(r, c);
        rr.push(raw);
        ss.push(stringifyStyle(styleOf(r, c)));
        const isF = raw.trim().startsWith("=");
        dd.push((isNumberValue(v) ? formatStyledNumber(v, st, isF ? 0 : undefined) : null) ?? (isF ? fmtDefault(v) : typedNumber(raw)));
      }
      rows.push(rr);
      sts.push(ss);
      shown.push(dd);
    }
    const tsv = toTSV(shown);
    clip.current = { rows, styles: sts, tsv, r0: box.r1, c0: box.c1, cut: cut ? { ...box } : null };
    return tsv;
  }
  function pasteFromText(text: string) {
    if (!box || box.r1 < 0) return;
    const internal = clip.current && clip.current.tsv === text ? clip.current : null;
    if (!internal) {
      pasteBlock(box.r1, box.c1, text);
      return;
    }
    const h = internal.rows.length;
    const w = internal.rows[0]?.length ?? 0;
    if (!h || !w) return;
    const single = h === 1 && w === 1;
    const th = single && multi ? box.r2 - box.r1 + 1 : h; // 1 ô nguồn dán vào vùng nhiều ô thì lấp đầy cả vùng
    const tw = single && multi ? box.c2 - box.c1 + 1 : w;
    const ops: CellOp[] = [];
    const moved = internal.cut;
    if (moved) {
      // cắt: xoá nội dung + định dạng ở chỗ cũ (các ô vừa dán lên sẽ ghi đè lại)
      for (let r = moved.r1; r <= moved.r2; r++) for (let c = moved.c1; c <= moved.c2; c++) if (!(autoStt && c === 0)) ops.push({ row: r, col: c, value: "", style: "" });
    }
    for (let i = 0; i < th; i++)
      for (let j = 0; j < tw; j++) {
        const tr = box.r1 + i;
        const tc = box.c1 + j;
        if (autoStt && tc === 0) continue;
        const si = i % h;
        const sj = j % w;
        const raw = internal.rows[si][sj];
        const value = raw.trim().startsWith("=") ? shiftRefs(raw.trim(), tr - (internal.r0 + si), tc - (internal.c0 + sj)) : raw;
        ops.push({ row: tr, col: tc, value, style: internal.styles[si][sj] });
      }
    if (moved) clip.current = { ...internal, cut: null };
    commit(ops);
  }

  // ---- Kéo ô điền (chấm vuông ở góc dưới phải vùng chọn): kéo xuống / sang phải để điền dãy số, công thức, chữ ----
  const fillDrag = useRef<Range | null>(null);
  const fillPreviewRef = useRef<Range | null>(null);
  const [fillPreview, setFillPreview] = useState<Range | null>(null);
  function startFill(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!box || box.r1 < 0) return;
    fillDrag.current = { ...box };
  }
  function updateFillPreview(r: number, c: number) {
    const src = fillDrag.current;
    if (!src) return;
    const dr = r - src.r2;
    const dc = c - src.c2;
    let next: Range | null = null;
    if (dr > 0 && dr >= dc) next = { r1: src.r1, c1: src.c1, r2: r, c2: src.c2 };
    else if (dc > 0) next = { r1: src.r1, c1: src.c1, r2: src.r2, c2: c };
    const same = (a: Range | null, b: Range | null) => (a === null && b === null) || (!!a && !!b && a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2);
    if (same(fillPreviewRef.current, next)) return;
    fillPreviewRef.current = next;
    setFillPreview(next);
  }
  function doFill(src: Range, pv: Range) {
    const down = pv.r2 > src.r2;
    const ops: CellOp[] = [];
    if (down) {
      for (let c = src.c1; c <= src.c2; c++) {
        if (autoStt && c === 0) continue;
        const vals: string[] = [];
        const sts: string[] = [];
        for (let r = src.r1; r <= src.r2; r++) {
          vals.push(cells[`${r}:${c}`] ?? "");
          sts.push(stringifyStyle(styleOf(r, c)));
        }
        for (let r = src.r2 + 1; r <= pv.r2; r++) {
          const idx = r - src.r1;
          ops.push({ row: r, col: c, value: fillValue(vals, idx, "down"), style: sts[idx % sts.length] });
        }
      }
    } else {
      for (let r = src.r1; r <= src.r2; r++) {
        const vals: string[] = [];
        const sts: string[] = [];
        for (let c = src.c1; c <= src.c2; c++) {
          vals.push(cells[`${r}:${c}`] ?? "");
          sts.push(stringifyStyle(styleOf(r, c)));
        }
        for (let c = src.c2 + 1; c <= pv.c2; c++) {
          if (autoStt && c === 0) continue;
          const idx = c - src.c1;
          ops.push({ row: r, col: c, value: fillValue(vals, idx, "right"), style: sts[idx % sts.length] });
        }
      }
    }
    commit(ops);
    setRange(pv);
  }

  // ---- Tìm & thay thế (Ctrl+F / Ctrl+H) ----
  const [find, setFind] = useState<null | { text: string; replace: string; idx: number }>(null);
  const findMatches = useMemo(() => {
    if (!find || find.text === "") return [] as { r: number; c: number }[];
    const needle = find.text.toLowerCase();
    const out: { r: number; c: number }[] = [];
    for (let r = 0; r < rowCount; r++) {
      if (headings[r]) continue;
      for (let c = 0; c < nCols; c++) {
        if (covered.has(`${r}:${c}`)) continue;
        if ((cells[`${r}:${c}`] ?? "").toLowerCase().includes(needle)) out.push({ r, c });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [find?.text, cells, rowCount, nCols]);
  function goToMatch(i: number) {
    if (!find || findMatches.length === 0) return;
    const n = findMatches.length;
    const idx = ((i % n) + n) % n;
    const m = findMatches[idx];
    setFind({ ...find, idx });
    focusCell(m.r, m.c);
    setTimeout(() => {
      const el = document.querySelector<HTMLTextAreaElement>(`textarea[data-grid="${m.r}:${m.c}"]`);
      if (!el) return;
      const pos = el.value.toLowerCase().indexOf(find.text.toLowerCase());
      if (pos >= 0) el.setSelectionRange(pos, pos + find.text.length);
      el.scrollIntoView({ block: "nearest" });
    }, 30);
  }
  const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function replaceOne() {
    if (!find || findMatches.length === 0) return;
    const m = findMatches[Math.min(find.idx, findMatches.length - 1)];
    if (autoStt && m.c === 0) return;
    const raw = cells[`${m.r}:${m.c}`] ?? "";
    commit([{ row: m.r, col: m.c, value: raw.replace(new RegExp(escapeRe(find.text), "i"), () => find.replace) }]);
  }
  function replaceAll() {
    if (!find || findMatches.length === 0) return;
    const re = new RegExp(escapeRe(find.text), "gi");
    const ops: CellOp[] = [];
    for (const m of findMatches) {
      if (autoStt && m.c === 0) continue;
      ops.push({ row: m.r, col: m.c, value: (cells[`${m.r}:${m.c}`] ?? "").replace(re, () => find.replace) });
    }
    commit(ops);
  }

  // ---- Chỉ ô để lập công thức (như Excel): gõ "=" rồi bấm mũi tên hoặc bấm chuột vào ô cần tham chiếu ----
  // Đang sửa 1 ô có công thức, con trỏ đứng sau dấu = + - * / ( , ; thì mũi tên / chuột sẽ chèn địa chỉ ô (F2, F2:G5) vào công thức;
  // bấm tiếp mũi tên thì dời ô đang chỉ, Shift+mũi tên / kéo chuột thì mở rộng thành vùng, gõ phím khác thì chốt lại.
  type RefMode = { start: number; end: number; ptr: { r: number; c: number }; anchor: { r: number; c: number } };
  // Tô màu từng tham chiếu trong công thức đang xem / sửa (mỗi ô hoặc vùng 1 màu, ô được dùng viền cùng màu) như Excel
  const REF_COLORS = ["#2563eb", "#dc2626", "#9333ea", "#16a34a", "#ea580c", "#0891b2", "#be185d", "#a16207"];
  const [fEdit, setFEdit] = useState<null | { r: number; c: number; text: string }>(null);
  // Thoát chế độ sửa ô: đo lại chiều cao mọi ô để dòng co / giãn đúng theo nội dung hiện tại
  const isEditing = fEdit !== null;
  useEffect(() => {
    if (isEditing) return;
    const id = requestAnimationFrame(() => document.querySelectorAll<HTMLTextAreaElement>("textarea[data-grid], textarea[data-grow]").forEach(autosize));
    return () => cancelAnimationFrame(id);
  }, [isEditing, cells, autosize]);
  // Sửa công thức như Excel: ô sửa nổi lên, 1 dòng, canh trái, giãn rộng sang phải theo độ dài công thức
  const [editW, setEditW] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!fEdit || !fEdit.text.startsWith("=")) {
      setEditW(null);
      return;
    }
    const el = document.querySelector<HTMLTextAreaElement>(`textarea[data-grid="${fEdit.r}:${fEdit.c}"]`);
    const td = el?.parentElement;
    if (!el || !td) return;
    const cs = getComputedStyle(el);
    measureCanvas ??= document.createElement("canvas");
    const ctx = measureCanvas.getContext("2d");
    if (!ctx) return;
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const w = Math.max(...fEdit.text.split("\n").map((l) => ctx.measureText(l).width));
    setEditW(Math.max(td.offsetWidth, Math.ceil(w) + 20));
  }, [fEdit?.text, fEdit?.r, fEdit?.c]);
  const fRefs = useMemo(() => {
    if (!fEdit || !fEdit.text.startsWith("=")) return [];
    return formulaRefs(fEdit.text)
      .map((x, i) => ({ ...x, color: REF_COLORS[i % REF_COLORS.length], ir1: Math.max(0, x.r1 - 1 - H), ir2: x.r2 - 1 - H, ic1: x.c1, ic2: x.c2 }))
      .filter((x) => x.ir2 >= 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fEdit?.text, H]);
  const refStyleOf = (r: number, c: number): React.CSSProperties => {
    for (const x of fRefs) {
      if (r < x.ir1 || r > x.ir2 || c < x.ic1 || c > x.ic2) continue;
      const sh: string[] = [];
      if (r === x.ir1) sh.push(`inset 0 2px 0 0 ${x.color}`);
      if (r === x.ir2) sh.push(`inset 0 -2px 0 0 ${x.color}`);
      if (c === x.ic1) sh.push(`inset 2px 0 0 0 ${x.color}`);
      if (c === x.ic2) sh.push(`inset -2px 0 0 0 ${x.color}`);
      return { boxShadow: sh.join(","), backgroundImage: `linear-gradient(${x.color}22, ${x.color}22)` };
    }
    return {};
  };
  const refMode = useRef<RefMode | null>(null);
  const refDragging = useRef(false);
  const [refBox, setRefBox] = useState<Range | null>(null);
  const clearRef = () => {
    if (refMode.current || refBox) {
      refMode.current = null;
      setRefBox(null);
    }
  };
  const cellOf = (el: HTMLTextAreaElement) => {
    const [r, c] = (el.getAttribute("data-grid") as string).split(":").map(Number);
    return { r, c };
  };
  function atRefPoint(el: HTMLTextAreaElement): boolean {
    if (!el.value.startsWith("=") || el.selectionStart !== el.selectionEnd) return false;
    const before = el.value.slice(0, el.selectionStart).replace(/\s+$/, "");
    return before !== "" && /[=+\-*/^(,;&<>]$/.test(before);
  }
  function putRef(el: HTMLTextAreaElement, ptr: { r: number; c: number }, anchor: { r: number; c: number }) {
    const a = `${colLetter(anchor.c)}${anchor.r + 1 + H}`;
    const b = `${colLetter(ptr.c)}${ptr.r + 1 + H}`;
    const text = anchor.r === ptr.r && anchor.c === ptr.c ? b : `${a}:${b}`;
    const st = refMode.current;
    const from = st ? st.start : el.selectionStart;
    const to = st ? st.end : el.selectionStart;
    el.value = el.value.slice(0, from) + text + el.value.slice(to);
    const end = from + text.length;
    el.setSelectionRange(end, end);
    refMode.current = { start: from, end, ptr, anchor };
    setFEdit({ ...cellOf(el), text: el.value });
    setRefBox({ r1: Math.min(anchor.r, ptr.r), c1: Math.min(anchor.c, ptr.c), r2: Math.max(anchor.r, ptr.r), c2: Math.max(anchor.c, ptr.c) });
    autosize(el);
  }
  // true = phím mũi tên đã được dùng để chỉ ô
  function pointWithArrow(el: HTMLTextAreaElement, dr: number, dc: number, shift: boolean): boolean {
    const st = refMode.current;
    if (!st && !atRefPoint(el)) return false;
    const base = st ? st.ptr : cellOf(el);
    const ptr = { r: Math.max(0, Math.min(rowCount - 1, base.r + dr)), c: Math.max(0, Math.min(nCols - 1, base.c + dc)) };
    putRef(el, ptr, st && shift ? st.anchor : ptr);
    return true;
  }
  // true = lần bấm chuột này dùng để chỉ ô (không chuyển ô đang sửa)
  function pointWithMouse(e: React.MouseEvent, r: number, c: number): boolean {
    const ae = document.activeElement;
    if (!isGridCell(ae)) return false;
    const me = cellOf(ae);
    if (me.r === r && me.c === c) return false;
    if (!refMode.current && !atRefPoint(ae)) return false;
    e.preventDefault(); // giữ nguyên ô đang sửa
    const st = refMode.current;
    putRef(ae, { r, c }, e.shiftKey && st ? st.anchor : { r, c });
    refDragging.current = true;
    return true;
  }

  // ---- Chế độ chọn ô / sửa ô như Excel ----
  // Bấm vào ô chỉ CHỌN ô (ô hiện giá trị, công thức xem ở thanh công thức). F2, bấm đúp hoặc gõ chữ thì mới SỬA.
  const editingKey = useRef<string | null>(null);
  // Gõ số: tự thêm dấu chấm hàng nghìn ngay khi gõ (2200000 → 2.200.000) để biết đang nhập tới bao nhiêu. Gõ dấu chấm vào số vừa gõ
  // (1.5) thì hiểu là số thập phân và ngừng nhóm; công thức (=...), %, chữ không bị đụng tới. Lưu lại thì bỏ dấu chấm nghìn.
  const lastTyped = useRef("");
  const decimalMode = useRef(false);
  const plainThousands = (v: string) => (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(v) ? v.replace(/\./g, "") : v);
  function groupWhileTyping(el: HTMLTextAreaElement) {
    const v = el.value;
    const prev = lastTyped.current;
    lastTyped.current = v;
    if (!/^-?[\d.]+$/.test(v)) {
      decimalMode.current = false;
      return;
    }
    if (v.includes(".") && !prev.includes(".") && v.length - prev.length === 1) decimalMode.current = true; // vừa gõ dấu chấm: số thập phân
    if (decimalMode.current) return;
    const neg = v.startsWith("-") ? "-" : "";
    const digits = v.replace(/[-.]/g, "");
    const out = digits.length >= 4 && digits[0] !== "0" ? neg + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : prev.includes(".") ? neg + digits : v;
    if (out === v) return;
    const caret = el.selectionStart ?? v.length;
    const digitsBefore = v.slice(0, caret).replace(/[-.]/g, "").length;
    el.value = out;
    let pos = 0;
    let seen = 0;
    while (pos < out.length && seen < digitsBefore) if (/\d/.test(out[pos++])) seen++;
    el.setSelectionRange(pos, pos);
    lastTyped.current = out;
  }
  // vào chế độ sửa ô: "replace" = xoá nội dung cũ để gõ mới; "end" = hiện công thức / nội dung gốc, con trỏ ở cuối
  function beginEditCell(el: HTMLTextAreaElement, mode: "replace" | "end"): boolean {
    const { r, c } = cellOf(el);
    if (autoStt && c === 0) return false; // cột STT tự đánh số
    const key = `${r}:${c}`;
    editingKey.current = key;
    el.readOnly = false;
    el.value = mode === "replace" ? "" : dispF(cells[key] ?? "");
    if (mode === "end") el.setSelectionRange(el.value.length, el.value.length);
    lastTyped.current = el.value;
    decimalMode.current = el.value.includes(".") && !/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(el.value); // sửa số thập phân sẵn có (1234.5): không nhóm lại
    setFEdit({ r, c, text: el.value });
    autosize(el);
    return true;
  }
  // Ctrl+D / Ctrl+R như Excel: điền từ dòng đầu (cột đầu) của vùng chọn xuống / sang phải hết vùng; chọn 1 ô thì lấy ô phía trên / bên trái
  function fillEdge(dir: "down" | "right") {
    if (!box || box.r1 < 0) return;
    const single = dir === "down" ? box.r1 === box.r2 : box.c1 === box.c2;
    const from = single ? (dir === "down" ? { r1: box.r1 - 1, r2: box.r2, c1: box.c1, c2: box.c2 } : { r1: box.r1, r2: box.r2, c1: box.c1 - 1, c2: box.c2 }) : box;
    if (from.r1 < 0 || from.c1 < 0 || (dir === "down" && headings[from.r1])) return;
    const ops: CellOp[] = [];
    if (dir === "down") {
      for (let c = from.c1; c <= from.c2; c++) {
        if (autoStt && c === 0) continue;
        const src = cells[`${from.r1}:${c}`] ?? "";
        for (let r = from.r1 + 1; r <= from.r2; r++) if (!headings[r]) ops.push({ row: r, col: c, value: shiftRefs(src, r - from.r1, 0) });
      }
    } else {
      for (let r = Math.max(0, from.r1); r <= from.r2; r++) {
        if (headings[r]) continue;
        const src = cells[`${r}:${from.c1}`] ?? "";
        for (let c = from.c1 + 1; c <= from.c2; c++) if (!(autoStt && c === 0)) ops.push({ row: r, col: c, value: shiftRefs(src, 0, c - from.c1) });
      }
    }
    if (ops.length) commit(ops);
  }
  // xoá nội dung vùng đang chọn (Delete / Backspace khi đang ở chế độ chọn ô)
  function clearSelection(): boolean {
    if (!box) return false;
    const out: CellOp[] = [];
    for (let r = Math.max(0, box.r1); r <= box.r2; r++) {
      if (headings[r]) continue;
      for (let c = box.c1; c <= box.c2; c++) if (!(autoStt && c === 0)) out.push({ row: r, col: c, value: "" });
    }
    const headerCells: { j: number; col: number }[] = [];
    for (let r = box.r1; r <= Math.min(box.r2, -2); r++) for (let c = box.c1; c <= box.c2; c++) if ((headerRows[-2 - r]?.[c] ?? "") !== "") headerCells.push({ j: -2 - r, col: c });
    commit(out);
    if (headerCells.length) start(async () => { for (const h of headerCells) await gridSetHeaderCellAction(projectId, sheetId, h.j, h.col, ""); });
    return true;
  }

  // ---- Thanh công thức (tên ô + nội dung / công thức của ô đang chọn) ----
  const barCell = box && box.r1 >= 0 ? (anchor.current && anchor.current.r >= 0 && inBox(anchor.current.r, anchor.current.c) ? anchor.current : { r: box.r1, c: box.c1 }) : null;
  const barRaw = barCell ? dispF(cells[`${barCell.r}:${barCell.c}`] ?? "") : "";
  const barEditing = !!(fEdit && barCell && fEdit.r === barCell.r && fEdit.c === barCell.c);
  const [barDraft, setBarDraft] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  function commitBar(next: string | null) {
    if (next !== null && barCell && !(autoStt && barCell.c === 0) && next !== barRaw) saveCell(barCell.r, barCell.c, storeF(next));
    setBarDraft(null);
  }
  function goToAddress(text: string) {
    const m = /^\s*([A-Za-z]{1,2})(\d+)(?::([A-Za-z]{1,2})(\d+))?\s*$/.exec(text);
    setNameDraft(null);
    if (!m) return;
    const col = (s: string) => s.toUpperCase().split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const clampR = (n: number) => Math.max(0, Math.min(rowCount - 1, n - 1 - H));
    const clampC = (n: number) => Math.max(0, Math.min(nCols - 1, n));
    const r1 = clampR(Number(m[2]));
    const c1 = clampC(col(m[1]));
    const r2 = m[4] ? clampR(Number(m[4])) : r1;
    const c2 = m[3] ? clampC(col(m[3])) : c1;
    anchor.current = { r: r1, c: c1 };
    setRange({ r1, c1, r2, c2 });
    document.querySelector(`textarea[data-grid="${r1}:${c1}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // ---- Chèn nguồn liên kết LINK("khoá") vào công thức (BOQ, TH Thiết Bị, ...) ----
  const barRef = useRef<HTMLInputElement | null>(null);
  function insertLink(key: string) {
    const tok = `LINK("${key}")`;
    const ae = document.activeElement;
    if (ae === barRef.current && barRef.current) {
      // đang sửa ở thanh công thức
      const bar = barRef.current;
      const cur = barDraft ?? barRaw;
      const from = cur.startsWith("=") ? bar.selectionStart ?? cur.length : cur.length;
      const to = cur.startsWith("=") ? bar.selectionEnd ?? cur.length : cur.length;
      setBarDraft(cur.startsWith("=") ? cur.slice(0, from) + tok + cur.slice(to) : "=" + tok);
      return;
    }
    let ta: HTMLTextAreaElement | null = isGridCell(ae) ? ae : null;
    if (!ta && barCell) {
      ta = document.querySelector<HTMLTextAreaElement>(`textarea[data-grid="${barCell.r}:${barCell.c}"]`);
      ta?.focus();
    }
    if (!ta) return;
    const { r, c } = cellOf(ta);
    if (editingKey.current !== `${r}:${c}` && !beginEditCell(ta, "end")) return;
    const v = ta.value;
    let next: string;
    let pos: number;
    if (v.startsWith("=")) {
      const from = ta.selectionStart;
      next = v.slice(0, from) + tok + v.slice(ta.selectionEnd);
      pos = from + tok.length;
    } else {
      next = "=" + tok;
      pos = next.length;
    }
    ta.value = next;
    ta.setSelectionRange(pos, pos);
    setFEdit({ r, c, text: next });
    autosize(ta);
    ta.focus();
  }
  const labelOfLink = useMemo(() => new Map(linkOptions.map((o) => [o.value, o])), [linkOptions]);

  // ---- Menu chuột phải ----
  const [menu, setMenu] = useState<null | { x: number; y: number }>(null);

  // ---- Phím tắt và sự kiện sao chép / cắt / dán toàn trang ----
  const isField = (el: Element | null) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
  const isGridCell = (el: Element | null): el is HTMLTextAreaElement => el instanceof HTMLTextAreaElement && el.hasAttribute("data-grid");
  const activeCell = () => (anchor.current && anchor.current.r >= 0 ? anchor.current : box && box.r1 >= 0 ? { r: box.r1, c: box.c1 } : null);
  function moveSelection(dr: number, dc: number, extend: boolean) {
    const cur = extend && box ? { r: anchor.current && anchor.current.r === box.r1 && anchor.current.c === box.c1 ? box.r2 : box.r1, c: anchor.current && anchor.current.c === box.c1 ? box.c2 : box.c1 } : activeCell();
    if (!cur) return;
    let nr = Math.max(0, Math.min(rowCount - 1, cur.r + dr));
    const nc = Math.max(0, Math.min(nCols - 1, cur.c + dc));
    while (headings[nr] && nr + dr >= 0 && nr + dr < rowCount && dr !== 0) nr += dr; // bỏ qua dòng đầu mục
    if (headings[nr]) return;
    if (extend && anchor.current) setRange({ r1: anchor.current.r, c1: anchor.current.c, r2: nr, c2: nc });
    else {
      anchor.current = { r: nr, c: nc };
      setRange({ r1: nr, c1: nc, r2: nr, c2: nc });
    }
    document.querySelector(`textarea[data-grid="${nr}:${nc}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e) => {
    if (colDialog) return;
    const ae = document.activeElement;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    // Ctrl+F / Ctrl+H: tìm & thay thế
    if (mod && (k === "f" || k === "h") && !e.altKey) {
      e.preventDefault();
      setFind((f) => f ?? { text: "", replace: "", idx: 0 });
      return;
    }
    if (isField(ae) && !isGridCell(ae)) return; // đang gõ ở ô khác (tìm kiếm, hộp thoại...)
    // Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
    if (mod && (k === "z" || k === "y")) {
      if (isGridCell(ae)) {
        const key = ae.getAttribute("data-grid") as string;
        if (editingKey.current === key && ae.value !== dispF(cells[key] ?? "")) return; // đang gõ dở trong ô: để trình duyệt hoàn tác chữ
      }
      e.preventDefault();
      if (k === "y" || e.shiftKey) redo();
      else undo();
      return;
    }
    if (isGridCell(ae)) return; // các phím còn lại do chính ô xử lý
    if (!box || box.r1 < 0) return;
    // Ctrl+A: chọn cả bảng
    if (mod && k === "a") {
      e.preventDefault();
      anchor.current = { r: 0, c: 0 };
      setRange({ r1: 0, c1: 0, r2: rowCount - 1, c2: nCols - 1 });
      return;
    }
    if (mod && !e.altKey && !e.defaultPrevented && ["d", "r", "b", "i", "u"].includes(k)) {
      e.preventDefault(); // luôn chặn phím tắt của trình duyệt khi đang thao tác trên bảng
      if (k === "d" || k === "r") fillEdge(k === "d" ? "down" : "right");
      else toggle(k as "b" | "i" | "u");
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      const out: CellOp[] = [];
      for (let r = Math.max(0, box.r1); r <= box.r2; r++) {
        if (headings[r]) continue;
        for (let c = box.c1; c <= box.c2; c++) if (!(autoStt && c === 0)) out.push({ row: r, col: c, value: "" });
      }
      const headerCells: { j: number; col: number }[] = [];
      for (let r = box.r1; r <= Math.min(box.r2, -2); r++) for (let c = box.c1; c <= box.c2; c++) if ((headerRows[-2 - r]?.[c] ?? "") !== "") headerCells.push({ j: -2 - r, col: c });
      if (!out.some((o) => (cells[`${o.row}:${o.col}`] ?? "") !== "") && headerCells.length === 0) return;
      e.preventDefault();
      commit(out);
      if (headerCells.length) start(async () => { for (const h of headerCells) await gridSetHeaderCellAction(projectId, sheetId, h.j, h.col, ""); });
      return;
    }
    if (mod || e.altKey) return;
    // di chuyển ô đang chọn bằng bàn phím (chưa gõ vào ô)
    const dir: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (dir[e.key]) {
      e.preventDefault();
      moveSelection(dir[e.key][0], dir[e.key][1], e.shiftKey);
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (e.key === "Enter") moveSelection(e.shiftKey ? -1 : 1, 0, false);
      else moveSelection(0, e.shiftKey ? -1 : 1, false);
      return;
    }
    const cur = activeCell();
    if (!cur) return;
    if (e.key === "F2") {
      e.preventDefault();
      focusCell(cur.r, cur.c);
      const el = document.querySelector<HTMLTextAreaElement>(`textarea[data-grid="${cur.r}:${cur.c}"]`);
      if (el) beginEditCell(el, "end");
      return;
    }
    // gõ ký tự thường: bắt đầu nhập vào ô đang chọn (thay thế nội dung cũ)
    if (e.key.length === 1 && !(autoStt && cur.c === 0)) {
      focusCell(cur.r, cur.c);
      const el = document.querySelector<HTMLTextAreaElement>(`textarea[data-grid="${cur.r}:${cur.c}"]`);
      if (el) beginEditCell(el, "replace");
    }
  };
  const clipHandlers = useRef<{ copy: (e: ClipboardEvent, cut: boolean) => void; paste: (e: ClipboardEvent) => void }>({ copy: () => {}, paste: () => {} });
  clipHandlers.current = {
    copy: (e, cut) => {
      const ae = document.activeElement;
      if (colDialog || (isField(ae) && !isGridCell(ae)) || !box || box.r1 < 0) return;
      if (isGridCell(ae) && editingKey.current === ae.getAttribute("data-grid") && ae.selectionStart !== ae.selectionEnd) return; // đang sửa và chọn 1 đoạn chữ trong ô: copy chữ
      const tsv = copySelection(cut);
      if (tsv === null) return;
      e.clipboardData?.setData("text/plain", tsv);
      e.preventDefault();
    },
    paste: (e) => {
      const ae = document.activeElement;
      if (colDialog || (isField(ae) && !isGridCell(ae)) || !box || box.r1 < 0) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      const internal = clip.current && clip.current.tsv === text;
      if (isGridCell(ae) && editingKey.current === ae.getAttribute("data-grid") && !internal && !/[\t\n]/.test(text)) return; // đang sửa ô: dán chữ thường vào giữa ô như bình thường
      e.preventDefault();
      pasteFromText(text);
    },
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    const onCopy = (e: ClipboardEvent) => clipHandlers.current.copy(e, false);
    const onCut = (e: ClipboardEvent) => clipHandlers.current.copy(e, true);
    const onPaste = (e: ClipboardEvent) => clipHandlers.current.paste(e);
    document.addEventListener("keydown", onKey);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
    };
  }, []);

  const toggleRow = (r: number, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(r);
      else next.delete(r);
      return next;
    });

  // Ô số dòng ở đầu mỗi dòng (mờ như Excel): bấm để chọn cả dòng
  const rowNumCell = (r: number) => (
    <td
      onClick={() => {
        anchor.current = { r, c: 0 };
        setRange({ r1: r, c1: 0, r2: r, c2: nCols - 1 });
      }}
      title={`Dòng ${r + 1 + H} — bấm để chọn cả dòng`}
      className={`w-9 cursor-pointer whitespace-nowrap border border-slate-200 px-0.5 text-center align-middle text-[10px] font-normal select-none ${box && box.r1 >= 0 && r >= box.r1 && r <= box.r2 ? "bg-blue-100 text-blue-600" : "bg-slate-50 text-slate-400"}`}
    >
      <span style={{ whiteSpace: "nowrap", overflowWrap: "normal" }}>{r + 1 + H}</span>
    </td>
  );
  const btn = "rounded border border-slate-300 px-2 py-1 hover:bg-slate-50";
  const headingLabel = (i: number) => `${"\u00a0\u00a0".repeat(headings[headingRows[i]].level)}${labelOf.get(headings[headingRows[i]].id)}. ${headings[headingRows[i]].title}`;

  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600">
        <button type="button" disabled={pending} onClick={() => start(() => void gridAddRowsAction(projectId, sheetId, 1))} className={btn}>
          + Thêm dòng
        </button>
        <button type="button" disabled={pending} onClick={() => start(() => void gridAddRowsAction(projectId, sheetId, 10))} className={btn}>
          + 10 dòng
        </button>
        <button type="button" disabled={pending || nHeader >= 8} onClick={() => start(() => void gridAddHeaderRowAction(projectId, sheetId))} title="Thêm 1 dòng tiêu đề phía trên (tiêu đề nhiều tầng, VD nhóm cột); gộp ô tiêu đề để dùng chung cho nhiều cột / nhiều dòng" className={btn}>
          + Dòng tiêu đề
        </button>
        <button type="button" disabled={pending || nHeader === 0} onClick={() => start(() => void gridRemoveHeaderRowAction(projectId, sheetId))} title="Bớt dòng tiêu đề phụ trên cùng" className={btn}>
          − Dòng tiêu đề
        </button>
        <label className="flex items-center gap-1 text-slate-700" title="Cột đầu (STT) tự đánh số 1, 2, 3... theo các dòng đã có tên công việc ở cột thứ 2, tự cập nhật khi thêm / xoá dòng; về 1 lại sau mỗi đầu mục">
          <input type="checkbox" disabled={pending || nCols < 2} checked={autoStt} onChange={(e) => start(() => void gridSetAutoSttAction(projectId, sheetId, e.target.checked))} className="h-3.5 w-3.5" />
          STT tự động
        </label>
        <OutlineBar levels={maxLevel} onLevel={(lv) => outline.setAll(collapseToLevel(headList, lv))} onExpandAll={() => outline.setAll([])} />
        <button
          type="button"
          disabled={pending}
          title="Thêm đầu mục lớn ngay TRÊN dòng đang chọn (chưa chọn dòng nào thì thêm xuống cuối bảng)"
          onClick={() => {
            const t = window.prompt("Tên đầu mục lớn mới (VD: CHI PHÍ TẠM, BPTC...):");
            if (t === null) return;
            // chèn ngay trên dòng chứa con trỏ: chèn "sau dòng liền trước nó"; chưa chọn ô nào thì xuống cuối bảng
            const afterRow = box ? Math.max(-1, box.r1 - 1) : rowCount - 1;
            setRange(null);
            start(() => void gridInsertRowAction(projectId, sheetId, afterRow, true, t));
          }}
          className="rounded bg-slate-900 px-2.5 py-1 font-medium text-white hover:bg-slate-800"
        >
          + Bổ Sung Đầu Mục Lớn
        </button>
        <span className="text-slate-300">|</span>
        <span>Đã chọn {selected.size} dòng</span>
        <button
          type="button"
          disabled={selected.size === 0 || pending}
          onClick={async () => {
            if (!await confirmNear(`⚠ Bạn có chắc chắn muốn XOÁ ${selected.size} dòng đã chọn không?\n\nThao tác này không hoàn tác được.`)) return;
            start(async () => {
              await gridDeleteRowsAction(projectId, sheetId, [...selected]);
              setSelected(new Set());
            });
          }}
          className="rounded bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Xoá các dòng đã chọn
        </button>
        <button
          type="button"
          disabled={selected.size === 0 || pending}
          title="Chuyển các dòng đã chọn thành đầu mục lớn (tên lấy theo cột Nội dung; chuyển lại được)"
          onClick={() =>
            start(async () => {
              await gridSetRowsHeadingAction(projectId, sheetId, [...selected], true);
              setSelected(new Set());
            })
          }
          className="rounded border border-amber-400 bg-amber-100 px-2.5 py-1 font-medium text-amber-900 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Chuyển thành đầu mục
        </button>
        <span className="text-slate-300">|</span>
        <label className="flex items-center gap-1">
          Cột &quot;Thành tiền&quot;:
          <select
            value={amountCol === null ? "" : String(amountCol)}
            onChange={(e) => start(() => void gridSetAmountColAction(projectId, sheetId, e.target.value === "" ? null : Number(e.target.value)))}
            className="rounded border border-slate-300 bg-white px-1.5 py-1"
          >
            <option value="">— chưa chọn —</option>
            {colTitles.map((t, i) => (
              <option key={i} value={i}>
                {colLetter(i)} — {t || `Cột ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1" title="Đưa các dòng của sheet vào sheet CHI TIẾT, thành tiền nằm ở cột chi phí này">
          Đưa vào CHI TIẾT ở cột:
          <select
            value={linkCol ?? ""}
            disabled={amountCol === null}
            onChange={(e) => start(() => void gridSetLinkColAction(projectId, sheetId, e.target.value === "" ? null : e.target.value))}
            className="rounded border border-slate-300 bg-white px-1.5 py-1 disabled:opacity-50"
          >
            <option value="">— không đưa —</option>
            {LINK_COLS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <GridFormatBar
        selectionLabel={
          box
            ? box.r1 < 0
              ? `Tiêu đề ${colLetter(box.c1)}${multi ? `:${colLetter(box.c2)}` : ""}`
              : `${colLetter(box.c1)}${box.r1 + 1 + H}${multi ? `:${colLetter(box.c2)}${box.r2 + 1 + H}` : ""}`
            : ""
        }
        onWholeColumn={() => {
          if (!box) return;
          anchor.current = { r: 0, c: box.c1 };
          setRange({ r1: 0, c1: box.c1, r2: rowCount - 1, c2: box.c2 });
        }}
        hasSelection={!!box && box.r1 >= 0}
        active={active}
        painterArmed={!!painter}
        onToggle={toggle}
        onAlign={(a) => applyStyles((st) => ({ ...st, align: a }))}
        onColor={(kind, c) => applyStyles((st) => ({ ...st, [kind]: c ?? undefined }))}
        onPct={() => applyStyles((st) => ({ ...st, pct: st.pct ? undefined : true }))}
        onSep={() => applyStyles((st) => ({ ...st, sep: active.sep === true ? undefined : true }))}
        onDecimals={changeDecimals}
        onPainter={armPainter}
        onClear={() => applyStyles(() => ({}))}
        canUndo={undoStack.current.length > 0}
        canRedo={redoStack.current.length > 0}
        onUndo={undo}
        onRedo={redo}
        onFontSize={(n) => applyStyles((st) => ({ ...st, fs: n ?? undefined }))}
        onBorder={(m) => applyStyles((st) => ({ ...st, bd: m ?? undefined }))}
        onFind={() => setFind((f) => f ?? { text: "", replace: "", idx: 0 })}
        canMerge={!!box && multi && (box.r1 === -1 ? box.r2 === -1 : !(() => { for (let r = box.r1; r <= box.r2; r++) if (headings[r]) return true; return false; })())}
        canUnmerge={!!box && merges.some((m) => mergesIntersect(m, { r1: box.r1, r2: box.r2, c1: box.c1, c2: box.c2 }))}
        onMerge={async () => {
          if (!box) return;
          const hasValues: string[] = [];
          for (let r = Math.max(0, box.r1); r <= box.r2; r++) for (let c = box.c1; c <= box.c2; c++) if ((r !== box.r1 || c !== box.c1) && (cells[`${r}:${c}`] ?? "").trim() !== "") hasValues.push(`${colLetter(c)}${r + 1}`);
          if (hasValues.length > 0 && !await confirmNear(`Gộp ô chỉ giữ nội dung của ô trên-trái; nội dung ở ${hasValues.length} ô khác sẽ bị xoá. Tiếp tục?`)) return;
          const target = { ...box };
          start(async () => {
            try {
              await gridMergeAction(projectId, sheetId, target);
            } catch (e) {
              window.alert(e instanceof Error ? e.message : "Không gộp được ô");
            }
          });
        }}
        onUnmerge={() => box && start(() => void gridUnmergeAction(projectId, sheetId, { ...box }))}
      />
      <div className="mb-2 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm">
        <input
          value={nameDraft ?? (box ? (box.r1 < 0 ? `Tiêu đề ${colLetter(box.c1)}` : `${colLetter(box.c1)}${box.r1 + 1 + H}${multi ? `:${colLetter(box.c2)}${box.r2 + 1 + H}` : ""}`) : "")}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setNameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") goToAddress(e.currentTarget.value);
            else if (e.key === "Escape") setNameDraft(null);
          }}
          onBlur={() => setNameDraft(null)}
          title="Tên ô đang chọn — gõ địa chỉ (VD G10 hoặc D5:F8) rồi Enter để đến ô đó"
          className="w-28 rounded border border-slate-300 bg-slate-50 px-2 py-1 text-center text-[13px] font-medium text-slate-700"
        />
        <span className="select-none px-1 text-[13px] italic text-slate-400" title="Công thức / nội dung của ô">
          fx
        </span>
        <input
          ref={barRef}
          value={barEditing ? (fEdit as { text: string }).text : (barDraft ?? barRaw)}
          readOnly={barEditing || !barCell || (autoStt && barCell.c === 0)}
          placeholder={barCell ? "" : "Bấm vào một ô để xem nội dung / công thức"}
          onFocus={() => setBarDraft(barRaw)}
          onChange={(e) => setBarDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitBar(barDraft);
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setBarDraft(null);
              e.currentTarget.blur();
            }
          }}
          onBlur={() => commitBar(barDraft)}
          title="Thanh công thức: xem và sửa nội dung ô đang chọn (hoặc nhấn F2 để sửa ngay trong ô)"
          className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 font-mono text-[13px] text-slate-800 read-only:bg-slate-50"
        />
        <LinkPicker options={linkOptions} values={linkValues} onPick={insertLink} />
      </div>
      {(() => {
        const text = barEditing ? (fEdit as { text: string }).text : (barDraft ?? barRaw);
        const keys = [...new Set(linkKeysOf(text))];
        if (!keys.length) return null;
        return (
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-0.5 rounded-md border border-blue-100 bg-blue-50/50 px-3 py-1 text-[11px] text-slate-600">
            {keys.map((k) => (
              <span key={k}>
                <b className="font-mono text-blue-700">{`LINK("${k.length > 14 ? k.slice(0, 14) + "…" : k}")`}</b> = {labelOfLink.get(k)?.label ?? "(nguồn không tồn tại)"}:{" "}
                <span className="font-mono">{k in linkValues ? Math.round(linkValues[k]).toLocaleString("vi-VN") : "#NAME?"}</span>
              </span>
            ))}
          </div>
        );
      })()}
      {find && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-slate-700">
          <input
            autoFocus
            value={find.text}
            placeholder="Tìm…"
            onChange={(e) => setFind({ ...find, text: e.target.value, idx: 0 })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                goToMatch(find.idx + (e.shiftKey ? -1 : 1));
              } else if (e.key === "Escape") setFind(null);
            }}
            className="w-48 rounded border border-slate-300 px-2 py-1"
          />
          <input value={find.replace} placeholder="Thay bằng…" onChange={(e) => setFind({ ...find, replace: e.target.value })} className="w-48 rounded border border-slate-300 px-2 py-1" />
          <button type="button" onClick={() => goToMatch(find.idx + 1)} className={btn}>
            Tìm tiếp
          </button>
          <button type="button" onClick={() => goToMatch(find.idx - 1)} className={btn}>
            Tìm trước
          </button>
          <button type="button" disabled={findMatches.length === 0} onClick={replaceOne} className={btn}>
            Thay
          </button>
          <button type="button" disabled={findMatches.length === 0} onClick={replaceAll} className={btn}>
            Thay tất cả
          </button>
          <span className="text-slate-500">{find.text === "" ? "" : `${findMatches.length === 0 ? 0 : Math.min(find.idx, findMatches.length - 1) + 1}/${findMatches.length} kết quả`}</span>
          <button type="button" onClick={() => setFind(null)} className="ml-auto rounded px-2 py-1 text-slate-500 hover:bg-white" title="Đóng (Esc)">
            ✕
          </button>
        </div>
      )}

      <TableResize tableId={`rz-grid-${sheetId}`} storageKey={`grid-${sheetId}`} />
      <ScrollTable>
        <table id={`rz-grid-${sheetId}`} className="w-full border-collapse text-[13px] leading-5" onDragStart={(e) => e.preventDefault()}>
          <thead className="bg-green-100 text-center text-slate-900">
            <tr>
              <th className="w-9 border border-slate-200 bg-slate-50" />
              <th rowSpan={nHeader + 2} className="w-8 border border-slate-400 px-1" />
              {colTitles.map((_, c) => (
                <th
                  key={`L${c}`}
                  className={`border border-slate-200 py-0 text-[10px] font-normal select-none ${box && box.r1 >= 0 && c >= box.c1 && c <= box.c2 ? "bg-blue-100 text-blue-600" : "bg-slate-50 text-slate-400"}`}
                >
                  <button
                    type="button"
                    title={`Cột ${colLetter(c)} — bấm để chọn cả cột`}
                    onClick={() => {
                      anchor.current = { r: 0, c };
                      setRange({ r1: 0, c1: c, r2: rowCount - 1, c2: c });
                    }}
                    className="block w-full px-1 hover:bg-slate-100"
                  >
                    {colLetter(c)}
                  </button>
                </th>
              ))}
              <th rowSpan={nHeader + 2} className="w-20 border border-slate-400 px-1 font-medium">{themHead}</th>
              <th rowSpan={nHeader + 2} className="w-44 border border-slate-400 px-1 font-medium">Chuyển Tới</th>
            </tr>
            {Array.from({ length: nHeader }, (_, k) => nHeader - 1 - k).map((j) => {
              const hr = -2 - j; // chỉ số dòng của dòng tiêu đề phụ này
              return (
                <tr key={`hr${j}`}>
                  <th className={numTh}>{nHeader - j}</th>
                  {colTitles.map((_, c) => {
                    if (covered.has(`${hr}:${c}`)) return null;
                    const hm = masters.get(`${hr}:${c}`);
                    const text = headerRows[j]?.[c] ?? "";
                    return (
                      <th
                        key={c}
                        colSpan={hm ? hm.c2 - hm.c1 + 1 : undefined}
                        rowSpan={hm ? hm.r2 - hm.r1 + 1 : undefined}
                        className={`min-w-28 border border-slate-400 px-1 py-1 font-medium ${multi && inBox(hr, c) ? "shadow-[inset_0_0_0_1000px_rgba(59,130,246,0.2)]" : ""}`}
                        onMouseDown={(e) => headerDown(e, hr, c)}
                        onMouseEnter={() => headerEnter(hr, c)}
                      >
                        <GrowText
                          key={text}
                          value={text}
                          placeholder="Tiêu đề"
                          onCommit={(v) => start(() => void gridSetHeaderCellAction(projectId, sheetId, j, c, v))}
                          className="block w-full rounded border border-transparent bg-transparent px-1 text-center font-semibold placeholder:font-normal placeholder:text-slate-400 hover:border-slate-400 focus:bg-white"
                        />
                      </th>
                    );
                  })}
                </tr>
              );
            })}
            <tr>
              <th className={numTh}>{nHeader + 1}</th>
              {colTitles.map((t, c) => {
                if (covered.has(`-1:${c}`)) return null; // tiêu đề bị che bởi ô gộp
                const hm = masters.get(`-1:${c}`);
                return (
                <th
                  key={c}
                  colSpan={hm ? hm.c2 - hm.c1 + 1 : undefined}
                  className={`min-w-28 border border-slate-400 px-1 py-1 font-medium ${multi && inBox(-1, c) ? "shadow-[inset_0_0_0_1000px_rgba(59,130,246,0.2)]" : ""}`}
                  onMouseDown={(e) => headerDown(e, -1, c)}
                  onMouseEnter={() => headerEnter(-1, c)}
                >
                  <GrowText
                    key={t}
                    value={t}
                    title={`Cột ${colLetter(c)} (tên cột dùng trong công thức)`}
                    onCommit={(v) => start(() => void gridRenameColAction(projectId, sheetId, c, v))}
                    className={`block w-full rounded border border-transparent bg-transparent px-1 text-center font-semibold hover:border-slate-400 focus:bg-white ${amountCol === c ? "text-red-600" : ""}`}
                  />
                </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_, r) => {
              if (hiddenRows[r]) return null;
              const h = headings[r];
              const rowCtl = (
                <td className="border border-slate-200 px-1 text-center">
                  <select
                    value=""
                    disabled={pending}
                    title="Thêm dòng / đầu mục ngay bên dưới"
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      if (v === "toHeading" || v === "toRow") {
                        start(() => void gridSetRowsHeadingAction(projectId, sheetId, [r], v === "toHeading"));
                        return;
                      }
                      if (h && (v === "indent" || v === "outdent")) {
                        start(() => void gridSetHeadingLevelAction(projectId, sheetId, h.id, h.level + (v === "indent" ? 1 : -1)));
                        return;
                      }
                      start(() => void gridInsertRowAction(projectId, sheetId, r, v === "heading", v === "heading" ? "Đầu mục mới" : ""));
                    }}
                    className="h-5 w-14 cursor-pointer rounded border border-slate-300 bg-white px-1 py-0 text-[11px]"
                  >
                    <option value="">＋</option>
                    <option value="row">Thêm dòng bên dưới</option>
                    <option value="heading">Thêm đầu mục bên dưới</option>
                    {h && <option value="indent">▶ Thụt vào 1 cấp (thành mục con)</option>}
                    {h && <option value="outdent">◀ Ra 1 cấp (lên mục cha)</option>}
                    {h ? <option value="toRow">⇩ Chuyển đầu mục này về dòng thường</option> : <option value="toHeading">⇧ Chuyển dòng này thành đầu mục lớn</option>}
                  </select>
                </td>
              );
              if (h) {
                const hi = headingRows.indexOf(r);
                const hlevel = h.level;
                const hclass = ["bg-amber-200", "bg-amber-100", "bg-yellow-100", "bg-yellow-50"][Math.min(hlevel, 3)];
                const titleSpan = amountCol === null ? nCols : amountCol;
                // Số La Mã của đầu mục nằm ở cột đầu (STT), tên đầu mục nằm từ cột thứ 2 (NỘI DUNG CÔNG VIỆC)
                const numeral = labelOf.get(h.id) ?? String(hi + 1);
                // số thứ tự tự đánh theo cấp nhưng gõ đè được (xoá trắng = quay lại tự đánh)
                const sttInput = (
                  <input
                    key={numeral}
                    defaultValue={numeral}
                    title="Số thứ tự đầu mục (gõ để đổi, xoá trắng = tự đánh số theo cấp)"
                    onBlur={(e) => e.currentTarget.value !== numeral && start(() => void gridSetHeadingSttAction(projectId, sheetId, h.id, e.currentTarget.value))}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    className="w-full min-w-6 rounded border border-transparent bg-transparent px-0.5 text-center font-bold hover:border-slate-500 focus:bg-white"
                  />
                );
                const titleInput = (
                  <GrowText
                    key={h.title}
                    value={h.title}
                    onCommit={(v) => start(() => void gridRenameHeadingAction(projectId, sheetId, h.id, v))}
                    className="block w-full rounded border border-transparent bg-transparent px-1 font-bold uppercase hover:border-slate-500 focus:bg-white"
                  />
                );
                return (
                  <tr key={r} className={`${hclass} font-bold text-slate-900`}>
                    {rowNumCell(r)}
                    <td className="border border-slate-300 px-1 text-center">
                      <input type="checkbox" checked={selected.has(r)} onChange={(e) => toggleRow(r, e.target.checked)} className="h-3.5 w-3.5 cursor-pointer" />
                    </td>
                    {titleSpan >= 2 ? (
                      <>
                        <td className="border border-slate-300 px-0.5 text-center">
                          <div className="flex items-center">
                            <OutlineToggle open={!outline.collapsed.has(h.id)} onClick={() => outline.toggle(h.id)} />
                            {sttInput}
                          </div>
                        </td>
                        <td className="border border-slate-300 px-1" colSpan={titleSpan - 1} style={{ paddingLeft: 4 + hlevel * 18 }}>
                          {titleInput}
                        </td>
                      </>
                    ) : (
                      titleSpan > 0 && (
                        <td className="border border-slate-300 px-1" colSpan={titleSpan}>
                          <div className="flex items-center gap-1">
                            <OutlineToggle open={!outline.collapsed.has(h.id)} onClick={() => outline.toggle(h.id)} />
                            <span style={{ marginLeft: hlevel * 14 }}>{numeral}.</span>
                            {titleInput}
                          </div>
                        </td>
                      )
                    )}
                    {amountCol !== null && (
                      <td className="border border-slate-300 px-2 text-right">
                        <span style={{ whiteSpace: "nowrap", overflowWrap: "normal" }}>{fmtMoney(subtotal(r))}</span>
                      </td>
                    )}
                    {amountCol !== null &&
                      Array.from({ length: nCols - amountCol - 1 }, (_, i) => amountCol + 1 + i).map((c) => (
                        <td key={c} className="border border-slate-300 px-2 text-right">
                          {extraAmountCols.includes(c) && <span style={{ whiteSpace: "nowrap", overflowWrap: "normal" }}>{fmtMoney(subtotal(r, c))}</span>}
                        </td>
                      ))}
                    {rowCtl}
                    <td className="border border-slate-300 px-1 text-center">
                      {amountCol !== null && (
                        <button
                            type="button"
                            onClick={() => start(() => void setGridHeadingShowInDtcpAction(projectId, sheetId, h.id, !h.showInDtcp))}
                            title='Bật: đầu mục này hiện thành 1 dòng riêng ở sheet DT-CP (mặc định vào "CHI PHÍ TRỰC TIẾP", kéo thả để xếp vào đúng chỗ). Tắt: xoá dòng đó khỏi DT-CP.'
                            className={`shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium normal-case ${
                              h.showInDtcp ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "bg-slate-200 text-slate-500 hover:bg-slate-300"
                            }`}
                          >
                            Thể hiện qua DT-CP
                          </button>
                      )}
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={r} className={selected.has(r) ? "bg-amber-50" : ""}>
                  {rowNumCell(r)}
                  <td className="border border-slate-200 px-1 text-center">
                    <input type="checkbox" checked={selected.has(r)} onChange={(e) => toggleRow(r, e.target.checked)} className="h-3.5 w-3.5 cursor-pointer" />
                  </td>
                  {colTitles.map((_, c) => {
                    if (covered.has(`${r}:${c}`)) return null;
                    const mg = masters.get(`${r}:${c}`);
                    const raw = cells[`${r}:${c}`] ?? "";
                    const v = ev.valueOf(r, c);
                    const isFormula = raw.trim().startsWith("=");
                    const st = styleOf(r, c);
                    const styled = isNumberValue(v) ? formatStyledNumber(v, st, isFormula ? 0 : undefined) : null;
                    const shown = styled ?? (isFormula ? fmtDefault(v) : typedNumber(raw));
                    const isErr = isFormula && typeof v === "string" && v.startsWith("#");
                    const editHere = !!fEdit && fEdit.r === r && fEdit.c === c;
                    const editFormula = editHere && fEdit.text.startsWith("=");
                    return (
                      <td
                        key={c}
                        rowSpan={mg ? mg.r2 - mg.r1 + 1 : undefined}
                        colSpan={mg ? mg.c2 - mg.c1 + 1 : undefined}
                        className={`relative border border-slate-200 p-0 ${multi && inBox(r, c) ? "shadow-[inset_0_0_0_1000px_rgba(59,130,246,0.15)]" : fillPreview && !inBox(r, c) && r >= fillPreview.r1 && r <= fillPreview.r2 && c >= fillPreview.c1 && c <= fillPreview.c2 ? "shadow-[inset_0_0_0_1000px_rgba(34,197,94,0.2)]" : ""} ${!multi && inBox(r, c) ? "outline outline-2 -outline-offset-2 outline-blue-500" : ""}`}
                        style={{
                          ...(st.bg ? { backgroundColor: st.bg } : {}),
                          ...(st.bd === "all" ? { border: "1px solid #0f172a" } : st.bd === "none" ? { border: "1px solid transparent" } : {}),
                          ...refStyleOf(r, c),
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (!inBox(r, c)) {
                            anchor.current = { r, c };
                            setRange({ r1: r, c1: c, r2: r, c2: c });
                          }
                          setMenu({ x: e.clientX, y: e.clientY });
                        }}
                        onMouseDown={(e) => {
                          if (pointWithMouse(e, r, c)) return;
                          // Shift+bấm sang ô KHÁC: chọn vùng nhiều ô; Shift+bấm trong chính ô đang sửa: bôi đen chữ như bình thường
                          if (e.shiftKey && anchor.current && anchor.current.r >= 0 && !(anchor.current.r === r && anchor.current.c === c)) {
                            e.preventDefault();
                            setRange({ r1: anchor.current.r, c1: anchor.current.c, r2: r, c2: c });
                            return;
                          }
                          anchor.current = { r, c };
                          dragging.current = true;
                          focusByMouse.current = true;
                          setRange((prev) => (prev && prev.r1 === r && prev.c1 === c && prev.r2 === r && prev.c2 === c ? prev : { r1: r, c1: c, r2: r, c2: c }));
                        }}
                        onMouseEnter={() => {
                          if (refDragging.current && refMode.current) {
                            const ae = document.activeElement;
                            if (isGridCell(ae)) putRef(ae, { r, c }, refMode.current.anchor);
                            return;
                          }
                          if (fillDrag.current) {
                            updateFillPreview(r, c);
                            return;
                          }
                          if (!dragging.current || !anchor.current || anchor.current.r < 0 || (anchor.current.r === r && anchor.current.c === c)) return;
                          if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur();
                          window.getSelection()?.removeAllRanges();
                          const next = { r1: anchor.current.r, c1: anchor.current.c, r2: r, c2: c };
                          setRange((prev) => (prev && prev.r1 === next.r1 && prev.c1 === next.c1 && prev.r2 === next.r2 && prev.c2 === next.c2 ? prev : next));
                        }}
                      >
                        {editFormula && <div aria-hidden style={{ height: st.fs ? Math.round(st.fs * 1.5) + 4 : 24 }} />}
                        {editFormula && (
                          <div
                            aria-hidden
                            className="pointer-events-none absolute left-0 top-0 overflow-hidden px-1.5 py-0.5 leading-5"
                            style={{
                              width: editW ?? undefined,
                              minWidth: "100%",
                              minHeight: "100%",
                              background: st.bg ?? "#ffffff",
                              zIndex: 25,
                              whiteSpace: "pre",
                              textAlign: "left",
                              fontSize: st.fs ? `${st.fs}px` : undefined,
                              lineHeight: st.fs ? `${Math.round(st.fs * 1.5)}px` : undefined,
                              fontWeight: st.b ? 700 : undefined,
                              fontStyle: st.i ? "italic" : undefined,
                              color: "#111827",
                            }}
                          >
                            {(() => {
                              const parts: React.ReactNode[] = [];
                              let pos = 0;
                              formulaRefs(fEdit.text).forEach((x, i) => {
                                if (x.start > pos) parts.push(fEdit.text.slice(pos, x.start));
                                parts.push(
                                  <span key={i} style={{ color: REF_COLORS[i % REF_COLORS.length], fontWeight: 600 }}>
                                    {fEdit.text.slice(x.start, x.end)}
                                  </span>
                                );
                                pos = x.end;
                              });
                              if (pos < fEdit.text.length) parts.push(fEdit.text.slice(pos));
                              return parts;
                            })()}
                          </div>
                        )}
                        <textarea
                          rows={1}
                          ref={autosize}
                          readOnly
                          onInput={(e) => {
                            if (editingKey.current === `${r}:${c}`) groupWhileTyping(e.currentTarget);
                            autosize(e.currentTarget);
                            setFEdit({ r, c, text: e.currentTarget.value });
                          }}
                          key={`${raw}|${shown}|${H}`}
                          data-grid={`${r}:${c}`}
                          defaultValue={shown}
                          title={isFormula ? dispF(raw) : undefined}
                          onFocus={(e) => {
                            // Chọn ô (chưa sửa): ô chỉ hiện giá trị, công thức xem ở thanh công thức. F2 / gõ chữ / bấm đúp để sửa.
                            autosize(e.currentTarget);
                            anchor.current = { r, c };
                            setRange((prev) => (prev && prev.r1 === r && prev.c1 === c && prev.r2 === r && prev.c2 === c ? prev : { r1: r, c1: c, r2: r, c2: c }));
                          }}
                          onDoubleClick={(e) => {
                            if (editingKey.current !== `${r}:${c}`) beginEditCell(e.currentTarget, "end");
                          }}
                          onBlur={(e) => {
                            clearRef();
                            setFEdit(null);
                            const el = e.currentTarget;
                            const wasEditing = editingKey.current === `${r}:${c}`;
                            editingKey.current = null;
                            el.readOnly = true;
                            if (wasEditing && el.value !== dispF(raw)) saveCell(r, c, storeF(plainThousands(el.value)));
                            else el.value = shown;
                            requestAnimationFrame(() => autosize(el)); // đo lại SAU khi ô trở về kiểu bình thường (không để chiều cao của lúc đang sửa làm dòng cao thừa)
                          }}
                          onKeyDown={(e) => {
                            const el = e.currentTarget;
                            const editing = editingKey.current === `${r}:${c}`;
                            const mod = e.ctrlKey || e.metaKey;
                            const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
                            const goTo = (nr: number, nc: number) => {
                              el.blur();
                              setTimeout(() => nr >= 0 && nc >= 0 && focusCell(nr, nc), 0);
                            };
                            if (!editing) {
                              // ---- Chế độ chọn ô (như Excel): mũi tên di chuyển ô, F2 / gõ chữ để sửa ----
                              if (arrows[e.key] && !mod && !e.altKey) {
                                e.preventDefault();
                                const [dr, dc] = arrows[e.key];
                                if (e.shiftKey) moveSelection(dr, dc, true);
                                else goTo(dr > 0 ? (mg ? mg.r2 : r) + 1 : r + dr, dc > 0 ? (mg ? mg.c2 : c) + 1 : c + dc);
                                return;
                              }
                              if (e.key === "F2") {
                                e.preventDefault();
                                beginEditCell(el, "end");
                                return;
                              }
                              if (e.key === "Enter" && !e.altKey) {
                                e.preventDefault();
                                goTo(e.shiftKey ? r - 1 : (mg ? mg.r2 : r) + 1, c);
                                return;
                              }
                              if (e.key === "Delete" || e.key === "Backspace") {
                                e.preventDefault();
                                clearSelection();
                                return;
                              }
                              if (mod && ["b", "i", "u"].includes(e.key.toLowerCase())) {
                                e.preventDefault();
                                toggle(e.key.toLowerCase() as "b" | "i" | "u");
                                return;
                              }
                              if (mod && !e.altKey && ["d", "r"].includes(e.key.toLowerCase())) {
                                // Ctrl+D / Ctrl+R: điền xuống / sang phải (tham chiếu tương đối tự dời) — chặn phím tắt của trình duyệt (đánh dấu trang, tải lại)
                                e.preventDefault();
                                fillEdge(e.key.toLowerCase() === "d" ? "down" : "right");
                                return;
                              }
                              if (e.key.length === 1 && !mod && !e.altKey) {
                                // gõ ký tự: bắt đầu nhập, thay thế nội dung cũ của ô (ký tự vừa gõ được trình duyệt đưa vào ô ngay sau đó)
                                if (!beginEditCell(el, "replace")) e.preventDefault();
                              }
                              return;
                            }
                            // ---- Đang sửa nội dung ô ----
                            if (mod && !e.altKey && ["d", "r", "b", "i", "u"].includes(e.key.toLowerCase())) {
                              e.preventDefault(); // không để trình duyệt đánh dấu trang / tải lại / xem nguồn
                              return;
                            }
                            if (arrows[e.key] && !mod && !e.altKey && pointWithArrow(el, arrows[e.key][0], arrows[e.key][1], e.shiftKey)) {
                              e.preventDefault(); // đang lập công thức: mũi tên chỉ ô cần tham chiếu
                              return;
                            }
                            if (!arrows[e.key] && !["Shift", "Control", "Alt", "Meta"].includes(e.key)) clearRef();
                            if (mod && ["b", "i", "u"].includes(e.key.toLowerCase())) {
                              e.preventDefault();
                              toggle(e.key.toLowerCase() as "b" | "i" | "u");
                            } else if (e.key === "Enter" && e.altKey) {
                              // Alt+Enter: xuống dòng trong ô (Shift+Enter cũng được)
                              e.preventDefault();
                              el.setRangeText("\n", el.selectionStart, el.selectionEnd, "end");
                              autosize(el);
                              setFEdit({ r, c, text: el.value });
                            } else if (e.key === "Enter" && e.shiftKey) {
                              e.preventDefault(); // Shift+Enter: lưu và lên ô trên (như Excel)
                              goTo(r - 1, c);
                            } else if (e.key === "Escape") {
                              // Esc: bỏ phần đang sửa dở, giữ nội dung cũ
                              el.value = dispF(raw);
                              el.blur();
                            } else if (e.key === "Enter" || (e.key === "ArrowDown" && el.selectionEnd === el.value.length)) {
                              e.preventDefault();
                              goTo((mg ? mg.r2 : r) + 1, c);
                            } else if (e.key === "ArrowUp" && el.selectionStart === 0) {
                              e.preventDefault();
                              goTo(r - 1, c);
                            } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.shiftKey && !mod && !e.altKey && el.selectionStart === el.selectionEnd && (e.key === "ArrowLeft" ? el.selectionStart === 0 : el.selectionEnd === el.value.length)) {
                              e.preventDefault(); // con trỏ đã ở đầu / cuối nội dung: sang ô bên cạnh
                              goTo(r, e.key === "ArrowLeft" ? c - 1 : (mg ? mg.c2 : c) + 1);
                            }
                          }}
                          style={{
                            fontWeight: st.b ? 700 : undefined,
                            fontStyle: st.i ? "italic" : undefined,
                            textDecoration: st.u ? "underline" : undefined,
                            // mặc định mọi ô canh giữa cho đồng đều; cần khác thì dùng nút căn lề trên thanh định dạng
                            textAlign: editFormula ? "left" : (st.align ?? "center"),
                            color: editFormula ? "transparent" : st.color,
                            caretColor: editHere ? "#0f172a" : "transparent",
                            cursor: editHere ? "text" : "cell",
                            ...(editFormula
                              ? {
                                  // ô sửa công thức: nổi lên, 1 dòng, viền xanh lá như Excel, rộng ra theo độ dài công thức
                                  position: "absolute" as const,
                                  left: 0,
                                  top: 0,
                                  width: editW ?? undefined,
                                  minWidth: "100%",
                                  minHeight: "100%",
                                  whiteSpace: "pre" as const,
                                  zIndex: 30,
                                  backgroundColor: "transparent",
                                  boxShadow: "0 0 0 2px #1a7f37",
                                }
                              : {}),
                            fontSize: st.fs ? `${st.fs}px` : undefined,
                            lineHeight: st.fs ? `${Math.round(st.fs * 1.5)}px` : undefined,
                          }}
                          className={`block w-full resize-none overflow-hidden whitespace-pre-wrap break-words border-0 bg-transparent px-1.5 py-0.5 leading-5 focus:bg-blue-50/60 focus:outline-none focus:ring-1 focus:ring-blue-400 ${amountCol === c ? "font-medium" : ""} ${isErr ? "text-red-600" : isFormula ? "text-violet-800" : ""}`}
                        />
                        {box && box.r1 >= 0 && r === box.r2 && c === box.c2 && !(autoStt && box.c1 === 0 && box.c2 === 0) && (
                          <span
                            title="Kéo xuống / sang phải để điền tiếp (dãy số, công thức, chữ)"
                            onMouseDown={startFill}
                            className="absolute -bottom-[3px] -right-[3px] z-20 h-2 w-2 cursor-crosshair border border-white bg-blue-600"
                          />
                        )}
                      </td>
                    );
                  })}
                  {rowCtl}
                  <td className="border border-slate-200 px-1">
                    <select
                      value={groupOf(r) ?? ""}
                      disabled={pending}
                      title="Chuyển dòng này sang đầu mục khác"
                      onChange={(e) => start(() => void gridMoveRowAction(projectId, sheetId, r, e.target.value === "" ? null : e.target.value))}
                      className="w-full rounded border border-slate-300 bg-white px-1 py-0 text-[11px]"
                    >
                      <option value="">— chưa thuộc đầu mục —</option>
                      {headingRows.map((hr, i) => (
                        <option key={headings[hr].id} value={headings[hr].id}>
                          {headingLabel(i)}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {amountCol !== null && (
            <tfoot>
              <tr className="bg-slate-100 font-semibold text-slate-900">
                <td className="border border-slate-200" />
                <td className="border border-slate-200" />
                {amountCol > 0 && (
                  <td className="border border-slate-200 px-2 py-1" colSpan={amountCol}>
                    Tổng cộng cột &quot;{colTitles[amountCol]}&quot;
                  </td>
                )}
                <td className="border border-slate-200 px-2 py-1 text-right">{fmtMoney(total)}</td>
                {Array.from({ length: nCols - amountCol - 1 }, (_, i) => amountCol + 1 + i).map((c) => (
                  <td key={c} className="border border-slate-200 px-2 py-1 text-right">
                    {extraAmountCols.includes(c) ? fmtMoney(Array.from({ length: rowCount }, (_, r) => amountOf(r, c)).reduce((s, v) => s + v, 0)) : ""}
                  </td>
                ))}
                <td className="border border-slate-200" colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </ScrollTable>
      {menu && (
        <div className="fixed inset-0 z-50" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
          <div className="absolute w-56 rounded-md border border-slate-200 bg-white py-1 text-sm shadow-xl" style={{ left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 320) }} onClick={(e) => e.stopPropagation()}>
            {(() => {
              const item = (label: string, onClick: () => void, opts: { disabled?: boolean; danger?: boolean } = {}) => (
                <button
                  type="button"
                  disabled={opts.disabled}
                  onClick={() => {
                    setMenu(null);
                    onClick();
                  }}
                  className={`block w-full px-3 py-1.5 text-left hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 ${opts.danger ? "text-red-600" : ""}`}
                >
                  {label}
                </button>
              );
              const sep = <div className="my-1 border-t border-slate-100" />;
              const r0 = box ? Math.max(0, box.r1) : 0;
              const r1 = box ? box.r2 : 0;
              return (
                <>
                  {item("Cắt            Ctrl+X", () => {
                    const t = copySelection(true);
                    if (t !== null) void navigator.clipboard?.writeText(t);
                  })}
                  {item("Sao chép   Ctrl+C", () => {
                    const t = copySelection(false);
                    if (t !== null) void navigator.clipboard?.writeText(t);
                  })}
                  {item("Dán           Ctrl+V", () => {
                    void navigator.clipboard?.readText().then((t) => pasteFromText(t)).catch(() => window.alert("Trình duyệt chưa cho phép đọc bộ nhớ tạm, hãy dùng Ctrl+V."));
                  })}
                  {item("Xoá nội dung", () => {
                    if (!box) return;
                    const out: CellOp[] = [];
                    for (let r = Math.max(0, box.r1); r <= box.r2; r++) if (!headings[r]) for (let c = box.c1; c <= box.c2; c++) if (!(autoStt && c === 0)) out.push({ row: r, col: c, value: "" });
                    commit(out);
                  })}
                  {item("Xoá định dạng", () => applyStyles(() => ({})))}
                  {sep}
                  {item("Gộp ô", () => document.querySelector<HTMLButtonElement>('button[title^="Gộp các ô"]')?.click(), { disabled: !(box && multi) })}
                  {item("Tách ô", () => document.querySelector<HTMLButtonElement>('button[title^="Tách ô gộp"]')?.click(), { disabled: !(box && merges.some((m) => mergesIntersect(m, { r1: box.r1, r2: box.r2, c1: box.c1, c2: box.c2 }))) })}
                  {sep}
                  {item("Chèn dòng phía trên", () => { setRange(null); start(() => void gridInsertRowAction(projectId, sheetId, r0 - 1)); })}
                  {item("Chèn dòng phía dưới", () => { setRange(null); start(() => void gridInsertRowAction(projectId, sheetId, r1)); })}
                  {item("Chuyển thành đầu mục lớn", () => { setRange(null); start(() => void gridSetRowsHeadingAction(projectId, sheetId, Array.from({ length: r1 - r0 + 1 }, (_, i) => r0 + i), true)); })}
                  {item("Chuyển đầu mục về dòng thường", () => { setRange(null); start(() => void gridSetRowsHeadingAction(projectId, sheetId, Array.from({ length: r1 - r0 + 1 }, (_, i) => r0 + i), false)); })}
                  {item("Xoá dòng", async () => {
                    const rows = Array.from({ length: r1 - r0 + 1 }, (_, i) => r0 + i);
                    if (!await confirmNear(`⚠ Bạn có chắc chắn muốn XOÁ ${rows.length} dòng đang chọn không?`)) return;
                    setRange(null);
                    start(() => void gridDeleteRowsAction(projectId, sheetId, rows));
                  }, { danger: true })}
                </>
              );
            })()}
          </div>
        </div>
      )}
      {colDialog && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => setColDialog(null)}>
          <div className="my-16 w-full max-w-sm rounded-lg bg-white p-5 text-left text-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-900">{colDialog.mode === "add" ? "Thêm cột" : "Xoá cột"}</h2>
            {colDialog.mode === "add" && (
              <div className="mt-3 flex gap-4">
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={colDialog.where === "before"} onChange={() => setColDialog({ ...colDialog, where: "before" })} /> Thêm vào trước cột
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={colDialog.where === "after"} onChange={() => setColDialog({ ...colDialog, where: "after" })} /> Thêm vào sau cột
                </label>
              </div>
            )}
            <label className="mt-3 block text-xs text-slate-500">{colDialog.mode === "add" ? "Cột hiện có:" : "Cột cần xoá:"}</label>
            <select value={colDialog.col} onChange={(e) => setColDialog({ ...colDialog, col: Number(e.target.value) })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
              {colTitles.map((t, i) => (
                <option key={i} value={i}>
                  {colLetter(i)} — {t || `Cột ${i + 1}`}
                </option>
              ))}
            </select>
            {colDialog.mode === "del" && <p className="mt-2 text-xs text-red-600">Cột bị xoá cùng toàn bộ dữ liệu trong cột, không hoàn tác được.</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setColDialog(null)} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
                Huỷ
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  const d = colDialog;
                  setColDialog(null);
                  if (d.mode === "add") start(() => void gridInsertColAction(projectId, sheetId, d.where === "after" ? d.col : d.col - 1));
                  else start(() => void gridDeleteColAction(projectId, sheetId, d.col));
                }}
                className={`rounded-md px-3 py-1.5 text-white ${colDialog.mode === "del" ? "bg-red-600 hover:bg-red-700" : "bg-slate-900 hover:bg-slate-800"}`}
              >
                {colDialog.mode === "add" ? "Thêm cột" : "Xoá cột"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
