"use client";

import { useState } from "react";

export type ScopeContract = { value: string; label: string; project: string };

// Bộ lọc DỰ ÁN + HỢP ĐỒNG dùng chung cho các form xuất Excel tổng hợp (chọn dự án thì danh sách hợp đồng chỉ còn hợp đồng của dự án đó)
export default function ExportScopeFields({ projects, contracts }: { projects: string[]; contracts: ScopeContract[] }) {
  const [pj, setPj] = useState("");
  const [ct, setCt] = useState("");
  const sel = "max-w-[16rem] rounded border border-slate-300 px-2 py-1 text-sm";
  const list = pj ? contracts.filter((c) => c.project === pj) : contracts;
  return (
    <>
      <select name="pj" value={pj} onChange={(e) => { setPj(e.target.value); setCt(""); }} className={sel} aria-label="Dự án">
        <option value="">Tất cả dự án</option>
        {projects.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <select name="ct" value={ct} onChange={(e) => setCt(e.target.value)} className={sel} aria-label="Hợp đồng">
        <option value="">Tất cả hợp đồng</option>
        {list.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </>
  );
}
