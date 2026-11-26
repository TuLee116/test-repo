import type { SheetSnap, SnapCell } from "./sheet-snapshot";
import { cellOf, findHeader, norm } from "./sheet-view-model";

// Gộp / tách ô trên bản chụp sheet (QSTT chỉnh tiêu đề cho đẹp) + tự gộp các ô tiêu đề bị lặp chữ (VvD "THỜI ĐIỂM 1" ở 2 cột liền nhau,
// "STT" ở 2 dòng tiêu đề liền nhau). Hàm thuần: nhận bản chụp, trả bản chụp mới (không sửa bản gốc).

type Obj = { v?: string | number; d?: number; p?: 1; b?: 1; i?: 1; cs?: number; rs?: number; s?: 1 };
const clone = (snap: SheetSnap): SheetSnap => JSON.parse(JSON.stringify(snap)) as SheetSnap;

const toObj = (c: SnapCell | undefined): Obj => (c == null ? {} : typeof c === "object" ? { ...c } : { v: c });
// trả về dạng gọn nhất
const pack = (o: Obj): SnapCell => {
  const keys = Object.keys(o).filter((k) => (o as Record<string, unknown>)[k] !== undefined);
  if (!keys.length) return null;
  if (keys.length === 1 && keys[0] === "v") return o.v as string | number;
  return o as SnapCell;
};
const set = (snap: SheetSnap, r: number, c: number, o: Obj) => {
  const row = snap.rows[r];
  if (!row) return;
  while (row.c.length <= c) row.c.push(null);
  row.c[c] = pack(o);
};

// Tìm ô GỐC (góc trên trái) của vùng gộp đang chứa ô (r, c); không gộp thì trả chính ô đó
export function masterOf(snap: SheetSnap, r: number, c: number): { r: number; c: number; cs: number; rs: number } {
  const here = toObj(snap.rows[r]?.c[c]);
  if (!here.s) return { r, c, cs: here.cs ?? 1, rs: here.rs ?? 1 };
  for (let rr = r; rr >= 0; rr--)
    for (let cc = c; cc >= 0; cc--) {
      const o = toObj(snap.rows[rr]?.c[cc]);
      if (!o.s && ((o.cs ?? 1) > 1 || (o.rs ?? 1) > 1) && rr + (o.rs ?? 1) > r && cc + (o.cs ?? 1) > c) return { r: rr, c: cc, cs: o.cs ?? 1, rs: o.rs ?? 1 };
    }
  return { r, c, cs: 1, rs: 1 };
}

// Tách ô gộp chứa (r, c): các ô con trở về trống, ô gốc giữ chữ
export function splitAt(snap: SheetSnap, r: number, c: number): SheetSnap {
  const out = clone(snap);
  const m = masterOf(out, r, c);
  if (m.cs <= 1 && m.rs <= 1) return out;
  for (let rr = m.r; rr < m.r + m.rs; rr++)
    for (let cc = m.c; cc < m.c + m.cs; cc++) {
      if (rr === m.r && cc === m.c) {
        const o = toObj(out.rows[rr]?.c[cc]);
        delete o.cs;
        delete o.rs;
        set(out, rr, cc, o);
      } else set(out, rr, cc, {});
    }
  return out;
}

// Gộp vùng chữ nhật (r1..r2, c1..c2): tách trước mọi vùng gộp chạm vào, ô gốc lấy chữ đầu tiên có trong vùng
export function mergeRegion(snap: SheetSnap, r1: number, c1: number, r2: number, c2: number): SheetSnap {
  let out = clone(snap);
  const R1 = Math.min(r1, r2);
  const R2 = Math.max(r1, r2);
  const C1 = Math.min(c1, c2);
  const C2 = Math.max(c1, c2);
  if (R1 === R2 && C1 === C2) return out;
  for (let r = R1; r <= R2; r++) for (let c = C1; c <= C2; c++) out = splitAt(out, r, c); // gỡ các vùng gộp cũ chạm vào
  // ô gốc kéo dài ra ngoài vùng đã được splitAt gỡ ở trên (splitAt gỡ toàn bộ vùng gộp chứa ô)
  let first: Obj | null = null;
  for (let r = R1; r <= R2 && !first; r++)
    for (let c = C1; c <= C2 && !first; c++) {
      const o = toObj(out.rows[r]?.c[c]);
      if (o.v !== undefined && o.v !== null && o.v !== "") first = o;
    }
  for (let r = R1; r <= R2; r++)
    for (let c = C1; c <= C2; c++) {
      if (r === R1 && c === C1) continue;
      set(out, r, c, { s: 1 });
    }
  const master: Obj = first ? { ...first } : toObj(out.rows[R1]?.c[C1]);
  delete master.s;
  master.cs = C2 > C1 ? C2 - C1 + 1 : undefined;
  master.rs = R2 > R1 ? R2 - R1 + 1 : undefined;
  set(out, R1, C1, master);
  return out;
}

// Tự gộp ô tiêu đề lặp chữ: cùng chữ ở các ô liền nhau cùng dòng (gộp ngang) rồi cùng cột (gộp dọc)
export function autoMergeHeader(snap: SheetSnap): SheetSnap {
  const h = findHeader(snap);
  if (!h) return snap;
  let out = clone(snap);
  const [h0, h1] = h;
  const txt = (r: number, c: number) => {
    const n = cellOf(out.rows[r]?.c[c]);
    return n.s || typeof n.v !== "string" ? "" : norm(n.v);
  };
  // ngang
  for (let r = h0; r <= h1; r++) {
    let c = 0;
    while (c < out.cols.length) {
      const t = txt(r, c);
      const n = cellOf(out.rows[r]?.c[c]);
      if (!t || n.cs > 1 || n.rs > 1) {
        c += Math.max(n.cs, 1);
        continue;
      }
      let e = c;
      while (e + 1 < out.cols.length && txt(r, e + 1) === t && cellOf(out.rows[r].c[e + 1]).cs <= 1) e++;
      if (e > c) out = mergeRegion(out, r, c, r, e);
      c = e + 1;
    }
  }
  // dọc
  for (let c = 0; c < out.cols.length; c++) {
    let r = h0;
    while (r <= h1) {
      const n = cellOf(out.rows[r]?.c[c]);
      const t = txt(r, c);
      if (!t || n.s) {
        r++;
        continue;
      }
      let e = r + n.rs - 1;
      while (e + 1 <= h1) {
        const nx = cellOf(out.rows[e + 1]?.c[c]);
        if (nx.s || txt(e + 1, c) !== t || nx.cs !== n.cs) break;
        e += Math.max(nx.rs, 1);
      }
      if (e > r + n.rs - 1) out = mergeRegion(out, r, c, e, c + n.cs - 1);
      r = e + 1;
    }
  }
  return out;
}

// Xoá các dòng r1..r2 (chỉ số dòng trong bản chụp). Vùng gộp chạm vào các dòng này được tách trước để không làm lệch ô gộp khác.
export function deleteRows(snap: SheetSnap, r1: number, r2: number): SheetSnap {
  let out = clone(snap);
  const a = Math.max(0, Math.min(r1, r2));
  const b = Math.min(out.rows.length - 1, Math.max(r1, r2));
  if (b < a) return out;
  for (let r = a; r <= b; r++) for (let c = 0; c < out.cols.length; c++) out = splitAt(out, r, c);
  out.rows.splice(a, b - a + 1);
  return out;
}

// Đổi độ rộng cột (đơn vị ký tự như Excel), giữ trong khoảng hợp lý
export function setColWidth(snap: SheetSnap, ci: number, w: number): SheetSnap {
  const out = clone(snap);
  if (out.cols[ci]) out.cols[ci] = { ...out.cols[ci], w: Math.min(Math.max(Math.round(w * 10) / 10, 3), 120) };
  return out;
}
