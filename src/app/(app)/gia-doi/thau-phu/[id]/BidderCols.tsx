"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { colLetter } from "@/lib/grid-formula";
import ExcelGrid, { xcell } from "../../../ExcelGrid";
import { setSubBiddersAction, subColumnsAction, type SubResult } from "@/lib/thau-phu-actions";
import type { Bidder } from "@/lib/thau-phu-calc";
import type { SheetCol, SubColMap } from "@/lib/thau-phu-excel";

// QSĐT CHỌN SỐ LƯỢNG THẦU PHỤ rồi gắn KL / đơn giá của từng thầu phụ theo VỊ TRÍ CỘT trong file
// (anh chốt 11/11/2026 — phần mềm hay nhận diện sai tiêu đề thầu phụ). Phần mềm gợi ý cột theo vị trí, QSĐT sửa lại nếu lệch.

type Def = { name: string; qty?: number; price: number };
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toUpperCase();

// gợi ý cột: các thầu phụ nằm liền nhau giữa khối CƠ SỞ (B) và khối ĐỀ XUẤT DUYỆT (D), chia đều theo số thầu phụ
function guess(n: number, cols: SheetCol[], m: SubColMap): Def[] {
  const vis = cols.filter((c) => !c.hidden);
  const last = vis.length ? vis[vis.length - 1].c : 1;
  const baseEnd = Math.max(0, ...[m.base.qty, m.base.price, m.base.amount, m.cdt.amount, m.cdt.price].filter((x): x is number => !!x));
  let start = baseEnd + 1;
  while (cols.find((c) => c.c === start && (c.hidden || norm(c.top).startsWith("GHI CHU")))) start++;
  const propStart = Math.min(...[m.prop.qty, m.prop.price, m.prop.amount].filter((x): x is number => !!x && x > start), last + 1);
  const span = vis.filter((c) => c.c >= start && c.c < propStart).map((c) => c.c);
  const w = Math.max(1, Math.floor(span.length / Math.max(1, n)) || 3);
  return [...Array(n)].map((_, i) => {
    const block = span.slice(i * w, i * w + w);
    const at = (k: string) => block.find((c) => norm(cols.find((x) => x.c === c)?.sub ?? "").startsWith(k));
    const price = at("DON GIA") ?? (w >= 3 ? block[1] : block[0]) ?? start + i * w;
    const qty = at("KHOI LUONG") ?? (w >= 3 ? block[0] : undefined);
    const top = cols.find((x) => x.c === (block[0] ?? price))?.top ?? "";
    return { name: top.replace(/\s*\(C\d+\)\s*$/i, "").trim() || `Thầu phụ ${i + 1}`, qty, price };
  });
}

export default function BidderCols({ id, bidders, disabled, save }: { id: string; bidders: Bidder[]; disabled: boolean; save: () => Promise<SubResult> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [cols, setCols] = useState<SheetCol[]>([]);
  const [map, setMap] = useState<SubColMap | null>(null);
  const [defs, setDefs] = useState<Def[]>([]);

  const load = () =>
    start(async () => {
      const r = await subColumnsAction(id);
      if (!r.ok) return window.alert(r.error);
      setCols(r.cols);
      setMap(r.colMap);
      // đang có thầu phụ → hiện đúng cột đã gắn; chưa có → gợi ý theo vị trí
      const cur = bidders.map((b) => ({ name: b.name, qty: r.colMap.bids[b.key]?.qty, price: r.colMap.bids[b.key]?.price ?? 0 }));
      setDefs(cur.length && cur.every((d) => d.price) ? cur : guess(Math.max(1, bidders.length), r.cols, r.colMap));
      setOpen(true);
    });
  const setN = (n: number) => map && setDefs(guess(n, cols, map));
  const setD = (i: number, p: Partial<Def>) => setDefs((ds) => ds.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const apply = () => {
    if (defs.some((d) => !d.price)) return window.alert("Chọn cột ĐƠN GIÁ cho mọi thầu phụ");
    if (!window.confirm(`Gắn lại ${defs.length} thầu phụ theo cột đã chọn? KL / đơn giá các thầu phụ sẽ đọc lại từ file gốc theo cột này.`)) return;
    start(async () => {
      const r1 = await save();
      if (!r1.ok) return window.alert(r1.error);
      const r = await setSubBiddersAction(id, defs);
      if (!r.ok) return window.alert(r.error);
      setOpen(false);
      router.refresh();
    });
  };

  const colOpts = cols.filter((c) => !c.hidden);
  const label = (c: SheetCol) => `${colLetter(c.c - 1)} — ${[c.top, c.sub].filter(Boolean).join(" / ").slice(0, 60) || "(trống)"}`;
  const pick = (v: number | undefined, on: (n: number | undefined) => void, allowEmpty: boolean) => (
    <select className="w-64 rounded border border-slate-300 px-1 py-0.5 text-xs" value={v ?? ""} onChange={(e) => on(e.target.value ? Number(e.target.value) : undefined)}>
      <option value="">{allowEmpty ? "— không có (dùng KL chung) —" : "— chọn cột —"}</option>
      {colOpts.map((c) => (
        <option key={c.c} value={c.c}>
          {label(c)}
        </option>
      ))}
    </select>
  );

  return (
    <div className="mt-3 rounded border border-sky-200 bg-sky-50/50 px-3 py-2 font-sans text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-sky-900">Thầu phụ báo giá:</b>
        <span className="text-slate-700">{bidders.length ? bidders.map((b) => `${b.key} ${b.name}`).join(" · ") : "chưa có"}</span>
        {!open && (
          <button type="button" disabled={disabled || pending} onClick={load} className="ml-auto rounded border border-sky-300 bg-white px-2 py-0.5 font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50">
            {pending ? "Đang đọc file…" : "Chọn số lượng thầu phụ & cột"}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-2">
            Số lượng thầu phụ:
            <select className="rounded border border-slate-300 px-1 py-0.5" value={defs.length} onChange={(e) => setN(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="text-slate-500">Phần mềm gợi ý cột theo vị trí (các khối liền nhau sau khối CƠ SỞ) — sửa lại nếu lệch.</span>
          </div>
          <ExcelGrid cols={["name"]}>
          <table className="text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="px-1 text-left">Mã</th>
                <th className="px-1 text-left">Tên thầu phụ</th>
                <th className="px-1 text-left">Cột KHỐI LƯỢNG</th>
                <th className="px-1 text-left">Cột ĐƠN GIÁ</th>
              </tr>
            </thead>
            <tbody>
              {defs.map((d, i) => (
                <tr key={i}>
                  <td className="px-1 font-semibold">C{i + 1}</td>
                  <td className="px-1 p-0" {...xcell(`b${i}`, "name")}>
                    <input className="w-64 rounded border border-slate-300 px-1 py-0.5" value={d.name} onChange={(e) => setD(i, { name: e.target.value })} />
                  </td>
                  <td className="px-1">{pick(d.qty, (v) => setD(i, { qty: v }), true)}</td>
                  <td className="px-1">{pick(d.price || undefined, (v) => setD(i, { price: v ?? 0 }), false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </ExcelGrid>
          <div className="flex gap-2">
            <button type="button" disabled={pending} onClick={apply} className="rounded bg-sky-700 px-3 py-1 font-medium text-white hover:bg-sky-800 disabled:opacity-50">
              Áp dụng
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded border border-slate-300 bg-white px-3 py-1">
              Huỷ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
