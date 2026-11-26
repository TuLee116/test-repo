"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { importBoqItemsAction } from "@/lib/actions";
import NumInput from "@/app/(app)/NumInput";
import { normalizeText } from "@/lib/text-normalize";
import WorkItemInlineSearch, { type CatalogOption } from "./WorkItemInlineSearch";
import { PriceCells, PriceSummary } from "./PriceCheck";
import { confirmNear } from "@/app/(app)/confirm-near";

export type SheetInfo = { name: string; rowCount: number; colCount: number; preview: string[][] };
type ParsedRow = {
  rowIndex: number;
  stt: string;
  desc: string;
  unit: string;
  qty: number;
  matchedWorkItemId: string | null;
  matchedWorkItemName: string | null;
  matchedWorkItemUnit: string | null;
  matchType: "alias" | "rule" | "exact" | "fuzzy" | "none" | "manual"; // manual = người dùng tự chọn trên bảng duyệt
  candidates?: CatalogOption[];
  isHeading: boolean;
  images?: string[]; // mã ảnh tạm lấy từ file Excel
  price: number | null; // đơn giá CĐT trong file (khi chọn cột Đơn giá)
  amount: number | null; // thành tiền trong file - chỉ để đối chiếu
  note?: string; // ghi chú trong file
};
type ReviewRow = ParsedRow & {
  workItemId: string | null;
  workItemName: string | null;
  workItemUnit: string | null;
};

// Dòng tóm tắt kết quả lấy ảnh từ file Excel (hiện ở bước duyệt)
export function imageNoteOf(st: { found: number; attached: number; skipped: number } | undefined, asked: boolean): string {
  if (!asked || !st) return "";
  if (!st.found) return "Không thấy hình ảnh nào trong sheet này.";
  return `Lấy được ${st.attached} ảnh từ file${st.skipped ? ` (bỏ qua ${st.skipped} ảnh: nằm ngoài vùng dữ liệu, định dạng không đọc được như EMF/WMF, hoặc không nén được về 1MB)` : ""}.`;
}

export default function ImportWizard({
  projectId,
  catalog,
  initialFile,
  onClose,
  sheetId = null,
  newSheetName,
  autoMatch = true,
}: {
  projectId: string;
  catalog: CatalogOption[];
  initialFile?: File;
  onClose?: () => void;
  sheetId?: string | null; // nhập vào sheet bổ sung này (null = BOQ chính)
  newSheetName?: string; // hoặc tạo sheet mới với tên này
  autoMatch?: boolean; // false = không tự khớp định mức, người dùng tự chọn mã ở CHI TIẾT
}) {
  const router = useRouter();
  const [step, setStep] = useState<"upload" | "loading" | "sheet" | "mapping" | "review" | "done">(
    initialFile ? "loading" : "upload"
  );
  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const startedRef = useRef(false);
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [sheet, setSheet] = useState<SheetInfo | null>(null);
  const [startRow, setStartRow] = useState(2);
  const [colStt, setColStt] = useState(0);
  const [colDesc, setColDesc] = useState(0);
  const [colUnit, setColUnit] = useState(0);
  const [colQty, setColQty] = useState(0);
  const [colPrice, setColPrice] = useState(0);
  const [colAmount, setColAmount] = useState(0);
  const [colNote, setColNote] = useState(0);
  // cột giá đã dùng ở lần phân tích gần nhất (bảng duyệt chỉ hiện cột giá khi có)
  const [priced, setPriced] = useState({ price: false, amount: false });
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [withImages, setWithImages] = useState(true);
  const [imageNote, setImageNote] = useState("");
  const [error, setError] = useState("");
  const [importedCount, setImportedCount] = useState(0);
  const [createdSheetId, setCreatedSheetId] = useState<string | null>(null);

  async function handleFileChosen(f: File) {
    setFile(f);
    setError("");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/import/inspect", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Không đọc được file");
      setSheets(data.sheets);
      if (data.sheets.length === 1) {
        chooseSheet(data.sheets[0]);
      } else {
        setStep("sheet");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (initialFile && !startedRef.current) {
      startedRef.current = true;
      handleFileChosen(initialFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  function chooseSheet(s: SheetInfo) {
    setSheet(s);
    setColStt(0);
    setColDesc(0);
    setColUnit(0);
    setColQty(0);
    setColPrice(0);
    setColAmount(0);
    setColNote(0);
    setStartRow(2);
    setStep("mapping");
  }

  async function handleParse() {
    if (!file || !sheet || !colDesc || !colQty) {
      setError("Cần chọn ít nhất cột Mô tả công việc và cột Khối lượng");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("sheetName", sheet.name);
      fd.append("startRow", String(startRow));
      fd.append("colStt", String(colStt));
      fd.append("colDesc", String(colDesc));
      fd.append("colUnit", String(colUnit));
      fd.append("colQty", String(colQty));
      fd.append("colPrice", String(colPrice));
      fd.append("colAmount", String(colAmount));
      fd.append("colNote", String(colNote));
      if (withImages) fd.append("includeImages", "1");
      const res = await fetch("/api/import/parse", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi phân tích file");
      setImageNote(imageNoteOf(data.imageStats, withImages));
      setPriced({ price: colPrice > 0 || colAmount > 0, amount: colAmount > 0 });
      // Giữ nguyên toàn bộ bố cục BOQ gốc, kể cả các đầu mục lớn (A, B, I, II... không có khối lượng)
      setRows(
        (data.rows as ParsedRow[]).map((r) => ({
          ...r,
          workItemId: autoMatch ? r.matchedWorkItemId : null,
          workItemName: autoMatch ? r.matchedWorkItemName : null,
          workItemUnit: autoMatch ? r.matchedWorkItemUnit : null,
        }))
      );
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    } finally {
      setBusy(false);
    }
  }

  function updateRow(idx: number, patch: Partial<ReviewRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  async function removeRow(idx: number) {
    if (!await confirmNear(`⚠ Bạn có chắc chắn muốn XOÁ dòng "${rows[idx]?.desc ?? ""}" khỏi danh sách nhập không?`)) return;
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleImport() {
    setBusy(true);
    setError("");
    try {
      const items = rows.map((r) => ({
        workItemId: r.workItemId,
        quantity: r.qty,
        rawDescription: r.desc,
        rawUnit: r.unit,
        normalizedText: normalizeText(r.desc),
        // chỉ ghi nhớ mã người dùng tự chọn - mã phần mềm tự đoán có thể sai, học vào là sai mãi
        learnAlias: r.matchType === "manual",
        isHeading: r.isHeading,
        stt: r.stt,
        images: r.images,
        quotedUnitPrice: priced.price && !r.isHeading ? r.price : null,
        note: r.note ?? "",
      }));
      const result = await importBoqItemsAction(projectId, items, { sheetId, newSheetName });
      setImportedCount(result.created);
      setStep("done");
      router.refresh();
      if (newSheetName && result.sheetId) setCreatedSheetId(result.sheetId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi nhập BOQ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {step === "upload" && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm text-slate-600">Chọn file Excel (.xlsx) chứa BOQ cần nhập</p>
          <input
            type="file"
            accept=".xlsx,.xls"
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && handleFileChosen(e.target.files[0])}
            className="mx-auto mt-4 block text-sm"
          />
          {busy && <p className="mt-2 text-xs text-slate-400">Đang đọc file...</p>}
        </div>
      )}

      {step === "loading" && (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Đang đọc file {file?.name}...
        </div>
      )}

      {step === "sheet" && (
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="font-medium text-slate-900">Chọn sheet chứa BOQ</h3>
          <div className="mt-3 space-y-2">
            {sheets.map((s) => (
              <button
                key={s.name}
                onClick={() => chooseSheet(s)}
                className="block w-full rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <span className="font-medium">{s.name}</span>{" "}
                <span className="text-slate-400">({s.rowCount} dòng)</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "mapping" && sheet && (
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="font-medium text-slate-900">
            Chọn cột dữ liệu — sheet &quot;{sheet.name}&quot;
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Xem bảng xem trước bên dưới để xác định đúng cột (đánh số cột theo thứ tự từ trái, bắt đầu từ 1).
          </p>

          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
            <ColSelect
              label="Dòng bắt đầu dữ liệu"
              value={startRow}
              onChange={setStartRow}
              options={rowOptions(sheet.rowCount)}
              optionLabels={(n) => rowPreviewLabel(sheet, n)}
            />
            <ColSelect
              label="Cột STT"
              value={colStt}
              onChange={setColStt}
              options={colOptions(sheet.colCount)}
              optionLabels={(n) => columnPreviewLabel(sheet, startRow, n)}
              allowNone
            />
            <ColSelect
              label="Cột Mô tả công việc *"
              value={colDesc}
              onChange={setColDesc}
              options={colOptions(sheet.colCount)}
              optionLabels={(n) => columnPreviewLabel(sheet, startRow, n)}
            />
            <ColSelect
              label="Cột ĐVT"
              value={colUnit}
              onChange={setColUnit}
              options={colOptions(sheet.colCount)}
              optionLabels={(n) => columnPreviewLabel(sheet, startRow, n)}
              allowNone
            />
            <ColSelect
              label="Cột Khối lượng *"
              value={colQty}
              onChange={setColQty}
              options={colOptions(sheet.colCount)}
              optionLabels={(n) => columnPreviewLabel(sheet, startRow, n)}
            />
            <ColSelect
              label="Cột Đơn giá CĐT (nếu đã có giá duyệt)"
              value={colPrice}
              onChange={setColPrice}
              options={colOptions(sheet.colCount)}
              optionLabels={(n) => columnPreviewLabel(sheet, startRow, n)}
              allowNone
            />
            <ColSelect
              label="Cột Thành tiền (để đối chiếu)"
              value={colAmount}
              onChange={setColAmount}
              options={colOptions(sheet.colCount)}
              optionLabels={(n) => columnPreviewLabel(sheet, startRow, n)}
              allowNone
            />
            <ColSelect label="Cột Ghi chú" value={colNote} onChange={setColNote} options={colOptions(sheet.colCount)} optionLabels={(n) => columnPreviewLabel(sheet, startRow, n)} allowNone />
          </div>

          <div className="mt-4 overflow-x-auto rounded-md border border-slate-200">
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
                    {r.map((cell, ci) => (
                      <td key={ci} className="max-w-[160px] truncate px-2 py-1 text-slate-600">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={withImages} onChange={(e) => setWithImages(e.target.checked)} className="h-4 w-4" />
            Nhập kèm hình ảnh trong file (ảnh nằm trên dòng nào thì gắn vào dòng BOQ đó; mỗi ảnh tự nén ≤ 1MB)
          </label>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setStep(sheets.length > 1 ? "sheet" : "upload")}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
            >
              Quay lại
            </button>
            <button
              onClick={handleParse}
              disabled={busy || !colDesc || !colQty}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
            >
              {busy ? "Đang phân tích..." : "Phân tích & khớp công tác"}
            </button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          {imageNote && <div className="mb-3 rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-800">🖼 {imageNote}</div>}
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-slate-900">Danh sách BOQ sẽ nhập ({rows.filter((r) => !r.isHeading).length} dòng công tác, {rows.filter((r) => r.isHeading).length} đầu mục lớn)</h3>
            <p className="text-xs text-slate-500">Xoá bớt dòng không cần, hoặc chọn công tác cho các dòng chưa có định mức.</p>
          </div>

          {priced.price && (
            <div className="mt-3">
              <PriceSummary rows={rows} showAmount={priced.amount} />
            </div>
          )}
          <div className="mt-3 max-h-[calc(100vh-280px)] min-h-[300px] overflow-auto rounded-md border border-slate-200">
            <table className={`w-full text-xs ${priced.price ? "min-w-[1250px]" : "min-w-[900px]"}`}>
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-2 py-2 font-medium">STT</th>
                  <th className="px-2 py-2 font-medium">Mô tả công việc (gốc)</th>
                  <th className="px-2 py-2 font-medium">ĐVT gốc</th>
                  <th className="px-2 py-2 text-right font-medium">Khối lượng</th>
                  {priced.price && (
                    <>
                      <th className="px-2 py-2 text-right font-medium">Đơn giá CĐT</th>
                      <th className="px-2 py-2 text-right font-medium">Thành tiền (KL × ĐG)</th>
                      {priced.amount && <th className="px-2 py-2 text-right font-medium">Thành tiền trong file</th>}
                    </>
                  )}
                  <th className="px-2 py-2 font-medium">Công tác trong danh mục</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) =>
                  r.isHeading ? (
                    <tr key={idx} className="border-t border-slate-100 bg-yellow-100 align-top">
                      <td className="px-2 py-1.5 font-semibold text-slate-700">{r.stt}</td>
                      <td className="px-2 py-1.5 font-semibold text-slate-900" colSpan={3}>
                        {r.desc} <span className="ml-1 rounded bg-yellow-300 px-1 text-[10px] font-normal">Đầu mục</span>{r.images?.length ? <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] font-normal text-sky-700" title="Số ảnh lấy từ file Excel">🖼 {r.images.length}</span> : null}
                      </td>
                      {priced.price && <PriceCells row={r} showAmount={priced.amount} onPrice={() => {}} cellClass="px-2 py-1.5" />}
                      <td className="px-2 py-1.5" />
                      <td className="px-2 py-1.5 text-right">
                        <button onClick={() => removeRow(idx)} className="text-[11px] text-red-500 hover:underline">
                          Xoá
                        </button>
                      </td>
                    </tr>
                  ) : (
                  <tr key={idx} className="border-t border-slate-100 align-top">
                    <td className="px-2 py-2 text-slate-500">{r.stt}</td>
                    <td className="max-w-[480px] px-2 py-2 text-slate-700">{r.desc}{r.images?.length ? <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] font-normal text-sky-700" title="Số ảnh lấy từ file Excel">🖼 {r.images.length}</span> : null}</td>
                    <td className="px-2 py-2 text-slate-500">{r.unit}</td>
                    <td className="px-2 py-2 text-right">
                      <NumInput value={r.qty} decimals qty onLive={(v) => updateRow(idx, { qty: v })} onCommit={() => {}} className="w-24 rounded-md border border-slate-300 px-1 py-0.5 text-right text-xs" />
                    </td>
                    {priced.price && <PriceCells row={r} showAmount={priced.amount} onPrice={(v) => updateRow(idx, { price: v })} />}
                    <td className="min-w-[260px] px-2 py-2">
                      {r.workItemId ? (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-800">{r.workItemName}</span>
                          <button
                            className="text-[11px] text-slate-400 hover:text-slate-600"
                            onClick={() => updateRow(idx, { workItemId: null, workItemName: null, workItemUnit: null })}
                          >
                            Đổi
                          </button>
                        </div>
                      ) : (
                        <WorkItemInlineSearch
                          items={catalog}
                          suggestions={r.candidates}
                          onPick={(item) =>
                            updateRow(idx, { workItemId: item.id, workItemName: item.name, workItemUnit: item.unit, matchType: "manual" })
                          }
                        />
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button onClick={() => removeRow(idx)} className="text-[11px] text-red-500 hover:underline">
                        Xoá
                      </button>
                    </td>
                  </tr>
                  )
                )}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6 + (priced.price ? (priced.amount ? 3 : 2) : 0)} className="px-2 py-8 text-center text-slate-400">
                      Không còn dòng nào.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setStep("mapping")}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
            >
              Quay lại
            </button>
            <button
              onClick={handleImport}
              disabled={busy || rows.every((r) => r.isHeading)}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
            >
              {busy ? "Đang nhập..." : `Nhập ${rows.length} dòng (gồm đầu mục) vào BOQ`}
            </button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center">
          <p className="text-sm font-medium text-green-800">Đã nhập {importedCount} dòng vào BOQ.</p>
          <button
            onClick={() => {
              if (createdSheetId) router.push(`/projects/${projectId}/s/${createdSheetId}`);
              else if (onClose) onClose();
              else router.push(`/projects/${projectId}`);
              if (createdSheetId) onClose?.();
            }}
            className="mt-3 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            {createdSheetId ? "Mở sheet vừa tạo" : "Đóng"}
          </button>
        </div>
      )}
    </div>
  );
}

export function rowOptions(rowCount: number) {
  return Array.from({ length: Math.min(rowCount, 30) }, (_, i) => i + 1);
}
export function colOptions(colCount: number) {
  return Array.from({ length: colCount }, (_, i) => i + 1);
}

function truncate(s: string, max: number) {
  const t = s.trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

// Nhãn xem trước cho từng cột: ưu tiên chữ ở dòng ngay trên "dòng bắt đầu dữ liệu" (thường là
// dòng tiêu đề), nếu trống thì lấy mẫu ở chính dòng dữ liệu đầu tiên.
export function columnPreviewLabel(sheet: SheetInfo, startRow: number, colIndex: number): string {
  const headerText = sheet.preview[startRow - 2]?.[colIndex - 1] || "";
  const sampleText = sheet.preview[startRow - 1]?.[colIndex - 1] || "";
  return truncate(headerText || sampleText, 24);
}

// Nhãn xem trước cho từng lựa chọn "dòng bắt đầu dữ liệu": nối vài ô đầu của dòng đó lại.
export function rowPreviewLabel(sheet: SheetInfo, rowNumber: number): string {
  const cells = (sheet.preview[rowNumber - 1] || []).filter(Boolean).slice(0, 3);
  return truncate(cells.join(" | "), 30);
}

export function ColSelect({
  label,
  value,
  onChange,
  options,
  optionLabels,
  allowNone,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  options: number[];
  optionLabels?: (n: number) => string;
  allowNone?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      >
        {allowNone && <option value={0}>(không dùng)</option>}
        {!allowNone && value === 0 && <option value={0}>-- chọn --</option>}
        {options.map((n) => {
          const extra = optionLabels?.(n);
          return (
            <option key={n} value={n}>
              {n}
              {extra ? ` — ${extra}` : ""}
            </option>
          );
        })}
      </select>
    </div>
  );
}
