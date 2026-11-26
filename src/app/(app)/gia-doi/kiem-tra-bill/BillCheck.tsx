"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { billCheckAction, billPreviewAction, billSheetsAction, type BillCheck as Check, type BillPreview, type BillStatus } from "@/lib/kiem-tra-bill";

type Contract = { id: string; area: string; name: string; packageName: string; contractNo: string; appendixNo: string };

const money = (n: number) => Math.round(n).toLocaleString("vi-VN");
const letter = (n: number) => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};
const STATUS: Record<BillStatus, { label: string; cls: string; chip: string }> = {
  MATCH: { label: "✅ Đã duyệt, khớp giá", cls: "bg-emerald-50", chip: "border-emerald-400 bg-emerald-50 text-emerald-800" },
  DIFF: { label: "⚠️ Đã duyệt nhưng lệch giá", cls: "bg-amber-50", chip: "border-amber-400 bg-amber-50 text-amber-800" },
  PENDING: { label: "⏳ Đang chờ duyệt", cls: "bg-sky-50", chip: "border-sky-400 bg-sky-50 text-sky-800" },
  NONE: { label: "❌ Chưa duyệt", cls: "bg-red-50", chip: "border-red-400 bg-red-50 text-red-800" },
};
const ORDER: BillStatus[] = ["MATCH", "DIFF", "PENDING", "NONE"];
const sel = "rounded border border-slate-300 bg-white px-2 py-1 text-sm";

export default function BillCheck({ contracts }: { contracts: Contract[] }) {
  const [pending, start] = useTransition();
  const [area, setArea] = useState("");
  const [project, setProject] = useState("");
  const [contractId, setContractId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheet, setSheet] = useState("");
  const [pv, setPv] = useState<BillPreview | null>(null);
  const [cols, setCols] = useState({ nameCol: 0, unitCol: 0, priceCol: 0, startRow: 1 });
  const [check, setCheck] = useState<Check | null>(null);
  const [filter, setFilter] = useState<BillStatus | "">("");
  const fileRef = useRef<HTMLInputElement>(null);

  const areas = useMemo(() => [...new Set(contracts.map((c) => c.area))].sort(), [contracts]);
  const projects = useMemo(() => [...new Set(contracts.filter((c) => c.area === area).map((c) => c.name))].sort((a, b) => a.localeCompare(b, "vi")), [contracts, area]);
  const hds = useMemo(() => contracts.filter((c) => c.area === area && c.name === project), [contracts, area, project]);

  const resetFile = () => {
    setFile(null);
    setSheets([]);
    setSheet("");
    setPv(null);
    setCheck(null);
    setFilter("");
    if (fileRef.current) fileRef.current.value = "";
  };
  const loadPreview = (f: File, sh: string) =>
    start(async () => {
      const fd = new FormData();
      fd.set("file", f);
      const r = await billPreviewAction(fd, sh);
      if (!r.ok) return window.alert(r.error);
      setPv(r.preview);
      setCols(r.preview.guess);
      setCheck(null);
    });
  const onFile = (f: File) =>
    start(async () => {
      setCheck(null);
      setPv(null);
      const fd = new FormData();
      fd.set("file", f);
      const r = await billSheetsAction(fd);
      if (!r.ok) {
        resetFile();
        return window.alert(r.error);
      }
      setFile(f);
      setSheets(r.sheets);
      setSheet(r.sheets[0]);
      loadPreview(f, r.sheets[0]);
    });
  const run = () => {
    if (!file) return;
    if (!contractId) return window.alert("Chọn hợp đồng trước");
    if (!cols.nameCol || !cols.priceCol) return window.alert("Chọn cột Nội dung và cột Đơn giá");
    start(async () => {
      const fd = new FormData();
      fd.set("file", file);
      const r = await billCheckAction(fd, { contractId, sheet, ...cols });
      if (!r.ok) return window.alert(r.error);
      setCheck(r.check);
      setFilter("");
    });
  };

  const counts = useMemo(() => {
    const c: Record<BillStatus, number> = { MATCH: 0, DIFF: 0, PENDING: 0, NONE: 0 };
    for (const x of check?.results ?? []) c[x.status]++;
    return c;
  }, [check]);
  const shown = (check?.results ?? []).filter((x) => !filter || x.status === filter);
  const colOpts = (pv: BillPreview) => Array.from({ length: pv.maxCol }, (_, i) => i + 1);
  const colName = (c: number) => (c ? `Cột ${letter(c)}` : "— không —");

  return (
    <div className="space-y-4">
      <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <label className="text-sm">
          <span className="font-medium text-slate-700">1. Khu vực</span>
          <select className={`${sel} mt-1 w-full`} value={area} onChange={(e) => { setArea(e.target.value); setProject(""); setContractId(""); }}>
            <option value="">— chọn khu vực —</option>
            {areas.map((a) => (
              <option key={a} value={a}>
                {a ? `Khu vực ${a}` : "Chưa chọn khu vực"}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="font-medium text-slate-700">2. Dự án</span>
          <select className={`${sel} mt-1 w-full`} value={project} disabled={!projects.length} onChange={(e) => { setProject(e.target.value); setContractId(""); }}>
            <option value="">— chọn dự án —</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="font-medium text-slate-700">3. Hợp đồng</span>
          <select className={`${sel} mt-1 w-full`} value={contractId} disabled={!hds.length} onChange={(e) => { setContractId(e.target.value); setCheck(null); }}>
            <option value="">— chọn hợp đồng —</option>
            {hds.map((h) => (
              <option key={h.id} value={h.id}>
                {[h.contractNo || "(chưa có số HĐ)", h.appendixNo, h.packageName].filter(Boolean).join(" — ")}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-slate-700">4. File Excel Bill</span>
          <input ref={fileRef} type="file" accept=".xlsx" disabled={pending} className="text-sm" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          {file && (
            <button type="button" onClick={resetFile} className="text-xs text-slate-500 underline">
              bỏ file
            </button>
          )}
          {pending && <span className="text-xs text-slate-500">Đang xử lý…</span>}
        </div>

        {pv && file && (
          <>
            <div className="flex flex-wrap items-end gap-3 text-sm">
              {sheets.length > 1 && (
                <label>
                  <span className="block text-xs text-slate-500">Sheet</span>
                  <select className={sel} value={sheet} onChange={(e) => { setSheet(e.target.value); loadPreview(file, e.target.value); }}>
                    {sheets.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                <span className="block text-xs text-slate-500">Cột NỘI DUNG *</span>
                <select className={sel} value={cols.nameCol} onChange={(e) => setCols({ ...cols, nameCol: +e.target.value })}>
                  <option value={0}>— chọn —</option>
                  {colOpts(pv).map((c) => <option key={c} value={c}>{colName(c)}</option>)}
                </select>
              </label>
              <label>
                <span className="block text-xs text-slate-500">Cột ĐVT</span>
                <select className={sel} value={cols.unitCol} onChange={(e) => setCols({ ...cols, unitCol: +e.target.value })}>
                  <option value={0}>— không có —</option>
                  {colOpts(pv).map((c) => <option key={c} value={c}>{colName(c)}</option>)}
                </select>
              </label>
              <label>
                <span className="block text-xs text-slate-500">Cột ĐƠN GIÁ *</span>
                <select className={sel} value={cols.priceCol} onChange={(e) => setCols({ ...cols, priceCol: +e.target.value })}>
                  <option value={0}>— chọn —</option>
                  {colOpts(pv).map((c) => <option key={c} value={c}>{colName(c)}</option>)}
                </select>
              </label>
              <label>
                <span className="block text-xs text-slate-500">Đọc từ dòng</span>
                <input type="number" min={1} className={`${sel} w-20`} value={cols.startRow} onChange={(e) => setCols({ ...cols, startRow: Math.max(1, +e.target.value || 1) })} />
              </label>
              <button type="button" disabled={pending} onClick={run} className="rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50">
                Kiểm tra Bill
              </button>
            </div>

            <div className="max-h-72 overflow-auto rounded border border-slate-200">
              <table className="min-w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-100">
                  <tr>
                    <th className="border border-slate-200 px-1 py-0.5 text-slate-400">Dòng</th>
                    {colOpts(pv).map((c) => {
                      const role = c === cols.nameCol ? "Nội dung" : c === cols.unitCol ? "ĐVT" : c === cols.priceCol ? "Đơn giá" : "";
                      return (
                        <th key={c} className={`border border-slate-200 px-1 py-0.5 ${role ? "bg-sky-200 text-sky-900" : "text-slate-500"}`}>
                          {letter(c)}
                          {role && <span className="block text-[10px] font-semibold">{role}</span>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {pv.rows.map((r) => (
                    <tr key={r.row} className={r.row < cols.startRow ? "text-slate-400" : ""}>
                      <td className="border border-slate-200 px-1 py-0.5 text-center text-slate-400">{r.row}</td>
                      {r.cells.map((t, i) => (
                        <td key={i} className={`max-w-[220px] truncate border border-slate-200 px-1 py-0.5 ${[cols.nameCol, cols.unitCol, cols.priceCol].includes(i + 1) ? "bg-sky-50" : ""}`}>
                          {t}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500">Đã tự đoán cột theo dòng tiêu đề — sai thì chọn lại. Dòng xám (trước dòng bắt đầu) không được đọc. Dòng/cột ẩn trong Excel được bỏ qua.</p>
          </>
        )}
      </section>

      {check && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {ORDER.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(filter === s ? "" : s)}
                className={`rounded-full border px-3 py-1 text-sm ${STATUS[s].chip} ${filter === s ? "ring-2 ring-slate-500" : ""}`}
              >
                {STATUS[s].label}: <b>{counts[s]}</b>
              </button>
            ))}
            <span className="text-xs text-slate-500">
              {check.results.length} dòng Bill{check.skipped ? ` · bỏ qua ${check.skipped} dòng không có đơn giá` : ""}
            </span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-600">
                <tr>
                  <th className="px-2 py-2">Dòng</th>
                  <th className="px-2 py-2">Nội dung (Bill)</th>
                  <th className="px-2 py-2">ĐVT</th>
                  <th className="px-2 py-2 text-right">Đơn giá Bill</th>
                  <th className="px-2 py-2">Kết quả</th>
                  <th className="px-2 py-2">Giá đã duyệt</th>
                  <th className="px-2 py-2">Đang chờ duyệt (đã trình TP)</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((x) => (
                  <tr key={x.row} className={`border-t border-slate-100 align-top ${STATUS[x.status].cls}`}>
                    <td className="px-2 py-1.5 text-slate-400">{x.row}</td>
                    <td className="px-2 py-1.5">
                      {x.name}
                      {x.matchedName && <span className="block text-xs text-slate-500">≈ khớp với: {x.matchedName}</span>}
                    </td>
                    <td className="px-2 py-1.5">{x.unit}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(x.price)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-medium">{STATUS[x.status].label}</td>
                    <td className="px-2 py-1.5 text-xs">
                      {x.approved.map((a, i) => (
                        <div key={i} className={Math.abs(a.price - x.price) <= 0.5 ? "font-semibold text-emerald-700" : ""}>
                          {money(a.price)} <span className="text-slate-500">({a.date}, {a.code})</span>
                        </div>
                      ))}
                    </td>
                    <td className="px-2 py-1.5 text-xs">
                      {x.pending.map((a, i) => (
                        <div key={i}>
                          {money(a.price)} <span className="text-slate-500">({a.code}{a.revision > 1 ? `, lần ${a.revision}` : ""})</span>
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
