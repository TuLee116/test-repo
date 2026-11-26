"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import type { SumRow } from "@/lib/summary-rows";
import { normName, tidyText } from "@/lib/project-site-calc";

// BẢNG TỔNG HỢP theo Khu vực → Cụm dự án → Dự án → Hợp đồng (trang thầu phụ / đội thi công):
// giá trị hợp đồng, giá trị thầu phụ (đội) theo DT-CP, đã duyệt, % đã duyệt so với DT-CP. Bấm dòng hợp đồng → danh sách hồ sơ.
// details: danh sách hồ sơ của từng dòng hợp đồng (server dựng sẵn, theo SumRow.key)

const AREA_NAME: Record<string, string> = { "1": "Đà Nẵng", "2": "Sài Gòn", "3": "Còn lại", "4": "Phú Quốc", "5": "Nhà tư" };
const areaLabel = (a: string) => (a ? `Khu vực ${a}${AREA_NAME[a] ? ` · ${AREA_NAME[a]}` : ""}` : "Chưa chọn khu vực");
const areaLetter = (a: string) => (/^\d+$/.test(a) && Number(a) >= 1 && Number(a) <= 26 ? String.fromCharCode(64 + Number(a)) : "—");
const roman = (n: number) => {
  const t: [number, string][] = [[40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, s] of t) while (n >= v) { out += s; n -= v; }
  return out;
};
const cmp = (a: string, b: string) => a.localeCompare(b, "vi", { numeric: true });
const lastFirst = (a: string, b: string) => (a ? 0 : 1) - (b ? 0 : 1); // nhóm trống xuống cuối

type Tot = { revenue: number; hasRevenue: boolean; dtcp: number; apprInDtcp: number; approved: number; n: number; waiting: number; over: boolean };
const totOf = (rows: SumRow[]): Tot => {
  const t: Tot = { revenue: 0, hasRevenue: false, dtcp: 0, apprInDtcp: 0, approved: 0, n: 0, waiting: 0, over: false };
  for (const r of rows) {
    if (r.revenue != null) {
      t.revenue += r.revenue;
      t.hasRevenue = true;
    }
    if (r.dtcp) {
      t.dtcp += r.dtcp;
      t.apprInDtcp += r.approved; // % chỉ tính trên hợp đồng có giá trị theo DT-CP
    }
    t.approved += r.approved;
    t.n += r.n;
    t.waiting += r.waiting;
  }
  return t;
};
const pctOf = (appr: number, base: number | null | undefined) => (base ? (appr / base) * 100 : null);
const isOver = (r: SumRow) => !!r.dtcp && r.approved > r.dtcp;

export default function SummaryTable({ rows, details, noun, fileName }: { rows: SumRow[]; details: Record<string, ReactNode>; noun: string; fileName: string }) {
  const [kv, setKv] = useState("");
  const [cl, setCl] = useState("");
  const [q, setQ] = useState("");
  const [onlyOver, setOnlyOver] = useState(false);
  const [unit, setUnit] = useState<"tr" | "d">("d"); // mặc định đủ số đến đồng
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const areas = useMemo(() => [...new Set(rows.map((r) => r.area))].sort((a, b) => lastFirst(a, b) || cmp(a, b)), [rows]);
  const clusters = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.cluster && (!kv || r.area === (kv === "~" ? "" : kv))) m.set(r.cluster, r.clusterName);
    return [...m].sort((a, b) => cmp(a[0], b[0]));
  }, [rows, kv]);

  const shown = useMemo(() => {
    const words = normName(q).split(" ").filter(Boolean);
    return rows.filter((r) => {
      if (kv && r.area !== (kv === "~" ? "" : kv)) return false;
      if (cl && (cl === "-" ? !!r.cluster : r.cluster !== cl)) return false;
      if (onlyOver && !isOver(r)) return false;
      if (!words.length) return true;
      const hay = normName([r.cluster, r.clusterName, r.siteCode, r.siteName, r.contractCode, r.contractNo, r.contractTitle, r.packageName].join(" "));
      return words.every((w) => hay.includes(w));
    });
  }, [rows, kv, cl, q, onlyOver]);

  // cây Khu vực → Cụm → Dự án → Hợp đồng (đã lọc)
  const tree = useMemo(() => {
    const byArea = new Map<string, Map<string, Map<string, SumRow[]>>>();
    for (const r of shown) {
      const a = byArea.get(r.area) ?? byArea.set(r.area, new Map()).get(r.area)!;
      const c = a.get(r.cluster) ?? a.set(r.cluster, new Map()).get(r.cluster)!;
      (c.get(r.siteKey) ?? c.set(r.siteKey, []).get(r.siteKey)!).push(r);
    }
    return [...byArea]
      .sort(([a], [b]) => lastFirst(a, b) || cmp(a, b))
      .map(([area, cm]) => ({
        area,
        clusters: [...cm]
          .sort(([a], [b]) => lastFirst(a, b) || cmp(a, b))
          .map(([cluster, sm]) => ({
            cluster,
            sites: [...sm.values()]
              .map((rs) => rs.sort((x, y) => lastFirst(x.contractCode, y.contractCode) || cmp(x.contractCode, y.contractCode) || cmp(x.contractNo, y.contractNo)))
              .sort((x, y) => lastFirst(x[0].siteCode, y[0].siteCode) || cmp(x[0].siteCode, y[0].siteCode) || cmp(x[0].siteName, y[0].siteName)),
          })),
      }));
  }, [shown]);

  const all = totOf(shown);
  const money = (n: number | null | undefined) => (n == null ? "—" : unit === "tr" ? Math.round(n / 1e6).toLocaleString("vi-VN") : Math.round(n).toLocaleString("vi-VN"));
  const kpi = (n: number) => Math.round(n).toLocaleString("vi-VN"); // ô tổng: đủ số đến đồng
  // ---- THU GỌN / MỞ RỘNG từng cấp: khoá nhóm a:<khu vực> · c:<khu vực>|<cụm> · s:<khu vực>|<cụm>|<dự án> ----
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const flip = (k: string) =>
    setClosed((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  // mở đến cấp: 1 = chỉ Khu vực · 2 = Cụm · 3 = Dự án · 4 = Hợp đồng (như nút 1-2-3-4 của Excel)
  const openTo = (level: number) => {
    const n = new Set<string>();
    for (const a of tree) {
      if (level <= 1) n.add(`a:${a.area}`);
      for (const c of a.clusters) {
        if (level <= 2) n.add(`c:${a.area}|${c.cluster}`);
        for (const rs of c.sites) if (level <= 3) n.add(`s:${a.area}|${c.cluster}|${rs[0].siteKey}`);
      }
    }
    setClosed(n);
    if (level < 4) setOpen(new Set());
  };
  const pctText = (p: number | null) => (p == null ? "—" : `${p.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`);
  const pctCls = (p: number | null) => (p == null ? "text-slate-400" : p > 100 ? "text-red-700" : p >= 90 ? "text-amber-700" : "text-emerald-700");
  // GÓI THẦU: tên gói thầu của DT-CP; chưa có thì nội dung hợp đồng theo BẢNG TT DỰ ÁN
  const packageOf = (r: SumRow) => tidyText(r.packageName || r.contractTitle); // viết cùng 1 kiểu: thường, hoa chữ đầu + địa danh / mã
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  // ---- xuất Excel đúng bảng đang xem ----
  const exportExcel = async () => {
    setBusy(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Tổng hợp", { views: [{ state: "frozen", ySplit: 4 }], properties: { outlineProperties: { summaryBelow: false, summaryRight: false } } });
      ws.addRow([`BẢNG TỔNG HỢP ${noun.toUpperCase()} THEO KHU VỰC - CỤM DỰ ÁN - DỰ ÁN - HỢP ĐỒNG`]).font = { bold: true, size: 14 };
      ws.addRow([`Giá trị theo DT-CP: bảng DOANH THU - CHI PHÍ (sau VAT), thời điểm đã duyệt · Đơn vị: đồng · Xuất ngày ${new Date().toLocaleDateString("vi-VN")}`]).font = { italic: true, size: 10 };
      ws.addRow([]);
      const head = ws.addRow(["STT", "Mã cụm", "Mã dự án", "Mã hợp đồng", "Số hợp đồng", "Gói thầu","Giá trị hợp đồng", `${noun} theo DT-CP`, `${noun} đã duyệt`, "% đã duyệt", "Số hồ sơ"]);
      head.font = { bold: true, color: { argb: "FFFFFFFF" } };
      head.eachCell((c) => {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
        c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      });
      const put = (vals: (string | number | null)[], t: Tot | SumRow, fill?: string, bold = false, level = 0) => {
        const isRow = "key" in t;
        const dt = isRow ? t.dtcp : t.dtcp || null;
        const ap = isRow ? t.approved : t.approved;
        const p = pctOf(isRow ? t.approved : t.apprInDtcp, dt);
        const rev = isRow ? t.revenue : t.hasRevenue ? t.revenue : null;
        const row = ws.addRow([...vals, rev, dt, ap, p == null ? null : p / 100, t.n]);
        row.font = { bold };
        row.outlineLevel = level; // Excel có nút +/- thu gọn theo cấp
        if (fill) row.eachCell({ includeEmpty: true }, (c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } }));
        [7, 8, 9].forEach((i) => (row.getCell(i).numFmt = "#,##0"));
        row.getCell(10).numFmt = "0.0%";
        if (p != null && p > 100) row.getCell(10).font = { bold, color: { argb: "FFB91C1C" } };
      };
      put(["", "TỔNG CỘNG", "", "", "", ""], all, "FFE2E8F0", true);
      tree.forEach((a) => {
        put([areaLetter(a.area), areaLabel(a.area).toUpperCase(), "", "", "", ""], totOf(a.clusters.flatMap((c) => c.sites.flat())), "FFE0E7FF", true);
        a.clusters.forEach((c, ic) => {
          put([roman(ic + 1), c.cluster || "", c.cluster ? c.sites[0][0].clusterName : "Không thuộc cụm", "", "", ""], totOf(c.sites.flat()), "FFEDE9FE", true, 1);
          c.sites.forEach((rs, is) => {
            put([String(is + 1), "", rs[0].siteCode, rs[0].siteName, "", ""], totOf(rs), "FFF0FDFA", true, 2);
            rs.forEach((r, ir) => put([`${is + 1}.${ir + 1}`, "", "", r.contractCode, r.contractNo || "Chưa có số hợp đồng", packageOf(r)], r, undefined, false, 3));
          });
        });
      });
      [8, 12, 14, 16, 28, 50, 18, 18, 18, 11, 9].forEach((w, i) => (ws.getColumn(i + 1).width = w));
      ws.getColumn(5).alignment = { wrapText: true, vertical: "top" };
      ws.getColumn(6).alignment = { wrapText: true, vertical: "top" };
      const buf = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileName}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  // ---- ô số / % của 1 dòng ----
  const nums = (t: Tot | SumRow, tone: "head" | "area" | "group" | "row" = "row") => {
    const isRow = "key" in t;
    const dt = isRow ? t.dtcp : t.dtcp || null;
    const p = pctOf(isRow ? t.approved : t.apprInDtcp, dt);
    const rev = isRow ? t.revenue : t.hasRevenue ? t.revenue : null;
    const light = false && tone !== "row"; // tông nhạt: mọi dòng chữ đậm trên nền nhạt
    const pc = light ? (p == null ? "text-white/60" : p > 100 ? "text-red-200" : p >= 90 ? "text-amber-200" : "text-emerald-200") : pctCls(p);
    return (
      <>
        <td className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums">{money(rev)}</td>
        <td className="whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums" title={isRow && t.dtcpSrc === "TH" ? "Sheet DT-CP không có dòng này — lấy tổng sheet TH" : undefined}>
          {money(dt)}
          {isRow && t.dtcpSrc === "TH" && <sup className="ml-0.5 text-[10px] text-slate-400">TH</sup>}
        </td>
        <td className={`whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums ${light ? "" : "text-emerald-800"}`}>{money(t.approved)}</td>
        <td className={`whitespace-nowrap px-1.5 py-1.5 text-right font-semibold tabular-nums ${pc}`}>
          {pctText(p)}
          {p != null && (
            <div className={`mt-1 h-1.5 w-full overflow-hidden rounded-full shadow-inner ${light ? "bg-white/25" : "bg-slate-200"}`}>
              <div className={`h-full rounded-full bg-gradient-to-r ${p > 100 ? "from-red-400 to-red-600" : p >= 90 ? "from-amber-300 to-amber-500" : "from-emerald-400 to-emerald-600"}`} style={{ width: `${Math.min(p, 100)}%` }} />
            </div>
          )}
        </td>
        <td className="whitespace-nowrap px-2 py-1.5 text-right text-xs">
          <b>{t.n}</b>
          {t.waiting > 0 && <span className={`mt-0.5 block w-fit ml-auto rounded-full px-1.5 py-px text-[10px] font-medium ${light ? "bg-amber-300 text-amber-950" : "bg-amber-100 text-amber-800 ring-1 ring-amber-200"}`}>{t.waiting} đang xử lý</span>}
        </td>
      </>
    );
  };
  const th = "sticky top-0 z-10 bg-gradient-to-b from-slate-50 to-slate-200 px-1.5 py-2 text-left text-[11px] font-semibold uppercase leading-tight tracking-wide text-slate-700 shadow-[inset_0_-2px_0_rgba(148,163,184,0.6)]";
  // nút ▸ / ▾ thu gọn - mở rộng 1 nhóm
  const caret = (k: string, cls: string) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        flip(k);
      }}
      className={`mr-1 inline-flex h-4 w-4 items-center justify-center rounded text-[11px] shadow-sm transition hover:scale-110 ${cls}`}
      title={closed.has(k) ? "Mở rộng" : "Thu gọn"}
      aria-label={closed.has(k) ? "Mở rộng" : "Thu gọn"}
    >
      {closed.has(k) ? "▸" : "▾"}
    </button>
  );
  const pAll = pctOf(all.apprInDtcp, all.dtcp);
  const cards: { label: string; value: string; sub: string; cls: string; icon: string }[] = [
    { label: "Giá trị hợp đồng", value: all.hasRevenue ? kpi(all.revenue) : "—", sub: "đồng · theo DT-CP (sau VAT)", cls: "from-sky-50 to-blue-100 shadow-blue-200/70 border-blue-300 text-blue-900 ring-blue-200", icon: "📄" },
    { label: `${noun} theo DT-CP`, value: kpi(all.dtcp), sub: "đồng · thời điểm đã duyệt", cls: "from-violet-50 to-purple-100 shadow-purple-200/70 border-purple-300 text-purple-900 ring-purple-200", icon: "📊" },
    { label: `${noun} đã duyệt`, value: kpi(all.approved), sub: `đồng · ${all.n} hồ sơ${all.waiting ? ` · ${all.waiting} đang xử lý` : ""}`, cls: "from-emerald-50 to-teal-100 shadow-teal-200/70 border-teal-300 text-teal-900 ring-teal-200", icon: "✅" },
    {
      label: "Tỷ lệ đã duyệt",
      value: pctText(pAll),
      sub: "so với giá trị theo DT-CP",
      cls: pAll != null && pAll > 100 ? "from-rose-50 to-red-100 shadow-red-200/70 border-red-300 text-red-900 ring-red-200" : "from-amber-50 to-orange-100 shadow-orange-200/70 border-orange-300 text-orange-900 ring-orange-200",
      icon: "🎯",
    },
  ];

  return (
    <div className="space-y-4">
      {/* 4 ô tổng — nổi 3D */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className={`relative overflow-hidden rounded-xl border-b-4 bg-gradient-to-br px-4 py-3 shadow-md ring-1 transition hover:-translate-y-0.5 hover:shadow-xl ${c.cls}`}>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/70 to-transparent" />
            <div className="pointer-events-none absolute -right-3 -top-3 text-5xl opacity-15">{c.icon}</div>
            <p className="relative text-xs font-semibold uppercase tracking-wide opacity-80">{c.label}</p>
            <p className="relative mt-1 break-all text-xl font-bold tabular-nums drop-shadow-sm xl:text-2xl">{c.value}</p>
            <p className="relative text-[11px] opacity-70">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* bộ lọc + cấp hiển thị */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-gradient-to-b from-white to-slate-50 px-3 py-2 text-sm shadow-sm">
        <select
          className="rounded-md border border-slate-300 bg-white px-2 py-1 shadow-sm"
          value={kv}
          onChange={(e) => {
            setKv(e.target.value);
            setCl("");
          }}
        >
          <option value="">Mọi khu vực</option>
          {areas.map((a) => (
            <option key={a || "~"} value={a || "~"}>
              {areaLabel(a)}
            </option>
          ))}
        </select>
        <select className="max-w-72 rounded-md border border-slate-300 bg-white px-2 py-1 shadow-sm" value={cl} onChange={(e) => setCl(e.target.value)}>
          <option value="">Mọi cụm dự án</option>
          {clusters.map(([c, n]) => (
            <option key={c} value={c}>
              {c} · {n}
            </option>
          ))}
          <option value="-">— Không thuộc cụm —</option>
        </select>
        <input className="w-64 rounded-md border border-slate-300 bg-white px-2 py-1 shadow-sm" placeholder="Tìm mã, tên dự án, số HĐ, gói thầu" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-1 text-slate-700">
          <input type="checkbox" checked={onlyOver} onChange={(e) => setOnlyOver(e.target.checked)} /> Chỉ HĐ vượt DT-CP
        </label>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Hiện đến cấp:</span>
          <span className="inline-flex overflow-hidden rounded-md shadow-sm ring-1 ring-slate-300">
            {[
              [1, "Khu vực"],
              [2, "Cụm"],
              [3, "Dự án"],
              [4, "Hợp đồng"],
            ].map(([lv, name]) => (
              <button key={lv} type="button" onClick={() => openTo(lv as number)} className="border-r border-slate-300 bg-gradient-to-b from-white to-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 last:border-r-0 hover:from-sky-50 hover:to-sky-100 active:translate-y-px" title={`Thu gọn / mở rộng toàn bảng đến cấp ${name}`}>
                {lv}. {name}
              </button>
            ))}
          </span>
          <span className="text-xs text-slate-500">Đơn vị:</span>
          <select className="rounded-md border border-slate-300 bg-white px-1 py-1 text-xs shadow-sm" value={unit} onChange={(e) => setUnit(e.target.value as "tr" | "d")}>
            <option value="d">đồng</option>
            <option value="tr">triệu đồng</option>
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={exportExcel}
            className="rounded-md border border-b-2 border-emerald-300 border-b-emerald-500 bg-gradient-to-b from-emerald-50 to-emerald-100 px-3 py-1 font-medium text-emerald-800 shadow-sm hover:from-emerald-100 hover:to-emerald-200 active:translate-y-px active:border-b disabled:opacity-50"
          >
            {busy ? "Đang xuất…" : "⬇ Xuất Excel"}
          </button>
        </span>
      </div>

      <div className="max-h-[75vh] overflow-auto rounded-xl border border-slate-300 bg-white shadow-xl shadow-slate-300/50">
        <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
          {/* độ rộng cột: số HĐ vừa đủ, GÓI THẦU lấy phần còn lại */}
          <colgroup>
            <col style={{ width: "4.5%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "10.5%" }} />
            <col />
            <col style={{ width: "9.5%" }} />
            <col style={{ width: "9.5%" }} />
            <col style={{ width: "9.5%" }} />
            <col style={{ width: "5.5%" }} />
            <col style={{ width: "6%" }} />
          </colgroup>
          <thead>
            <tr>
              <th className={`${th} rounded-tl-xl`}>STT</th>
              <th className={th}>Mã cụm</th>
              <th className={th}>Mã dự án</th>
              <th className={th}>Mã hợp đồng</th>
              <th className={th}>Số hợp đồng</th>
              <th className={th}>Gói thầu</th>
              <th className={`${th} text-right`}>Giá trị hợp đồng</th>
              <th className={`${th} text-right`}>{noun} theo DT-CP</th>
              <th className={`${th} text-right`}>{noun} đã duyệt</th>
              <th className={`${th} text-right`}>% đã duyệt</th>
              <th className={`${th} rounded-tr-xl text-right`}>Hồ sơ</th>
            </tr>
          </thead>
          <tbody>
            {!shown.length && (
              <tr>
                <td colSpan={11} className="py-6 text-center italic text-slate-500">
                  Không có hợp đồng nào khớp bộ lọc
                </td>
              </tr>
            )}
            {shown.length > 0 && (
              <tr className="bg-gradient-to-r from-slate-200 to-slate-100 font-bold text-slate-900 shadow-sm [&>td]:border-b-2 [&>td]:border-slate-300">
                <td className="px-2 py-2" />
                <td colSpan={5} className="px-2 py-2 tracking-wide">
                  TỔNG CỘNG
                </td>
                {nums(all, "head")}
              </tr>
            )}
            {tree.map((a) => {
              const ka = `a:${a.area}`;
              return (
                <Fragment key={ka}>
                  <tr className="bg-gradient-to-r from-indigo-100 via-indigo-50 to-blue-50 font-semibold text-indigo-950 [&>td]:border-b-2 [&>td]:border-indigo-200 [&>td]:shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                    <td className="px-2 py-2">
                      {caret(ka, "bg-indigo-500 text-white hover:bg-indigo-600")}
                      {areaLetter(a.area)}
                    </td>
                    <td colSpan={5} className="px-2 py-2 uppercase tracking-wide">
                      {areaLabel(a.area)}
                      <span className="ml-2 text-xs font-normal normal-case text-indigo-700/70">
                        {a.clusters.filter((c) => c.cluster).length} cụm · {a.clusters.reduce((t, c) => t + c.sites.length, 0)} dự án
                      </span>
                    </td>
                    {nums(totOf(a.clusters.flatMap((c) => c.sites.flat())), "area")}
                  </tr>
                  {!closed.has(ka) &&
                    a.clusters.map((c, ic) => {
                      const kc = `c:${a.area}|${c.cluster}`;
                      return (
                        <Fragment key={kc}>
                          <tr className="bg-gradient-to-r from-violet-50 to-white font-semibold text-violet-950 [&>td]:border-b [&>td]:border-violet-100 [&>td]:shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                            <td className="whitespace-nowrap px-1.5 py-1.5 pl-2">
                              {caret(kc, "bg-violet-400 text-white hover:bg-violet-500")}
                              {roman(ic + 1)}
                            </td>
                            <td className="whitespace-nowrap px-1.5 py-1.5 font-mono text-[11px]">{c.cluster || "—"}</td>
                            <td colSpan={4} className="px-2 py-1.5">
                              {c.cluster ? c.sites[0][0].clusterName : <span className="font-normal italic text-violet-700/70">Không thuộc cụm</span>}
                              <span className="ml-2 text-xs font-normal text-violet-700/80">{c.sites.length} dự án</span>
                            </td>
                            {nums(totOf(c.sites.flat()), "group")}
                          </tr>
                          {!closed.has(kc) &&
                            c.sites.map((rs, is) => {
                              const ks = `s:${a.area}|${c.cluster}|${rs[0].siteKey}`;
                              return (
                                <Fragment key={ks}>
                                  <tr className="bg-gradient-to-r from-teal-50/60 to-white font-medium text-teal-950 [&>td]:border-b [&>td]:border-teal-50">
                                    <td className="whitespace-nowrap px-1.5 py-1.5 pl-4">
                                      {caret(ks, "bg-teal-400 text-white hover:bg-teal-500")}
                                      {is + 1}
                                    </td>
                                    <td />
                                    <td className="whitespace-nowrap px-1.5 py-1.5 font-mono text-[11px]">{rs[0].siteCode || <span className="rounded bg-red-100 px-1 font-sans text-[11px] text-red-700">chưa gắn mã</span>}</td>
                                    <td colSpan={3} className="px-2 py-1.5">
                                      {rs[0].siteName}
                                      <span className="ml-2 text-xs font-normal text-teal-700/80">{rs.length} hợp đồng</span>
                                    </td>
                                    {nums(totOf(rs), "group")}
                                  </tr>
                                  {!closed.has(ks) &&
                                    rs.map((r, ir) => (
                                      <Fragment key={r.key}>
                                        <tr
                                          onClick={() => toggle(r.key)}
                                          className={`cursor-pointer align-top transition [&>td]:border-b [&>td]:border-slate-100 ${open.has(r.key) ? "bg-sky-50 shadow-inner" : isOver(r) ? "bg-red-50/50 hover:bg-red-50" : "bg-white hover:bg-sky-50/70"}`}
                                          title="Bấm để xem / ẩn danh sách hồ sơ"
                                        >
                                          <td className="whitespace-nowrap px-1.5 py-1.5 pl-6 text-slate-500">
                                            <span className="mr-1 inline-block w-2 text-sky-600">{open.has(r.key) ? "▾" : "▸"}</span>
                                            {is + 1}.{ir + 1}
                                          </td>
                                          <td />
                                          <td />
                                          <td className="whitespace-nowrap px-1.5 py-1.5">{r.contractCode ? <span className="rounded bg-violet-100 px-1 py-px font-mono text-[11px] font-semibold text-violet-800 ring-1 ring-violet-200">{r.contractCode}</span> : <span className="text-slate-400">—</span>}</td>
                                          <td className="break-words px-2 py-1.5">{r.contractNo ? <span className="font-medium text-slate-800">{r.contractNo}</span> : <span className="italic text-amber-700">Chưa có số hợp đồng</span>}</td>
                                          <td className="px-2 py-1.5 text-xs text-slate-600">
                                            {packageOf(r) || "—"}
                                            {!r.hasDtcp && r.contractNo && <span className="block text-[11px] text-amber-700">chưa có DT-CP trên phần mềm</span>}
                                          </td>
                                          {nums(r)}
                                        </tr>
                                        {open.has(r.key) && (
                                          <tr className="bg-sky-50/60">
                                            <td colSpan={11} className="border-b border-sky-200 px-3 pb-3 pt-1 shadow-inner">
                                              <div className="rounded-lg border border-sky-200 bg-white shadow-md">{details[r.key]}</div>
                                            </td>
                                          </tr>
                                        )}
                                      </Fragment>
                                    ))}
                                </Fragment>
                              );
                            })}
                        </Fragment>
                      );
                    })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Giá trị hợp đồng và {noun.toLowerCase()} theo DT-CP lấy ở bảng DOANH THU - CHI PHÍ của sheet DT-CP (sau VAT), thời điểm đã duyệt; số có dấu <sup>TH</sup> là tổng sheet TH khi DT-CP
        không có dòng đó. % đã duyệt = đã duyệt ÷ theo DT-CP (dòng tổng chỉ tính hợp đồng có DT-CP) · <span className="text-emerald-700">xanh</span> &lt; 90% ·{" "}
        <span className="text-amber-700">vàng</span> 90–100% · <span className="text-red-700">đỏ</span> vượt DT-CP. Nút ▸ / ▾ ở mỗi dòng nhóm để thu gọn / mở rộng; file Excel xuất ra cũng có nút +/- theo cấp.
      </p>
    </div>
  );
}
