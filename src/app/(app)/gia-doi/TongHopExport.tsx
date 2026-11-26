"use client";

import { useState } from "react";
import ExportScopeFields, { type ScopeContract } from "./ExportScopeFields";

// tuần ISO hiện tại dạng "2026-W45"
function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3); // thứ Năm cùng tuần
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// Xuất Excel TỔNG HỢP TRÌNH GIÁ ĐỘI theo tuần / tháng: Khu vực → Dự án → Hợp đồng; 2 sheet Theo DT-CP / Ngoài DT-CP
export default function TongHopExport({ areas, projects, contracts }: { areas: string[]; projects: string[]; contracts: ScopeContract[] }) {
  const [ky, setKy] = useState<"week" | "month" | "range">("month");
  const [week, setWeek] = useState(isoWeek);
  const [month, setMonth] = useState(thisMonth);
  const sel = "rounded border border-slate-300 px-2 py-1 text-sm";
  return (
    <form action="/gia-doi/tong-hop" method="get" className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 px-4 py-2.5 text-sm">
      <b className="text-emerald-900">⬇ Tổng hợp trình giá đội:</b>
      <select name="ky" value={ky} onChange={(e) => setKy(e.target.value as "week" | "month" | "range")} className={sel} aria-label="Theo tuần, tháng hay khoảng ngày">
        <option value="week">Theo tuần</option>
        <option value="month">Theo tháng</option>
        <option value="range">Khoảng thời gian</option>
      </select>
      {ky === "week" ? (
        <input type="week" name="v" value={week} onChange={(e) => setWeek(e.target.value)} required className={sel} aria-label="Tuần" />
      ) : ky === "month" ? (
        <input type="month" name="v" value={month} onChange={(e) => setMonth(e.target.value)} required className={sel} aria-label="Tháng" />
      ) : (
        <>
          <span className="text-xs text-slate-600">Từ</span>
          <input type="date" name="from" required className={sel} aria-label="Từ ngày" />
          <span className="text-xs text-slate-600">đến</span>
          <input type="date" name="to" required className={sel} aria-label="Đến ngày" />
        </>
      )}
      <select name="theo" defaultValue="trinh" className={sel} aria-label="Tính theo ngày">
        <option value="trinh">theo ngày trình</option>
        <option value="duyet">theo ngày duyệt</option>
      </select>
      <select name="kv" defaultValue="" className={sel} aria-label="Khu vực">
        <option value="">Tất cả khu vực</option>
        {areas.map((a) => (
          <option key={a} value={a}>
            Khu vực {a}
          </option>
        ))}
      </select>
      <ExportScopeFields projects={projects} contracts={contracts} />
      <button className="rounded-md bg-emerald-700 px-3 py-1 font-medium text-white hover:bg-emerald-800">Xuất Excel</button>
      <span className="text-xs text-slate-500">Chỉ gồm hồ sơ đã duyệt giá · 2 sheet: Theo DT-CP / Ngoài DT-CP · Khu vực → Dự án → Hợp đồng</span>
    </form>
  );
}
