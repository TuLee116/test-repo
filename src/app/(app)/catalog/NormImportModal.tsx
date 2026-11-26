"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { importNormsAction, type NormImportGroup } from "@/lib/actions";
import { ColSelect, colOptions, columnPreviewLabel, rowOptions, rowPreviewLabel, type SheetInfo } from "../projects/[id]/import/ImportWizard";

type Group = NormImportGroup & { exists: boolean };
const CAT_TITLE = { VT: "Vật tư", NC: "Nhân công", TB: "Máy" } as const;

// Quản trị viên nhập định mức mới từ file Excel: mỗi dòng Excel = 1 dòng hao phí; các cột mã / tên / ĐVT của công tác có thể chỉ ghi ở dòng đầu nhóm.
export default function NormImportModal() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<"loading" | "sheet" | "mapping" | "review" | "done">("loading");
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [sheet, setSheet] = useState<SheetInfo | null>(null);
  const [startRow, setStartRow] = useState(2);
  const [cols, setCols] = useState({ colCode: 0, colName: 0, colUnit: 0, colCat: 0, colResCode: 0, colResName: 0, colResUnit: 0, colQty: 0 });
  const [groups, setGroups] = useState<Group[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [mode, setMode] = useState<"skip" | "replace">("skip");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  const setCol = (k: keyof typeof cols) => (v: number) => setCols((p) => ({ ...p, [k]: v }));

  function close() {
    setOpen(false);
    setFile(null);
    setStep("loading");
    setError("");
  }

  async function onFile(f: File) {
    setFile(f);
    setOpen(true);
    setStep("loading");
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/import/inspect", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không đọc được file");
      setSheets(data.sheets);
      if (data.sheets.length === 1) choose(data.sheets[0]);
      else setStep("sheet");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    }
  }

  function choose(s: SheetInfo) {
    setSheet(s);
    setStartRow(2);
    setCols({ colCode: 0, colName: 0, colUnit: 0, colCat: 0, colResCode: 0, colResName: 0, colResUnit: 0, colQty: 0 });
    setStep("mapping");
  }

  async function parse() {
    if (!file || !sheet) return;
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("sheetName", sheet.name);
      fd.append("startRow", String(startRow));
      for (const [k, v] of Object.entries(cols)) fd.append(k, String(v));
      const res = await fetch("/api/import/norms-parse", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi đọc file");
      setGroups(data.groups as Group[]);
      setWarnings(data.warnings as string[]);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    setError("");
    try {
      const res = await importNormsAction(groups.map(({ code, name, unit, lines }) => ({ code, name, unit, lines })), mode);
      if (!res.ok) throw new Error(res.error ?? "Lỗi");
      setResult(`Đã thêm ${res.created} định mức mới, ghi đè ${res.replaced}, bỏ qua ${res.skipped} (mã đã có).`);
      setStep("done");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    } finally {
      setBusy(false);
    }
  }

  const label = (n: number) => (sheet ? columnPreviewLabel(sheet, startRow, n) : "");
  const newCount = groups.filter((g) => !g.exists).length;
  const existCount = groups.length - newCount;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <button type="button" onClick={() => inputRef.current?.click()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
        ＋ Thêm định mức từ Excel
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="my-6 w-full max-w-6xl rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Thêm định mức từ Excel</h2>
              <button type="button" onClick={close} className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                ✕
              </button>
            </div>
            {error && <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            {step === "loading" && !error && <p className="mt-6 text-center text-sm text-slate-500">Đang đọc file {file?.name}...</p>}

            {step === "sheet" && (
              <div className="mt-4 space-y-2">
                <h3 className="font-medium">Chọn sheet chứa định mức</h3>
                {sheets.map((s) => (
                  <button key={s.name} onClick={() => choose(s)} className="block w-full rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50">
                    <span className="font-medium">{s.name}</span> <span className="text-slate-400">({s.rowCount} dòng)</span>
                  </button>
                ))}
              </div>
            )}

            {step === "mapping" && sheet && (
              <div className="mt-4">
                <h3 className="font-medium text-slate-900">Chọn cột — sheet &quot;{sheet.name}&quot;</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Mỗi dòng Excel là <b>một dòng hao phí</b> (vật tư / nhân công / máy) của một công tác. Mã, tên, ĐVT công tác chỉ cần ghi ở dòng đầu của nhóm, các dòng sau để trống. Cột Loại ghi VT / NC / TB hoặc Vật tư / Nhân công / Máy (dòng để trống lấy theo dòng trên). Đánh dấu * là bắt buộc.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <ColSelect label="Dòng bắt đầu dữ liệu" value={startRow} onChange={setStartRow} options={rowOptions(sheet.rowCount)} optionLabels={(n) => rowPreviewLabel(sheet, n)} />
                  <ColSelect label="Cột Mã định mức *" value={cols.colCode} onChange={setCol("colCode")} options={colOptions(sheet.colCount)} optionLabels={label} />
                  <ColSelect label="Cột Tên công tác *" value={cols.colName} onChange={setCol("colName")} options={colOptions(sheet.colCount)} optionLabels={label} />
                  <ColSelect label="Cột ĐVT công tác" value={cols.colUnit} onChange={setCol("colUnit")} options={colOptions(sheet.colCount)} optionLabels={label} allowNone />
                  <ColSelect label="Cột Loại hao phí *" value={cols.colCat} onChange={setCol("colCat")} options={colOptions(sheet.colCount)} optionLabels={label} />
                  <ColSelect label="Cột Mã vật tư/NC/máy" value={cols.colResCode} onChange={setCol("colResCode")} options={colOptions(sheet.colCount)} optionLabels={label} allowNone />
                  <ColSelect label="Cột Tên vật tư/NC/máy *" value={cols.colResName} onChange={setCol("colResName")} options={colOptions(sheet.colCount)} optionLabels={label} allowNone />
                  <ColSelect label="Cột ĐVT hao phí" value={cols.colResUnit} onChange={setCol("colResUnit")} options={colOptions(sheet.colCount)} optionLabels={label} allowNone />
                  <ColSelect label="Cột Định mức *" value={cols.colQty} onChange={setCol("colQty")} options={colOptions(sheet.colCount)} optionLabels={label} />
                </div>
                <div className="mt-3 overflow-x-auto rounded-md border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        {sheet.preview[0]?.map((_, c) => (
                          <th key={c} className="whitespace-nowrap px-2 py-1 text-left font-medium text-slate-500">
                            Cột {c + 1}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sheet.preview.map((r, ri) => (
                        <tr key={ri} className={`border-t border-slate-100 ${ri + 1 === startRow ? "bg-amber-50" : ""}`}>
                          {r.map((c, ci) => (
                            <td key={ci} className="max-w-[160px] truncate px-2 py-1 text-slate-600">
                              {c}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 flex gap-2">
                  <button onClick={close} className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">
                    Đóng
                  </button>
                  <button onClick={parse} disabled={busy} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
                    {busy ? "Đang đọc..." : "Đọc file & xem trước"}
                  </button>
                </div>
              </div>
            )}

            {step === "review" && (
              <div className="mt-4">
                <h3 className="font-medium text-slate-900">
                  Đọc được {groups.length} công tác — {newCount} mới, {existCount} đã có mã trong danh mục
                </h3>
                {warnings.length > 0 && (
                  <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {warnings.map((w, i) => (
                      <div key={i}>⚠ {w}</div>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={mode === "skip"} onChange={() => setMode("skip")} /> Mã đã có: <b>bỏ qua</b> (chỉ thêm công tác mới)
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} /> Mã đã có: <b>ghi đè</b> toàn bộ hao phí
                  </label>
                </div>
                <div className="mt-3 max-h-[50vh] overflow-auto rounded-md border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-green-100 text-left text-slate-900">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">Mã ĐM</th>
                        <th className="px-2 py-1.5 font-medium">Công tác</th>
                        <th className="px-2 py-1.5 font-medium">ĐVT</th>
                        <th className="px-2 py-1.5 font-medium">Hao phí (VT / NC / Máy)</th>
                        <th className="px-2 py-1.5 font-medium">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((g, i) => (
                        <tr key={i} className="border-t border-slate-100 align-top">
                          <td className="px-2 py-1 font-medium">{g.code}</td>
                          <td className="px-2 py-1">{g.name}</td>
                          <td className="px-2 py-1">{g.unit}</td>
                          <td className="px-2 py-1 text-slate-600">
                            {g.lines.length === 0
                              ? "—"
                              : (["VT", "NC", "TB"] as const)
                                  .map((c) => [c, g.lines.filter((l) => l.category === c)] as const)
                                  .filter(([, l]) => l.length)
                                  .map(([c, l]) => `${CAT_TITLE[c]}: ${l.length}`)
                                  .join(" · ")}
                          </td>
                          <td className="px-2 py-1">
                            {g.exists ? <span className="rounded bg-amber-100 px-1.5 text-amber-800">đã có mã</span> : <span className="rounded bg-emerald-100 px-1.5 text-emerald-800">mới</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 flex gap-2">
                  <button onClick={() => setStep("mapping")} className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">
                    Quay lại
                  </button>
                  <button onClick={apply} disabled={busy || groups.length === 0} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
                    {busy ? "Đang nhập..." : `Nhập ${mode === "skip" ? newCount : groups.length} công tác`}
                  </button>
                </div>
              </div>
            )}

            {step === "done" && (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-6 text-center">
                <p className="text-sm font-medium text-green-800">{result}</p>
                <button onClick={close} className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
                  Đóng
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
