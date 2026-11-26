"use client";

import { useMemo } from "react";

// Bảng PHẠM VI CÔNG VIỆC (mục C): xem đẹp; QSĐT sửa được nội dung, thêm / xoá dòng, thêm / xoá cột
const isHeadRow = (r: string[]) => r.some((c) => /^N[ỘO]I DUNG C[ÔO]NG VI[ỆE]C$/i.test(c.trim()));
const isGroupRow = (r: string[]) => /^([A-Z]|[IVX]+)$/.test((r[0] ?? "").trim()) && !!(r[1] ?? "").trim();
const isMark = (t: string) => t.trim().length > 0 && t.trim().length <= 4;

export default function ScopeTable({ rows, editable, onChange }: { rows: string[][]; editable: boolean; onChange: (r: string[][]) => void }) {
  const width = useMemo(() => rows.reduce((m, r) => Math.max(m, r.length), 0), [rows]);
  const grid = useMemo(() => rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? "")), [rows, width]);
  // độ rộng cột theo nội dung dài nhất (giới hạn), cột chỉ chứa dấu X thì hẹp
  const colW = useMemo(
    () =>
      Array.from({ length: width }, (_, c) => {
        const longest = grid.reduce((m, r) => Math.max(m, Math.min((r[c] ?? "").length, 60)), 0);
        return Math.max(5, Math.min(52, longest + 2));
      }),
    [grid, width],
  );
  const headIdx = grid.findIndex(isHeadRow);

  const set = (r: number, c: number, v: string) => onChange(grid.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)));
  const addRow = (after: number) => onChange([...grid.slice(0, after + 1), Array(width).fill(""), ...grid.slice(after + 1)]);
  const delRow = (i: number) => onChange(grid.filter((_, k) => k !== i));
  const addCol = (after: number) => onChange(grid.map((r) => [...r.slice(0, after + 1), "", ...r.slice(after + 1)]));
  const delCol = (c: number) => onChange(grid.map((r) => r.filter((_, k) => k !== c)));
  const btn = "rounded px-1 text-[12px] font-bold leading-none";

  return (
    <div className="max-h-[560px] overflow-auto rounded border border-slate-300 bg-white">
      <table className="border-collapse font-sans text-[12px]" style={{ tableLayout: "fixed", width: (editable ? 64 : 0) + colW.reduce((t, w) => t + w * 7.5 + 12, 0) }}>
        <colgroup>
          {editable && <col style={{ width: 64 }} />}
          {colW.map((w, i) => (
            <col key={i} style={{ width: w * 7.5 + 12 }} />
          ))}
        </colgroup>
        {editable && (
          <thead className="sticky top-0 z-10 bg-slate-100">
            <tr>
              <th className="border border-slate-300" />
              {colW.map((_, c) => (
                <th key={c} className="border border-slate-300 py-0.5 font-normal">
                  <span className="inline-flex items-center gap-1">
                    <span className="text-[10px] text-slate-500">Cột {c + 1}</span>
                    <button type="button" title="Thêm cột bên phải" onClick={() => addCol(c)} className={`${btn} text-emerald-700 hover:bg-emerald-100`}>＋</button>
                    <button type="button" title="Xoá cột này" onClick={() => window.confirm(`Xoá cột ${c + 1}?`) && delCol(c)} className={`${btn} text-red-600 hover:bg-red-100`}>✕</button>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {grid.map((r, i) => {
            const head = i === headIdx;
            const group = !head && isGroupRow(r);
            const title = i < headIdx && !head; // phần tiêu đề phía trên bảng (dự án, gói thầu, hình thức giao thầu)
            const rowCls = head ? "bg-sky-100 font-bold" : group ? "bg-slate-100 font-bold" : title ? "bg-white" : "bg-white hover:bg-sky-50/40";
            return (
              <tr key={i} className={`align-top ${rowCls}`}>
                {editable && (
                  <td className="border border-slate-300 bg-slate-50 text-center align-middle">
                    <span className="inline-flex gap-0.5">
                      <button type="button" title="Thêm dòng bên dưới" onClick={() => addRow(i)} className={`${btn} text-emerald-700 hover:bg-emerald-100`}>＋</button>
                      <button type="button" title="Xoá dòng này" onClick={() => delRow(i)} className={`${btn} text-red-600 hover:bg-red-100`}>✕</button>
                    </span>
                  </td>
                )}
                {r.map((t, c) => {
                  const center = head || (!group && isMark(t) && i > headIdx && headIdx >= 0);
                  const cls = `border border-slate-300 px-1.5 py-1 ${center ? "text-center" : "text-left"}`;
                  if (!editable)
                    return (
                      <td key={c} className={`${cls} whitespace-pre-wrap break-words`}>
                        {t}
                      </td>
                    );
                  return (
                    <td key={c} className="border border-slate-300 p-0">
                      <textarea
                        rows={1}
                        style={{ fieldSizing: "content" } as React.CSSProperties}
                        className={`block w-full resize-none bg-transparent px-1.5 py-1 font-[inherit] outline-none focus:bg-sky-50 ${center ? "text-center" : ""}`}
                        defaultValue={t}
                        key={`${i}-${c}-${t}`}
                        onBlur={(e) => e.target.value !== t && set(i, c, e.target.value)}
                      />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
