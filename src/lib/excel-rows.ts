import ExcelJS from "exceljs";

// Thêm / xoá dòng trong sheet Excel GỐC khi xuất lại hồ sơ (đề xuất giá đội, trình giá thầu phụ), giữ đúng công thức / ô gộp.
// ExcelJS không tự dời công thức khi chèn dòng nên phải tự làm.

// Dời số dòng trong công thức như Excel khi chèn `n` dòng tại dòng `at`: tham chiếu từ dòng `at` trở xuống +n; vùng nhiều dòng
// kết thúc NGAY TRÊN chỗ chèn (VD SUBTOTAL của nhóm, chèn dưới dòng cuối nhóm) thì nở ra để gồm cả dòng mới.
// Tham chiếu sang sheet khác ('Sheet'!A1) giữ nguyên.
export function shiftFormulaRows(f: string, at: number, n: number): string {
  return f.replace(/(^|[^A-Za-z0-9_.$'!"])(\$?[A-Z]{1,3}\$?)(\d+)(?::(\$?[A-Z]{1,3}\$?)(\d+))?(?![\d(A-Za-z_!])/g, (_m, pre: string, c1: string, r1: string, c2?: string, r2?: string) => {
    const a = Number(r1);
    if (c2 === undefined || r2 === undefined) return `${pre}${c1}${a >= at ? a + n : a}`;
    const b = Number(r2);
    const na = a >= at ? a + n : a;
    const nb = b >= at || (a < b && b === at - 1) ? b + n : b;
    return `${pre}${c1}${na}:${c2}${nb}`;
  });
}

type MergeBox = { top: number; left: number; bottom: number; right: number };

export function insertRowsAt(ws: ExcelJS.Worksheet, at: number, n: number) {
  // 1) công thức: đổi công thức dùng chung (shared) thành công thức riêng từng ô rồi dời số dòng
  const fixes: { cell: ExcelJS.Cell; formula: string; result: unknown }[] = [];
  ws.eachRow({ includeEmpty: false }, (row) =>
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.type !== ExcelJS.ValueType.Formula) return;
      const f = cell.formula;
      if (f) fixes.push({ cell, formula: shiftFormulaRows(f, at, n), result: cell.result });
    }),
  );
  for (const x of fixes) x.cell.value = { formula: x.formula, result: x.result } as ExcelJS.CellFormulaValue;
  // 2) ô gộp phía dưới: gỡ ra, chèn xong gộp lại ở vị trí mới
  const merges: MergeBox[] = Object.values((ws as unknown as { _merges: Record<string, { model: MergeBox }> })._merges).map((r) => ({ ...r.model }));
  const moved = merges.filter((m) => m.bottom >= at);
  for (const m of moved) ws.unMergeCells(m.top, m.left, m.bottom, m.right);
  // 3) thuộc tính dòng ExcelJS không tự dời: ẩn / group
  const props: { r: number; hidden: boolean; outline: number }[] = [];
  for (let r = at; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (row.hidden || row.outlineLevel) props.push({ r, hidden: !!row.hidden, outline: row.outlineLevel ?? 0 });
    row.hidden = false;
    row.outlineLevel = 0;
  }
  ws.spliceRows(at, 0, ...Array.from({ length: n }, () => []));
  for (const p of props) {
    const row = ws.getRow(p.r + n);
    row.hidden = p.hidden;
    row.outlineLevel = p.outline;
  }
  for (const m of moved) ws.mergeCells(m.top >= at ? m.top + n : m.top, m.left, m.bottom + n, m.right);
}

const REF_RE = /(^|[^A-Za-z0-9_.$'!"])(\$?[A-Z]{1,3}\$?)(\d+)(?![\d(A-Za-z_!])/g;

// Đưa danh sách dòng của hồ sơ (đúng thứ tự trên phần mềm) vào sheet gốc:
//  - dòng công việc có trong file (origItemRows) mà hồ sơ không còn: xoá số ở `clearCols`, ẨN dòng (giữ công thức / định dạng)
//  - dòng thêm (sourceRow = 0): CHÈN dòng mới ngay dưới dòng đứng trước nó, chép định dạng + công thức "chỉ tham chiếu chính dòng đó"
//    (VD thành tiền = KL × đơn giá) của dòng công việc gần nhất; công thức / ô gộp / các dòng tổng bên dưới tự dời xuống
// Trả về dòng với sourceRow = dòng MỚI trong sheet (dòng thêm có isNew = true); các số dòng trong `hr` (khoá `hrKeys`) cập nhật tại chỗ.
export function applyRowEdits<L extends { sourceRow: number; level: string }>(
  ws: ExcelJS.Worksheet,
  lines: L[],
  opts: { origItemRows: number[]; clearCols: (number | undefined)[]; hr: Record<string, number>; hrKeys: string[] },
): (L & { isNew?: boolean })[] {
  const kept = new Set(lines.map((l) => l.sourceRow).filter((r) => r > 0));
  for (const r of opts.origItemRows) {
    if (kept.has(r)) continue;
    const row = ws.getRow(r);
    for (const c of opts.clearCols) if (c && row.getCell(c).type !== ExcelJS.ValueType.Formula) row.getCell(c).value = null;
    // xoá luôn MỌI ô số (không phải công thức) của dòng: SUBTOTAL(9, ...) vẫn cộng dòng ẩn, nên thành tiền phải về 0
    row.eachCell((c) => {
      if (typeof c.value === "number") c.value = null;
    });
    row.hidden = true;
  }

  const existing = lines.filter((l) => l.sourceRow > 0);
  if (!existing.length || existing.length === lines.length) return lines;
  const blocks: { at: number; idx: number[]; tpl: number }[] = [];
  for (let i = 0; i < lines.length; ) {
    if (lines[i].sourceRow > 0) {
      i++;
      continue;
    }
    const start = i;
    while (i < lines.length && lines[i].sourceRow === 0) i++;
    const before = lines.slice(0, start).reverse();
    const after = lines.slice(i);
    const prev = before.find((l) => l.sourceRow > 0);
    const isItem = (l: L) => l.sourceRow > 0 && l.level === "ITEM";
    // dòng mẫu: dòng công việc gần nhất có NHIỀU công thức nhất (đủ các cột thành tiền) — tránh lấy dòng tiêu đề con chỉ có chữ
    // (VD "1. Lắp đặt mốc chuẩn" chỉ có 1 công thức chênh lệch, còn "1.1" mới có KL × đơn giá)
    const nF = (l: L) => {
      let f = 0;
      if (isItem(l))
        ws.getRow(l.sourceRow).eachCell((c) => {
          if (c.type === ExcelJS.ValueType.Formula) f++;
        });
      return f;
    };
    const near = [...before, ...after].filter(isItem);
    const best = Math.max(0, ...near.map(nF));
    const tpl = near.find((l) => nF(l) === best);
    blocks.push({ at: prev ? prev.sourceRow + 1 : existing[0].sourceRow, idx: Array.from({ length: i - start }, (_, k) => start + k), tpl: tpl?.sourceRow ?? 0 });
  }
  // chèn từ dưới lên để số dòng của các chỗ chèn phía trên không đổi
  for (const b of [...blocks].sort((x, y) => y.at - x.at)) {
    const n = b.idx.length;
    insertRowsAt(ws, b.at, n);
    if (!b.tpl) continue;
    const tplRow = b.tpl >= b.at ? b.tpl + n : b.tpl;
    const src = ws.getRow(tplRow);
    for (let k = 0; k < n; k++) {
      const to = b.at + k;
      const dst = ws.getRow(to);
      if (src.height) dst.height = src.height;
      dst.outlineLevel = src.outlineLevel ?? 0;
      src.eachCell({ includeEmpty: true }, (cell, col) => {
        const d = dst.getCell(col);
        d.style = { ...cell.style };
        if (cell.type === ExcelJS.ValueType.Formula && cell.formula) {
          const rows = [...cell.formula.matchAll(REF_RE)].map((m) => Number(m[3]));
          if (rows.length && rows.every((r) => r === tplRow)) d.value = { formula: cell.formula.replace(REF_RE, (_m, pre: string, c: string) => `${pre}${c}${to}`) } as ExcelJS.CellFormulaValue;
        }
      });
    }
  }
  const moved = (r: number) => r + blocks.filter((b) => b.at <= r).reduce((t, b) => t + b.idx.length, 0);
  for (const k of opts.hrKeys) if (opts.hr[k]) opts.hr[k] = moved(opts.hr[k]);
  const newRow = new Map<number, number>();
  for (const b of blocks) {
    const base = b.at + blocks.filter((x) => x.at < b.at).reduce((t, x) => t + x.idx.length, 0);
    b.idx.forEach((li, k) => newRow.set(li, base + k));
  }
  return lines.map((l, i) => (l.sourceRow > 0 ? { ...l, sourceRow: moved(l.sourceRow) } : { ...l, sourceRow: newRow.get(i) ?? 0, isNew: true }));
}

// Dòng / cột bị ẩn trong file (kể cả dòng thu gọn bằng Group) → bỏ qua khi đọc
export const colHidden = (ws: ExcelJS.Worksheet, c: number) => !!ws.getColumn(c).hidden;
export const rowHidden = (ws: ExcelJS.Worksheet, r: number) => !!ws.getRow(r).hidden;
export const sheetVisible = (ws: ExcelJS.Worksheet) => ws.state !== "hidden" && ws.state !== "veryHidden";
