"use client";

import { useState } from "react";
import ExportScopeFields, { type ScopeContract } from "../ExportScopeFields";

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

// Xuất file TỔNG HỢP ĐỆ TRÌNH THẦU PHỤ theo tuần / tháng / năm (chỉ hiện cho tài khoản được tick quyền "Xuất file tổng hợp đệ trình thầu phụ")
export default function ThauPhuExport({ areas, projects, contracts }: { areas: string[]; projects: string[]; contracts: ScopeContract[] }) {
  const [ky, setKy] = useState<"week" | "month" | "year" | "range">("month");
  const [week, setWeek] = useState(isoWeek);
  const [month, setMonth] = useState(thisMonth);
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const sel = "rounded border border-slate-300 px-2 py-1 text-sm";
  return (
    <form action="/gia-doi/thau-phu/tong-hop" method="get" className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 px-4 py-2.5 text-sm">
      <b className="text-emerald-900">⬇ Xuất file tổng hợp đệ trình thầu phụ:</b>
      <select name="ky" value={ky} onChange={(e) => setKy(e.target.value as "week" | "month" | "year" | "range")} className={sel} aria-label="Theo tuần, tháng, năm hay khoảng ngày">
        <option value="week">Theo tuần</option>
        <option value="month">Theo tháng</option>
        <option value="year">Theo năm</option>
        <option value="range">Khoảng thời gian</option>
      </select>
      {ky === "week" ? (
        <input type="week" name="v" value={week} onChange={(e) => setWeek(e.target.value)} required className={sel} aria-label="Tuần" />
      ) : ky === "month" ? (
        <input type="month" name="v" value={month} onChange={(e) => setMonth(e.target.value)} required className={sel} aria-label="Tháng" />
      ) : ky === "range" ? (
        <>
          <span className="text-xs text-slate-600">Từ</span>
          <input type="date" name="from" required className={sel} aria-label="Từ ngày" />
          <span className="text-xs text-slate-600">đến</span>
          <input type="date" name="to" required className={sel} aria-label="Đến ngày" />
        </>
      ) : (
        <input type="number" name="v" min={2020} max={2100} value={year} onChange={(e) => setYear(e.target.value)} required className={`${sel} w-24`} aria-label="Năm" />
      )}
      <select name="theo" defaultValue="duyet" className={sel} aria-label="Tính theo ngày">
        <option value="duyet">theo ngày duyệt</option>
        <option value="trinh">theo ngày trình</option>
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
      <button type="submit" formAction="/gia-doi/thau-phu/tat-ca" className="rounded-md border border-emerald-700 bg-white px-3 py-1 font-medium text-emerald-800 hover:bg-emerald-50" title="Tải 1 file ZIP gồm toàn bộ file đề xuất đã duyệt trong bộ lọc (tối đa 200 hồ sơ). Tên file: Số HĐ CĐT - Hạng mục - Thầu phụ">
        📦 Xuất tất cả file đề xuất
      </button>
      <span className="text-xs text-slate-500">Chỉ gồm hồ sơ đã duyệt · Mỗi hồ sơ 1 dòng · gom theo Khu vực · theo mẫu &quot;Đề xuất thầu phụ&quot; của phòng</span>
    </form>
  );
}
