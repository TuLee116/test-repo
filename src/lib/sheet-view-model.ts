import type { SheetSnap, SnapCell } from "./sheet-snapshot";

// Dựng MÔ HÌNH HIỂN THỊ từ bản chụp sheet Excel: giao diện kiểu DT-CP của phần mềm (xem OldSheetView.tsx) nhưng SỐ DÒNG, SỐ CỘT, NỘI DUNG
// lấy đúng như file Excel (không bỏ dòng / cột nào có dữ liệu, trừ dòng / cột ẩn trong file). Hàm thuần, chạy được cả server lẫn thử độc lập.

export const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

type Norm = { v: string | number | null; d?: number; p?: boolean; b: boolean; i: boolean; cs: number; rs: number; s: boolean };
export const cellOf = (c: SnapCell | undefined): Norm => {
  if (c == null) return { v: null, b: false, i: false, cs: 1, rs: 1, s: false };
  if (typeof c === "string" || typeof c === "number") return { v: c, b: false, i: false, cs: 1, rs: 1, s: false };
  return { v: c.v ?? null, d: c.d, p: !!c.p, b: !!c.b, i: !!c.i, cs: c.cs ?? 1, rs: c.rs ?? 1, s: !!c.s };
};

// Kiểu cột suy ra từ tiêu đề: money = thành tiền / đơn giá / chênh lệch (làm tròn đến đồng), pct = cột "% so với DT" (hiện dạng %)
export type ColKind = "money" | "pct" | "other";

export function fmtCell(n: Norm, kind: ColKind = "other"): string {
  const v = n.v;
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (n.p || kind === "pct") {
    const d = n.p ? (n.d ?? 1) : 1; // cột "% so với DT" lưu tỷ lệ 0,7551 → 75,5%
    return `${(v * 100).toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
  }
  // thành tiền / đơn giá: làm tròn đến hàng đơn vị; số rất lớn không rõ cột cũng coi là tiền
  if (kind === "money" || Math.abs(v) >= 100000) return v.toLocaleString("vi-VN", { maximumFractionDigits: 0 });
  if (n.d !== undefined) return v.toLocaleString("vi-VN", { minimumFractionDigits: n.d, maximumFractionDigits: n.d });
  return Number.isInteger(v) ? v.toLocaleString("vi-VN") : v.toLocaleString("vi-VN", { maximumFractionDigits: 4 });
}

// ri / ci = vị trí gốc của ô trong bản chụp (để gộp / tách ô); cs0 / rs0 = số cột / dòng ô đang gộp trong bản chụp
export type VCell = { text: string; num: boolean; bold: boolean; italic: boolean; colSpan: number; rowSpan: number; ri: number; ci: number; cs0: number; rs0: number };
export type VRow = { cells: (VCell | null)[]; level: "sec" | "grp" | "l1" | "lN" | "plain" | "blank"; depth: number; src: number };
export type SheetView = {
  title: { text: string; main: boolean }[];
  cols: { w: number }[]; // cột hiển thị (đã bỏ cột ẩn)
  colIdx: number[]; // chỉ số cột gốc của từng cột hiển thị
  colKind: ColKind[];
  head: VRow[];
  body: VRow[];
  sttCol: number; // vị trí (trong cột hiển thị) của cột STT, -1 nếu không có
  contentCol: number;
};

const LETTERHEAD = /^(CONG TY CO PHAN XAY DUNG|DIA CHI\b|DIEN THOAI\b|WEBSITE\b|250 LE VAN HIEN|SO DIEN THOAI)/;
const ROMAN = /^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV)$/;

// Vị trí dòng tiêu đề bảng [dòng đầu, dòng cuối] (chỉ số 0-based trong snap.rows): dòng có ô "STT" / "TT" + các dòng tiêu đề tầng dưới;
// không có thì dòng chữ đầu tiên có ≥ 3 ô chữ, không có số.
export function findHeader(snap: SheetSnap): [number, number] | null {
  const rows = snap.rows;
  const norms = rows.map((r) => r.c.map(cellOf));
  const text = (ri: number, ci: number) => {
    const n = norms[ri]?.[ci];
    return n && n.v != null && !n.s ? norm(String(n.v)) : "";
  };
  const hasNum = (ri: number) => norms[ri].some((n) => typeof n.v === "number");
  const rowTexts = (ri: number) => norms[ri].filter((n) => typeof n.v === "string" && n.v).length;
  let h0 = -1;
  for (let r = 0; r < Math.min(rows.length, 60) && h0 < 0; r++) if (!rows[r].hidden && norms[r].some((_, c) => text(r, c) === "STT" || text(r, c) === "TT")) h0 = r;
  if (h0 < 0) for (let r = 0; r < Math.min(rows.length, 60) && h0 < 0; r++) if (!rows[r].hidden && rowTexts(r) >= 3 && !hasNum(r)) h0 = r;
  if (h0 < 0) return null;
  let h1 = h0;
  const kw = /(THANH TIEN|DON GIA|% SO|KHOI LUONG|SO LUONG|TD\d|THOI DIEM|CHENH LECH)/;
  while (h1 + 1 < rows.length && h1 - h0 < 3) {
    const nx = h1 + 1;
    if (rows[nx].hidden) {
      h1 = nx;
      continue;
    }
    const spanFromAbove = norms[nx].some((n) => n.s) && norms[h1].some((n) => n.rs > 1);
    const looksHead = !hasNum(nx) && rowTexts(nx) >= 2 && norms[nx].some((n) => typeof n.v === "string" && kw.test(norm(n.v)));
    if (spanFromAbove || looksHead) h1 = nx;
    else break;
  }
  return [h0, h1];
}

export function buildView(snap: SheetSnap): SheetView {
  const rows = snap.rows;
  const visCols = snap.cols.map((c, i) => (c.hidden ? -1 : i)).filter((i) => i >= 0);
  const vis = new Map(visCols.map((c, k) => [c, k]));
  const norms = rows.map((r) => r.c.map(cellOf));
  const text = (ri: number, ci: number) => {
    const n = norms[ri]?.[ci];
    return n && n.v != null && !n.s ? norm(String(n.v)) : "";
  };
  const hdr = findHeader(snap);
  const h0 = hdr ? hdr[0] : -1;
  const h1 = hdr ? hdr[1] : -1;

  // ---- khối tiêu đề phía trên bảng (bỏ phần đầu thư công ty vì đã có logo / đầu trang của phần mềm) ----
  const title: SheetView["title"] = [];
  const titleEnd = h0 < 0 ? 0 : h0;
  for (let r = 0; r < titleEnd; r++) {
    if (rows[r].hidden) continue;
    const seen: string[] = [];
    for (const n of norms[r]) if (!n.s && n.v != null && !seen.includes(String(n.v))) seen.push(String(n.v));
    const t = seen.join("  ·  ");
    if (!t) continue;
    if (LETTERHEAD.test(norm(t))) continue;
    const main = /^(BANG TONG HOP|DOANH THU|BOQ|CHI TIET|BANG KHOI LUONG)/.test(norm(t)) && t.length < 70;
    title.push({ text: t, main });
  }

  // ---- cột STT / nội dung ----
  let sttCol = -1;
  let contentCol = -1;
  if (h0 >= 0)
    for (let ri = h0; ri <= h1; ri++)
      visCols.forEach((c, k) => {
        const t = text(ri, c);
        if (sttCol < 0 && (t === "STT" || t === "TT")) sttCol = k;
        if (contentCol < 0 && (t.startsWith("NOI DUNG") || t.startsWith("TEN CONG") || t.startsWith("DIEN GIAI") || t.startsWith("HANG MUC"))) contentCol = k;
      });
  if (sttCol < 0 && visCols.length) sttCol = 0;
  if (contentCol < 0 && visCols.length > 1) contentCol = sttCol === 0 ? 1 : 0;

  // ---- kiểu từng cột theo chữ tiêu đề (kể cả ô gộp trải nhiều cột) ----
  const headText: string[] = visCols.map(() => "");
  if (h0 >= 0)
    for (let ri = h0; ri <= h1; ri++)
      for (let ci = 0; ci < snap.cols.length; ci++) {
        const n = norms[ri]?.[ci];
        if (!n || n.s || n.v == null || typeof n.v !== "string") continue;
        for (let k = ci; k < ci + n.cs; k++) {
          const vk = vis.get(k);
          if (vk !== undefined) headText[vk] += ` ${norm(n.v)}`;
        }
      }
  const colKind: ColKind[] = headText.map((t) => (/%|TY LE\b/.test(t) ? "pct" : /(THANH TIEN|DON GIA|CHENH LECH|GIA TRI|TRUC TIEP PHI|TONG TIEN)/.test(t) ? "money" : "other"));

  const toRow = (ri: number): VRow => {
    const cells: (VCell | null)[] = visCols.map((c, k) => {
      const n = norms[ri]?.[c] ?? cellOf(undefined);
      if (n.s) return null;
      // số cột hiển thị mà ô gộp trải qua (cột ẩn không tính)
      let colSpan = 0;
      for (let kk = c; kk < c + n.cs; kk++) if (vis.has(kk)) colSpan++;
      return { text: fmtCell(n, colKind[k]), num: typeof n.v === "number", bold: n.b, italic: n.i, colSpan: Math.max(colSpan, 1), rowSpan: n.rs, ri, ci: c, cs0: n.cs, rs0: n.rs };
    });
    const stt = sttCol >= 0 && visCols[sttCol] !== undefined ? String(norms[ri]?.[visCols[sttCol]]?.v ?? "").trim() : "";
    const filled = cells.some((x) => x && x.text);
    let level: VRow["level"] = filled ? "plain" : "blank";
    let depth = 0;
    if (ROMAN.test(stt)) level = "grp"; // I, V, X coi là số La Mã (nhóm), A / B / C... là mục lớn
    else if (/^[A-Z]$/.test(stt)) level = "sec";
    else if (/^\d+$/.test(stt)) level = "l1";
    else if (/^\d+(\.\d+)+$/.test(stt)) {
      level = "lN";
      depth = stt.split(".").length - 1;
    }
    return { cells, level, depth, src: ri + 1 };
  };

  const head: VRow[] = [];
  if (h0 >= 0) for (let r = h0; r <= h1; r++) if (!rows[r].hidden) head.push(toRow(r));
  const body: VRow[] = [];
  for (let r = h0 >= 0 ? h1 + 1 : 0; r < rows.length; r++) if (!rows[r].hidden) body.push(toRow(r));
  return { title, cols: visCols.map((c) => ({ w: snap.cols[c].w })), colIdx: visCols, colKind, head, body, sttCol, contentCol };
}
