"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { applySubQuoteAction } from "@/lib/actions";
import { normalizeText } from "@/lib/text-normalize";
import { ColSelect, colOptions, columnPreviewLabel, rowOptions, rowPreviewLabel, type SheetInfo } from "./import/ImportWizard";
import { fmtQty } from "@/lib/fmt-qty";
import NumInput from "@/app/(app)/NumInput";
import { unitFactor, unitMismatch } from "@/lib/unit-convert";

// Nhập báo giá / hợp đồng của 1 thầu phụ từ Excel: chọn thầu phụ → đọc file → tự khớp từng dòng báo giá với dòng
// thầu phụ đang giao (ưu tiên dòng của đúng thầu phụ đó) → bảng so sánh đơn giá báo giá với đơn giá đang giao, SL,
// ĐVT, thành tiền → người dùng sửa gán / bỏ chọn dòng rồi xác nhận mới ghi đơn giá vào sheet Thầu phụ.

type Target = { id: string; stt: string; name: string; unit: string; qty: number; linked: boolean; contractor: string; price: number };
type QuoteRow = { rowIndex: number; desc: string; unit: string; qty: number; price: number };
type Review = QuoteRow & { target: string; on: boolean; conv?: number }; // target: "" = bỏ qua, "NEW" = thêm dòng mới, còn lại = id dòng thầu phụ; conv: hệ số quy đổi tự nhập

// Quy đổi ĐVT báo giá → ĐVT dòng thầu phụ: 1 ĐVT dòng thầu phụ = k ĐVT báo giá (VD dòng tính Tấn, báo giá theo kg → k = 1000:
// đơn giá = giá/kg × 1000, khối lượng = kg / 1000). Người dùng tự nhập hệ số thì dùng hệ số đó.
const convOf = (r: { unit: string; conv?: number }, t?: { unit: string }) => (r.conv && r.conv > 0 ? r.conv : t ? unitFactor(t.unit, r.unit) : 1);

const fmt = (n: number) => Math.round(n).toLocaleString("vi-VN");
const PORTION_RE = /\s*\(phần giao thầu phụ \d+\/\d+\)\s*$/;
const baseName = (s: string) => s.replace(PORTION_RE, "");
const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase("vi") === b.trim().toLocaleLowerCase("vi");
const normUnit = (u: string) => normalizeText(u).replace(/\s+/g, "").replace(/^m(\d)$/, "m$1");

// Độ giống nhau giữa 2 mô tả (0..1): trùng hoàn toàn = 1, còn lại theo tỷ lệ từ chung (Dice)
function similarity(a: string, b: string): number {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const tx = new Set(x.split(" "));
  const ty = new Set(y.split(" "));
  let common = 0;
  for (const t of tx) if (ty.has(t)) common++;
  return (2 * common) / (tx.size + ty.size);
}

// Khớp 1-1: chấm điểm mọi cặp (dòng báo giá, dòng thầu phụ) theo mô tả + ĐVT + SL, ưu tiên dòng của đúng thầu phụ
// đang nhập (dòng của thầu phụ khác chỉ khớp khi mô tả rất giống), rồi gán lần lượt từ cặp điểm cao nhất.
export function autoMatch(rows: QuoteRow[], targets: Target[], contractor: string): string[] {
  const pairs: { i: number; t: string; s: number }[] = [];
  rows.forEach((r, i) => {
    for (const t of targets) {
      let s = similarity(r.desc, baseName(t.name));
      const unitOk = !!r.unit && !!t.unit && (normUnit(r.unit) === normUnit(t.unit) || !unitMismatch(t.unit, r.unit));
      const q = r.qty / convOf(r, t);
      const qtyOk = r.qty > 0 && t.qty > 0 && Math.abs(q - t.qty) <= Math.max(0.01, t.qty * 0.01);
      // mô tả viết gọn hơn (VD "Cốt thép cột D>=10") vẫn nhận nếu trùng cả SL lẫn ĐVT
      if (s < (qtyOk && unitOk ? 0.25 : 0.5)) continue;
      if (unitOk) s += 0.1;
      if (qtyOk) s += 0.15;
      if (contractor) {
        if (sameName(t.contractor, contractor)) s += 0.3;
        else if (t.contractor) s -= 0.3;
      }
      if (s >= 0.6) pairs.push({ i, t: t.id, s });
    }
  });
  pairs.sort((a, b) => b.s - a.s || a.i - b.i);
  const out = rows.map(() => "");
  const taken = new Set<string>();
  for (const p of pairs) {
    if (out[p.i] || taken.has(p.t)) continue;
    out[p.i] = p.t;
    taken.add(p.t);
  }
  return out;
}

export default function QuoteImport({ projectId, targets }: { projectId: string; targets: Target[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<"loading" | "sheet" | "mapping" | "review" | "done">("loading");
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [sheet, setSheet] = useState<SheetInfo | null>(null);
  const [startRow, setStartRow] = useState(2);
  const [colDesc, setColDesc] = useState(0);
  const [colUnit, setColUnit] = useState(0);
  const [colQty, setColQty] = useState(0);
  const [colPrice, setColPrice] = useState(0);
  const [colTotal, setColTotal] = useState(0);
  const [contractor, setContractor] = useState("");
  const [rows, setRows] = useState<Review[]>([]);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  const contractors = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of targets) if (t.contractor) m.set(t.contractor, (m.get(t.contractor) ?? 0) + 1);
    return [...m.entries()];
  }, [targets]);
  const targetById = useMemo(() => new Map(targets.map((t) => [t.id, t])), [targets]);
  // danh sách chọn "Gán vào": dòng của thầu phụ đang nhập lên đầu
  const options = useMemo(() => {
    const mine = targets.filter((t) => contractor && sameName(t.contractor, contractor));
    return { mine, others: targets.filter((t) => !mine.includes(t)) };
  }, [targets, contractor]);

  const chooseSheet = (s: SheetInfo) => {
    setSheet(s);
    setColDesc(0);
    setColUnit(0);
    setColQty(0);
    setColPrice(0);
    setColTotal(0);
    setStartRow(2);
    setStep("mapping");
  };

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
      if (data.sheets.length === 1) chooseSheet(data.sheets[0]);
      else setStep("sheet");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    }
  }

  const rematch = (list: QuoteRow[], name: string) => {
    const m = autoMatch(list, targets, name.trim());
    setRows(list.map((r, i) => ({ ...r, target: m[i], on: !!m[i] })));
  };

  async function parse() {
    if (!file || !sheet || !colDesc || (!colPrice && !colTotal)) {
      setError("Cần chọn cột Nội dung và cột Đơn giá (hoặc Thành tiền)");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("sheetName", sheet.name);
      fd.append("startRow", String(startRow));
      fd.append("colDesc", String(colDesc));
      fd.append("colUnit", String(colUnit));
      fd.append("colQty", String(colQty));
      fd.append("colPrice", String(colPrice));
      fd.append("colTotal", String(colTotal));
      const res = await fetch("/api/import/quote-parse", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi đọc báo giá");
      rematch(data.rows as QuoteRow[], contractor);
      setOnlyDiff(false);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    } finally {
      setBusy(false);
    }
  }

  const patch = (idx: number, p: Partial<Review>) => setRows((list) => list.map((r, i) => (i === idx ? { ...r, ...p } : r)));
  const used = new Map<string, number>();
  for (const r of rows) if (r.on && r.target && r.target !== "NEW") used.set(r.target, (used.get(r.target) ?? 0) + 1);
  const applied = rows.filter((r) => r.on && r.target);
  const matched = applied.filter((r) => r.target !== "NEW").length;
  const news = applied.filter((r) => r.target === "NEW").length;
  const changed = rows.filter((r) => {
    const t = r.target && r.target !== "NEW" ? targetById.get(r.target) : undefined;
    return t && Math.abs(r.price * convOf(r, t) - t.price) > 0.5;
  }).length;
  // dòng của thầu phụ đang nhập nhưng không có trong báo giá (để kiểm tra sót)
  const missing = contractor ? options.mine.filter((t) => !used.has(t.id)) : [];
  const totalNew = applied.reduce((s, r) => {
    const t = r.target !== "NEW" ? targetById.get(r.target) : undefined;
    const k = convOf(r, t);
    return s + r.price * k * (t ? (t.linked ? t.qty : r.qty / k || t.qty) : r.qty / k);
  }, 0);
  const totalOld = applied.reduce((s, r) => {
    const t = r.target !== "NEW" ? targetById.get(r.target) : undefined;
    return s + (t ? t.price * t.qty : 0);
  }, 0);

  async function apply() {
    setBusy(true);
    setError("");
    try {
      const res = await applySubQuoteAction(projectId, {
        contractorName: contractor.trim(),
        updates: applied
          .filter((r) => r.target !== "NEW")
          .map((r) => {
            const k = convOf(r, targetById.get(r.target));
            return { id: r.target, unitPrice: r.price * k, quantity: r.qty > 0 ? r.qty / k : undefined };
          }),
        creates: applied.filter((r) => r.target === "NEW").map((r) => ({ name: r.desc, unit: r.unit, quantity: r.qty, unitPrice: r.price })),
      });
      setResult(`Đã nhập đơn giá ${res.updated} dòng${res.created ? `, thêm mới ${res.created} dòng` : ""}${contractor.trim() ? ` cho thầu phụ "${contractor.trim()}"` : ""}.`);
      setStep("done");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi áp báo giá");
    } finally {
      setBusy(false);
    }
  }

  const contractorPicker = (onPick?: (name: string) => void) => (
    <div>
      <label className="block text-[11px] font-medium text-slate-700">Báo giá của thầu phụ</label>
      <div className="flex items-center gap-1">
        <input
          list="quote-contractors"
          value={contractor}
          onChange={(e) => setContractor(e.target.value)}
          onBlur={(e) => onPick?.(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          title="Đổi thầu phụ ở bước so sánh: hệ thống khớp lại các dòng theo thầu phụ mới"
          placeholder="Chọn / gõ tên thầu phụ"
          className="w-64 rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <datalist id="quote-contractors">
          {contractors.map(([n]) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </div>
    </div>
  );

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
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        title="Nhập file báo giá / hợp đồng của 1 thầu phụ, so sánh với đơn giá đang giao rồi tự điền đơn giá"
        className="rounded border border-emerald-600 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
      >
        Nhập báo giá thầu phụ từ Excel
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="my-4 w-full max-w-[96vw] rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Nhập báo giá thầu phụ từ Excel</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                ✕
              </button>
            </div>
            {error && <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

            {step === "loading" && !error && <p className="mt-6 text-center text-sm text-slate-500">Đang đọc file {file?.name}...</p>}

            {step === "sheet" && (
              <div className="mt-4 space-y-2">
                <h3 className="font-medium">Chọn sheet chứa báo giá</h3>
                {sheets.map((s) => (
                  <button key={s.name} onClick={() => chooseSheet(s)} className="block w-full rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50">
                    <span className="font-medium">{s.name}</span> <span className="text-slate-400">({s.rowCount} dòng)</span>
                  </button>
                ))}
              </div>
            )}

            {step === "mapping" && sheet && (
              <div className="mt-4">
                <div className="mb-3">{contractorPicker()}</div>
                <h3 className="font-medium text-slate-900">Chọn cột — sheet &quot;{sheet.name}&quot;</h3>
                <p className="mt-1 text-xs text-slate-500">Chọn cột Nội dung và cột Đơn giá (nếu file chỉ có Thành tiền thì chọn thêm cột Số lượng, hệ thống tự chia ra đơn giá).</p>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-6">
                  <ColSelect label="Dòng bắt đầu" value={startRow} onChange={setStartRow} options={rowOptions(sheet.rowCount)} optionLabels={(n) => rowPreviewLabel(sheet, n)} />
                  <ColSelect label="Cột Nội dung *" value={colDesc} onChange={setColDesc} options={colOptions(sheet.colCount)} optionLabels={(n) => columnPreviewLabel(sheet, startRow, n)} />
                  <ColSelect label="Cột ĐVT" value={colUnit} onChange={setColUnit} options={colOptions(sheet.colCount)} optionLabels={(n) => columnPreviewLabel(sheet, startRow, n)} allowNone />
                  <ColSelect label="Cột Số lượng" value={colQty} onChange={setColQty} options={colOptions(sheet.colCount)} optionLabels={(n) => columnPreviewLabel(sheet, startRow, n)} allowNone />
                  <ColSelect label="Cột Đơn giá *" value={colPrice} onChange={setColPrice} options={colOptions(sheet.colCount)} optionLabels={(n) => columnPreviewLabel(sheet, startRow, n)} allowNone />
                  <ColSelect label="Cột Thành tiền" value={colTotal} onChange={setColTotal} options={colOptions(sheet.colCount)} optionLabels={(n) => columnPreviewLabel(sheet, startRow, n)} allowNone />
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
                  <button onClick={() => setOpen(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">
                    Đóng
                  </button>
                  <button onClick={parse} disabled={busy || !colDesc || (!colPrice && !colTotal)} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40">
                    {busy ? "Đang đọc..." : "Đọc báo giá & so sánh"}
                  </button>
                </div>
              </div>
            )}

            {step === "review" && (
              <div className="mt-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  {contractorPicker((name) => rematch(rows, name))}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Chỉ hiện dòng có chênh lệch / chưa khớp
                    </label>
                    <button onClick={() => setRows((p) => p.map((r) => (r.target ? r : { ...r, target: "NEW", on: true })))} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
                      Dòng chưa khớp → thêm mới
                    </button>
                  </div>
                </div>

                <div className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  {rows.length} dòng báo giá · khớp <b>{matched}</b> · thêm mới <b>{news}</b> · bỏ qua <b>{rows.length - matched - news}</b> · đơn giá khác đang giao <b className={changed ? "text-red-700" : ""}>{changed}</b> dòng
                  {applied.length > 0 && (
                    <>
                      {" "}
                      · giá trị các dòng được chọn: đang giao <b>{fmt(totalOld)}</b> → theo báo giá <b>{fmt(totalNew)}</b>
                      {Math.abs(totalNew - totalOld) > 0.5 && <b className={totalNew > totalOld ? "text-red-700" : "text-emerald-700"}> ({totalNew > totalOld ? "+" : ""}{fmt(totalNew - totalOld)})</b>}
                    </>
                  )}
                  <div className="mt-0.5 text-[11px] text-slate-500">Thành tiền tính theo SL đang giao trong phần mềm (công tác nối BOQ giữ nguyên SL đã giao). Bỏ tích ô đầu dòng nếu không muốn nhập dòng đó.</div>
                </div>

                <div className="mt-2 max-h-[calc(100vh-300px)] min-h-[300px] overflow-auto rounded-md border border-slate-200">
                  <table className="w-full min-w-[1200px] text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-left text-slate-600">
                      <tr>
                        <th className="w-6 px-1 py-1" rowSpan={2} />
                        <th className="border-l border-slate-200 px-2 py-1 text-center font-semibold" colSpan={4}>
                          File báo giá
                        </th>
                        <th className="border-l border-slate-200 px-2 py-1 text-center font-semibold" colSpan={4}>
                          Đang giao trong phần mềm
                        </th>
                        <th className="border-l border-slate-200 px-2 py-1 text-right font-semibold" rowSpan={2}>
                          Chênh đơn giá
                        </th>
                      </tr>
                      <tr>
                        <th className="border-l border-slate-200 px-2 py-1 font-medium">Nội dung</th>
                        <th className="px-2 py-1 font-medium">ĐVT</th>
                        <th className="px-2 py-1 text-right font-medium">SL</th>
                        <th className="px-2 py-1 text-right font-medium">Đơn giá</th>
                        <th className="w-[30%] border-l border-slate-200 px-2 py-1 font-medium">Gán vào dòng thầu phụ</th>
                        <th className="px-2 py-1 font-medium">ĐVT</th>
                        <th className="px-2 py-1 text-right font-medium">SL</th>
                        <th className="px-2 py-1 text-right font-medium">Đơn giá</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, idx) => {
                        const t = r.target && r.target !== "NEW" ? targetById.get(r.target) : undefined;
                        const k = convOf(r, t);
                        const price = r.price * k; // đơn giá theo ĐVT dòng thầu phụ
                        const qtyConv = r.qty / k;
                        const priceDiff = t ? price - t.price : 0;
                        const qtyDiff = t && r.qty > 0 && Math.abs(qtyConv - t.qty) > Math.max(0.01, t.qty * 0.005);
                        const isDiff = !r.target || (t && (Math.abs(priceDiff) > 0.5 || qtyDiff));
                        if (onlyDiff && !isDiff) return null;
                        const unitDiff = t && r.unit && t.unit && unitMismatch(t.unit, r.unit) && !(r.conv && r.conv > 0);
                        const otherContractor = t && contractor.trim() && t.contractor && !sameName(t.contractor, contractor);
                        const dup = t && r.on && (used.get(t.id) ?? 0) > 1;
                        return (
                          <tr key={idx} className={`border-t border-slate-100 align-top ${!r.on || !r.target ? "bg-slate-50 text-slate-400" : ""}`}>
                            <td className="px-1 py-1.5 text-center">
                              <input type="checkbox" checked={r.on && !!r.target} disabled={!r.target} onChange={(e) => patch(idx, { on: e.target.checked })} />
                            </td>
                            <td className="border-l border-slate-100 px-2 py-1.5">{r.desc}</td>
                            <td className={`px-2 py-1.5 ${unitDiff ? "font-semibold text-amber-700" : ""}`}>{r.unit}</td>
                            <td className={`px-2 py-1.5 text-right ${qtyDiff ? "font-semibold text-amber-700" : ""}`}>{r.qty ? fmtQty(r.qty) : ""}</td>
                            <td className="px-2 py-1.5 text-right">
                              <NumInput value={r.price} decimals money onLive={(v) => patch(idx, { price: v })} onCommit={(v) => patch(idx, { price: v ?? 0 })} className="w-28 rounded border border-slate-300 px-1 py-0.5 text-right font-medium text-slate-900" />
                              {t && (
                                <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-slate-500" title={`Hệ số quy đổi: 1 ${t.unit} = ? ${r.unit || "ĐVT báo giá"}. Sửa nếu báo giá tính theo ĐVT khác mà hệ thống chưa nhận ra.`}>
                                  ×
                                  <NumInput value={k} decimals onCommit={(v) => patch(idx, { conv: v ?? undefined })} className="w-14 rounded border border-slate-200 px-0.5 text-right text-[10px]" />
                                </div>
                              )}
                              {t && Math.abs(k - 1) > 1e-9 && (
                                <div className="text-[10px] font-medium text-blue-700">
                                  = {fmt(price)} đ/{t.unit}
                                </div>
                              )}
                            </td>
                            <td className="border-l border-slate-100 px-2 py-1.5">
                              <select
                                value={r.target}
                                onChange={(e) => patch(idx, { target: e.target.value, on: !!e.target.value, conv: undefined })}
                                className={`w-full rounded border px-1 py-1 ${!r.target ? "border-slate-300" : r.target === "NEW" ? "border-emerald-500 bg-emerald-50" : "border-blue-400 bg-blue-50"}`}
                              >
                                <option value="">— Bỏ qua —</option>
                                <option value="NEW">＋ Thêm dòng thầu phụ mới</option>
                                {options.mine.length > 0 && (
                                  <optgroup label={`Dòng của ${contractor.trim()}`}>
                                    {options.mine.map((tg) => (
                                      <option key={tg.id} value={tg.id}>
                                        {`${tg.stt ? tg.stt + " · " : ""}${tg.name}`.slice(0, 110)}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                <optgroup label={options.mine.length ? "Dòng khác" : "Các dòng thầu phụ"}>
                                  {options.others.map((tg) => (
                                    <option key={tg.id} value={tg.id}>
                                      {`${tg.stt ? tg.stt + " · " : ""}${tg.name}${tg.contractor ? ` — ${tg.contractor}` : ""}`.slice(0, 120)}
                                    </option>
                                  ))}
                                </optgroup>
                              </select>
                              {otherContractor && <div className="mt-0.5 text-[10px] text-amber-700">Dòng này đang giao cho {t.contractor} — nhập sẽ đổi sang {contractor.trim()}</div>}
                              {dup && <div className="mt-0.5 text-[10px] text-red-600">Nhiều dòng báo giá cùng gán vào dòng này — dòng sau cùng được giữ</div>}
                              {qtyDiff && t.linked && <div className="mt-0.5 text-[10px] text-amber-700">SL báo giá khác SL đang giao — giữ SL đang giao, chỉ nhập đơn giá</div>}
                              {unitDiff && <div className="mt-0.5 text-[10px] text-amber-700">ĐVT khác nhau, chưa quy đổi được — nhập hệ số quy đổi ở ô × dưới đơn giá</div>}
                              {t && !unitDiff && Math.abs(k - 1) > 1e-9 && <div className="mt-0.5 text-[10px] text-blue-700">Đã quy đổi {r.unit || "ĐVT báo giá"} → {t.unit} (×{k.toLocaleString("vi-VN")})</div>}
                            </td>
                            <td className="px-2 py-1.5 text-slate-600">{t?.unit}</td>
                            <td className="px-2 py-1.5 text-right text-slate-600">{t ? fmtQty(t.qty) : ""}</td>
                            <td className="px-2 py-1.5 text-right text-slate-600">{t ? (t.price ? fmt(t.price) : "chưa có") : ""}</td>
                            <td className={`border-l border-slate-100 px-2 py-1.5 text-right font-semibold ${!t ? "" : Math.abs(priceDiff) <= 0.5 ? "text-emerald-700" : priceDiff > 0 ? "text-red-700" : "text-blue-700"}`}>
                              {!t ? "" : Math.abs(priceDiff) <= 0.5 ? "khớp ✓" : !t.price ? "mới" : `${priceDiff > 0 ? "+" : ""}${fmt(priceDiff)} (${priceDiff > 0 ? "+" : ""}${((priceDiff / t.price) * 100).toFixed(1).replace(".", ",")}%)`}
                            </td>
                          </tr>
                        );
                      })}
                      {rows.length === 0 && (
                        <tr>
                          <td colSpan={10} className="px-2 py-8 text-center text-slate-400">
                            Không đọc được dòng nào có đơn giá. Kiểm tra lại cột đã chọn.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {missing.length > 0 && (
                  <details className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <summary className="cursor-pointer font-medium">{missing.length} dòng đang giao cho {contractor.trim()} chưa có trong báo giá (bấm để xem)</summary>
                    <ul className="mt-1 list-disc pl-5">
                      {missing.map((t) => (
                        <li key={t.id}>
                          {t.stt ? `${t.stt} · ` : ""}
                          {t.name} — {fmtQty(t.qty)} {t.unit}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                <div className="mt-4 flex gap-2">
                  <button onClick={() => setStep("mapping")} className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">
                    Quay lại
                  </button>
                  <button onClick={apply} disabled={busy || applied.length === 0} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40">
                    {busy ? "Đang nhập..." : `Xác nhận nhập đơn giá ${applied.length} dòng`}
                  </button>
                </div>
              </div>
            )}

            {step === "done" && (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-6 text-center">
                <p className="text-sm font-medium text-green-800">{result}</p>
                <button onClick={() => setOpen(false)} className="mt-3 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
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
