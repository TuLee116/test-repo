"use client";

import { useEffect, useMemo, useState } from "react";
import { PACKAGE_TYPES } from "@/lib/package-types";

export type ProjectStat = {
  id: string;
  name: string;
  packageName: string;
  packageType: string;
  area: string; // khu vực "1".."5", rỗng = chưa chọn
  creator: string; // người lập DT-CP
  year: number; // năm lập DT-CP
  revenue: number; // doanh thu trước VAT
  cost: number; // chi phí (mục B DT-CP)
  parts: { vl: number; nc: number; m: number; tp: number; other: number }; // cơ cấu chi phí trực tiếp
};

const fmtB = (n: number) => (Math.abs(n) >= 1e9 ? `${(n / 1e9).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} tỷ` : `${(n / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 0 })} tr`);
const fmtFull = (n: number) => Math.round(n).toLocaleString("vi-VN");
const areaLabel = (a: string) => (a ? `Khu vực ${a}` : "Chưa chọn khu vực");
const normName = (x: string) => x.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

// Màu theo vai trò: mặt trước / mặt trên (sáng hơn) / mặt bên (tối hơn) của khối 3D - cùng 1 màu cho cùng 1 chỉ tiêu ở mọi khu vực
const SERIES = {
  revenue: { label: "Doanh thu", front: "#2a78d6", top: "#6aa3e8", side: "#1d5aa6" },
  cost: { label: "Chi phí", front: "#eb6834", top: "#f4976f", side: "#b84a1f" },
} as const;
const PARTS = [
  { key: "vl", label: "Vật tư", color: "#2a78d6" },
  { key: "nc", label: "Nhân công", color: "#eb6834" },
  { key: "m", label: "Thiết bị / Máy", color: "#1baf7a" },
  { key: "tp", label: "Thầu phụ", color: "#eda100" },
  { key: "other", label: "Chi phí khác", color: "#e87ba4" },
] as const;
// Thứ tự gói trong mỗi khu vực; "Phần Thô" = gói kết cấu
const PKG_ORDER = ["THO", "HOAN_THIEN", "MEP", "NOI_THAT", "TONG_THAU"];
// luôn đủ 5 khu vực (kể cả chưa có DT-CP); "Chưa chọn khu vực" chỉ hiện khi có DT-CP chưa gán
const ALL_AREAS = (stats: ProjectStat[]) => ["1", "2", "3", "4", "5", ...(stats.some((s) => !s.area) ? [""] : [])];
const pkgLabel = (v: string) => (v === "THO" ? "Kết cấu (Phần thô)" : (PACKAGE_TYPES.find((t) => t.value === v)?.label ?? v));

type Tip = { x: number; y: number; title: string; lines: string[] };
type Filters = { area: string; pkg: string; project: string; creator: string; year: string };
const NO_FILTER: Filters = { area: "*", pkg: "*", project: "*", creator: "*", year: "*" };

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-[0_1px_0_#fff_inset,0_5px_0_#e2e8f0,0_14px_24px_-10px_rgba(15,23,42,0.28)]">
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: accent }} />
      <div className="pl-1 text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 pl-1 text-2xl font-bold text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 pl-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const active = value !== "*";
  return (
    <label className="min-w-0 flex-1 basis-40 text-xs font-medium text-slate-600">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 block w-full truncate rounded-lg border bg-white px-2 py-1.5 text-sm font-normal text-slate-900 shadow-sm ${active ? "border-blue-500 ring-1 ring-blue-500" : "border-slate-300"}`}
      >
        <option value="*">Tất cả</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// 1 cột 3D: mặt trước + mặt trên + mặt bên, chiều cao tuyến tính theo giá trị (mọi khu vực dùng chung 1 thang)
function Column3D({ x, y0, w, h, c }: { x: number; y0: number; w: number; h: number; c: { front: string; top: string; side: string } }) {
  const dx = 11;
  const dy = 7;
  const top = y0 - h;
  return (
    <g className="dash-grow" style={{ transformOrigin: `${x}px ${y0}px` }}>
      <polygon points={`${x + w},${top} ${x + w + dx},${top - dy} ${x + w + dx},${y0 - dy} ${x + w},${y0}`} fill={c.side} />
      <rect x={x} y={top} width={w} height={h} fill={c.front} />
      <polygon points={`${x},${top} ${x + dx},${top - dy} ${x + w + dx},${top - dy} ${x + w},${top}`} fill={c.top} />
    </g>
  );
}

type PkgGroup = { type: string; list: ProjectStat[]; revenue: number; cost: number };

function AreaChart({ groups, maxValue, onTip, onPick }: { groups: PkgGroup[]; maxValue: number; onTip: (t: Tip | null) => void; onPick: (type: string) => void }) {
  // khung vẽ giữ tối thiểu 4 nhóm: lọc còn 1 loại gói thì cột vẫn đúng cỡ, nằm giữa khung (không bị phóng to theo khung)
  const W = Math.max(groups.length, 4) * 140 + 24;
  const GW = (W - 24) / Math.max(groups.length, 1);
  const H = 182;
  const y0 = 132;
  const plot = 96;
  const bw = 34;
  const scale = (v: number) => (v > 0 ? Math.max(2, (v / maxValue) * plot) : 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ minWidth: Math.min(W, 420) }} role="img" aria-label="Doanh thu và chi phí theo loại gói thầu">
      {/* sàn 3D */}
      <polygon points={`12,${y0 + 6} 24,${y0 - 8} ${W - 2},${y0 - 8} ${W - 14},${y0 + 6}`} fill="#e2e8f0" />
      <polygon points={`12,${y0 + 6} ${W - 14},${y0 + 6} ${W - 14},${y0 + 10} 12,${y0 + 10}`} fill="#cbd5e1" />
      {groups.map((g, i) => {
        const gx = 12 + i * GW;
        const x1 = gx + (GW - 2 * bw - 20) / 2 - 3;
        const x2 = x1 + bw + 20;
        const hR = scale(g.revenue);
        const hC = scale(g.cost);
        const has = g.list.length > 0;
        return (
          <g
            key={g.type}
            className={has ? "cursor-pointer" : undefined}
            onClick={() => has && onPick(g.type)}
            onMouseMove={(e) =>
              has &&
              onTip({
                x: e.clientX,
                y: e.clientY,
                title: `${pkgLabel(g.type)} · ${g.list.length} DT-CP`,
                lines: [`Doanh thu: ${fmtFull(g.revenue)} đ`, `Chi phí: ${fmtFull(g.cost)} đ`, ...g.list.slice(0, 6).map((p) => `• ${p.packageName || p.name}: ${fmtB(p.revenue)}`), ...(g.list.length > 6 ? [`… và ${g.list.length - 6} DT-CP khác`] : [])],
              })
            }
            onMouseLeave={() => onTip(null)}
          >
            <rect x={gx} y={0} width={GW} height={H} fill="transparent" />
            {has ? (
              <>
                <Column3D x={x1} y0={y0} w={bw} h={hR} c={SERIES.revenue} />
                <Column3D x={x2} y0={y0} w={bw} h={hC} c={SERIES.cost} />
                <text x={x1 + bw / 2 + 5} y={y0 - hR - 11} textAnchor="middle" fontSize="11" fontWeight="600" fill="#0f172a">
                  {fmtB(g.revenue)}
                </text>
                <text x={x2 + bw / 2 + 5} y={y0 - hC - 11} textAnchor="middle" fontSize="11" fontWeight="600" fill="#0f172a">
                  {fmtB(g.cost)}
                </text>
              </>
            ) : (
              <text x={gx + GW / 2} y={y0 - 16} textAnchor="middle" fontSize="11" fill="#94a3b8">
                Chưa có gói
              </text>
            )}
            <text x={gx + GW / 2} y={y0 + 26} textAnchor="middle" fontSize="12" fontWeight="600" fill="#1e293b">
              {pkgLabel(g.type)}
            </text>
            <text x={gx + GW / 2} y={y0 + 42} textAnchor="middle" fontSize="11" fill="#64748b">
              {has ? `${g.list.length} DT-CP` : "—"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// Vành khuyên 3D: xếp chồng nhiều lớp SVG trong không gian CSS 3D. Số liệu chính xác nằm ở bảng chú giải bên cạnh.
function Donut3D({ slices, onTip }: { slices: { label: string; value: number; color: string }[]; onTip: (t: Tip | null) => void }) {
  const size = 190;
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = size / 2 - 22;
  const c = 2 * Math.PI * r;
  const ring = (interactive: boolean) => {
    let acc = 0;
    return slices.map((s) => {
      const len = total > 0 ? (s.value / total) * c : 0;
      const off = -acc;
      acc += len;
      if (len <= 0) return null;
      return (
        <circle
          key={s.label}
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={s.color}
          strokeWidth={34}
          strokeDasharray={`${Math.max(0, len - 1.5)} ${c - Math.max(0, len - 1.5)}`}
          strokeDashoffset={off}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          {...(interactive ? { onMouseMove: (e: React.MouseEvent) => onTip({ x: e.clientX, y: e.clientY, title: s.label, lines: [`${fmtFull(s.value)} đ`, `${((s.value / total) * 100).toFixed(1).replace(".", ",")}%`] }), onMouseLeave: () => onTip(null) } : {})}
        />
      );
    });
  };
  const layers = 12;
  return (
    <div className="relative mx-auto" style={{ width: size, height: size * 0.72, perspective: 700 }}>
      <div className="absolute left-0 top-[-12%]" style={{ width: size, height: size, transform: "rotateX(52deg)", transformStyle: "preserve-3d" }}>
        {Array.from({ length: layers }, (_, i) => (
          <svg key={i} width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0" style={{ transform: `translateZ(${i - layers}px)`, filter: "brightness(0.72)" }} aria-hidden>
            {ring(false)}
          </svg>
        ))}
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0" role="img" aria-label="Cơ cấu chi phí trực tiếp">
          {total > 0 ? ring(true) : <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={34} />}
        </svg>
      </div>
    </div>
  );
}

// Dashboard trang Dự án: lọc theo khu vực / loại gói / dự án / người lập / năm; doanh thu - chi phí từng khu vực chia theo loại gói
// (SVG / CSS 3D thuần, không cần thư viện). Bộ lọc áp cho cả menu dự án bên trái (các mục có data-dash-*, xem projects/page.tsx).
export default function Dashboard({ stats }: { stats: ProjectStat[] }) {
  const [f, setF] = useState<Filters>(NO_FILTER);
  const [tip, setTip] = useState<Tip | null>(null);
  const set = (patch: Partial<Filters>) => setF((cur) => ({ ...cur, ...patch }));
  const isFiltered = Object.values(f).some((v) => v !== "*");

  const options = useMemo(() => {
    const uniq = (xs: string[]) => [...new Set(xs)];
    const projects = new Map<string, string>();
    for (const s of stats) if (!projects.has(normName(s.name))) projects.set(normName(s.name), s.name.trim());
    return {
      area: ALL_AREAS(stats).map((a) => ({ value: a || "none", label: areaLabel(a) })),
      pkg: PKG_ORDER.filter((t) => stats.some((s) => s.packageType === t)).map((t) => ({ value: t, label: pkgLabel(t) })),
      project: [...projects.entries()].sort((a, b) => a[1].localeCompare(b[1], "vi")).map(([value, label]) => ({ value, label })),
      creator: uniq(stats.map((s) => s.creator)).sort((a, b) => a.localeCompare(b, "vi")).map((c) => ({ value: c, label: c })),
      year: uniq(stats.map((s) => String(s.year))).sort((a, b) => b.localeCompare(a)).map((y) => ({ value: y, label: y })),
    };
  }, [stats]);

  const shown = useMemo(
    () =>
      stats.filter(
        (s) =>
          (f.area === "*" || (s.area || "none") === f.area) &&
          (f.pkg === "*" || s.packageType === f.pkg) &&
          (f.project === "*" || normName(s.name) === f.project) &&
          (f.creator === "*" || s.creator === f.creator) &&
          (f.year === "*" || String(s.year) === f.year)
      ),
    [stats, f]
  );

  // Áp bộ lọc cho menu dự án bên trái
  useEffect(() => {
    const ids = new Set(shown.map((s) => s.id));
    const visible = (id: string) => !isFiltered || ids.has(id);
    const toggle = (selector: string, attr: string, test: (v: string) => boolean) =>
      document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        el.style.display = test(el.getAttribute(attr) ?? "") ? "" : "none";
      });
    toggle("[data-dash-pid]", "data-dash-pid", visible);
    const anyVisible = (v: string) => v.split(",").some(visible);
    toggle("[data-dash-group]", "data-dash-group", anyVisible);
    toggle("[data-dash-area]", "data-dash-area", anyVisible);
  }, [shown, isFiltered]);

  if (stats.length === 0) return null;
  const revenue = shown.reduce((s, p) => s + p.revenue, 0);
  const cost = shown.reduce((s, p) => s + p.cost, 0);
  const parts = PARTS.map((p) => ({ label: p.label, color: p.color, value: shown.reduce((s, x) => s + x.parts[p.key], 0) }));
  const partsTotal = parts.reduce((s, x) => s + x.value, 0);
  const types = PKG_ORDER.filter((t) => t !== "TONG_THAU" || shown.some((s) => s.packageType === t)).filter((t) => f.pkg === "*" || t === f.pkg);
  const areas = ALL_AREAS(stats).filter((a) => f.area === "*" || (a || "none") === f.area);
  const byArea = areas.map((area) => {
    const list = shown.filter((s) => s.area === area);
    const groups: PkgGroup[] = types.map((type) => {
      const l = list.filter((s) => s.packageType === type);
      return { type, list: l, revenue: l.reduce((s, p) => s + p.revenue, 0), cost: l.reduce((s, p) => s + p.cost, 0) };
    });
    return { area, list, groups, revenue: list.reduce((s, p) => s + p.revenue, 0), cost: list.reduce((s, p) => s + p.cost, 0) };
  });
  const maxValue = Math.max(1, ...byArea.flatMap((a) => a.groups.flatMap((g) => [g.revenue, g.cost])));

  return (
    <section className="space-y-4">
      <style>{`@keyframes dash-grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}.dash-grow{animation:dash-grow .45s ease-out}@media (prefers-reduced-motion:reduce){.dash-grow{animation:none}}`}</style>
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <Select label="Khu vực" value={f.area} onChange={(area) => set({ area })} options={options.area} />
          <Select label="Loại gói thầu" value={f.pkg} onChange={(pkg) => set({ pkg })} options={options.pkg} />
          <Select label="Dự án" value={f.project} onChange={(project) => set({ project })} options={options.project} />
          <Select label="Người thực hiện" value={f.creator} onChange={(creator) => set({ creator })} options={options.creator} />
          <Select label="Năm" value={f.year} onChange={(year) => set({ year })} options={options.year} />
          <button type="button" disabled={!isFiltered} onClick={() => setF(NO_FILTER)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">
            Xoá lọc
          </button>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Đang xem <b className="text-slate-800">{shown.length}</b> / {stats.length} DT-CP. Bộ lọc áp dụng cho cả biểu đồ và menu dự án bên trái.
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi label="Số DT-CP" value={String(shown.length)} sub={`${new Set(shown.map((s) => s.area)).size} khu vực có DT-CP`} accent="#0f172a" />
        <Kpi label="Doanh thu (trước VAT)" value={fmtB(revenue)} sub={`${fmtFull(revenue)} đ`} accent={SERIES.revenue.front} />
        <Kpi label="Chi phí" value={fmtB(cost)} sub={revenue > 0 ? `${((cost / revenue) * 100).toFixed(1).replace(".", ",")}% doanh thu` : "—"} accent={SERIES.cost.front} />
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">Không có DT-CP nào khớp bộ lọc.</div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Doanh thu và chi phí theo khu vực, chia theo loại gói thầu</h3>
            <div className="flex gap-3 text-xs text-slate-600">
              {(["revenue", "cost"] as const).map((k) => (
                <span key={k} className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[k].front }} />
                  {SERIES[k].label}
                </span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {byArea.map((a) => (
              <div key={a.area || "none"} className="min-w-0 rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-3 shadow-[0_4px_0_#e2e8f0,0_14px_24px_-12px_rgba(15,23,42,0.25)]">
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2">
                  <button type="button" onClick={() => set({ area: a.area || "none" })} className="text-sm font-semibold text-slate-900 hover:underline" title="Lọc theo khu vực này">
                    {areaLabel(a.area)}
                  </button>
                  <span className="text-xs text-slate-600">
                    {a.list.length} DT-CP · Doanh thu <b className="text-slate-900">{fmtB(a.revenue)}</b> · Chi phí <b className="text-slate-900">{fmtB(a.cost)}</b>
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <AreaChart groups={a.groups} maxValue={maxValue} onTip={setTip} onPick={(type) => set({ area: a.area || "none", pkg: type })} />
                </div>
              </div>
            ))}
            <div className="min-w-0 rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-3 shadow-[0_4px_0_#e2e8f0,0_14px_24px_-12px_rgba(15,23,42,0.25)]">
              <h3 className="mb-1 text-sm font-semibold text-slate-900">Cơ cấu chi phí trực tiếp</h3>
              <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
                <div>
                  <Donut3D slices={parts} onTip={setTip} />
                  <div className="mt-6 text-center text-xs text-slate-500">
                    Tổng <b className="text-sm text-slate-900">{fmtB(partsTotal)}</b>
                  </div>
                </div>
                <ul className="min-w-[200px] flex-1 space-y-1 text-xs">
                  {parts.map((p) => (
                    <li key={p.label} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-slate-700">
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
                        {p.label}
                      </span>
                      <span className="text-slate-600">
                        {fmtB(p.value)} · {partsTotal > 0 ? ((p.value / partsTotal) * 100).toFixed(1).replace(".", ",") : 0}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {tip && (
        <div className="pointer-events-none fixed z-50 max-w-xs rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-xl" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          <div className="font-semibold">{tip.title}</div>
          {tip.lines.map((l, i) => (
            <div key={i} className="mt-0.5 text-slate-200">
              {l}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
