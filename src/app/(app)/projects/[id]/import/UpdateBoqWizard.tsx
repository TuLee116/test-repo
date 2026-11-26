"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { updateBoqFromImportAction } from "@/lib/actions";
import NumInput from "@/app/(app)/NumInput";
import { normalizeText } from "@/lib/text-normalize";
import { diffBoq, type ExistingBoqRow, type MatchedPair, type NewBoqRow } from "@/lib/boq-diff";
import WorkItemInlineSearch, { type CatalogOption } from "./WorkItemInlineSearch";
import { PriceCells, PriceSummary } from "./PriceCheck";
import { ColSelect, colOptions, columnPreviewLabel, imageNoteOf, rowOptions, rowPreviewLabel, type SheetInfo } from "./ImportWizard";
import { fmtQty } from "@/lib/fmt-qty";

type CreatedRow = NewBoqRow & {
  workItemId: string | null;
  workItemName: string | null;
  workItemUnit: string | null;
};

// Khớp (matched), mới (created) và bị xoá (removed) được gộp lại và xếp theo đúng vị trí: khớp/mới
// theo thứ tự dòng trong file BOQ mới (rowIndex); dòng bị xoá không có vị trí trong file mới nên bám
// theo khoá (sortKey) nội suy ngay sau dòng cũ liền trước nó mà có khớp - xem buildSortKeys() bên dưới.
type OrderedEntry =
  | { kind: "matched"; sortKey: number; m: MatchedPair }
  | { kind: "created"; sortKey: number; idx: number; r: CreatedRow }
  | { kind: "removed"; sortKey: number; r: ExistingBoqRow };


// So với "Nhập từ Excel" (luôn tạo dòng BOQ mới), wizard này dùng khi CĐT gửi lại 1 bản BOQ đã sửa
// đổi: khớp từng dòng mới với dòng BOQ cũ theo mô tả công việc để GIỮ LẠI mã định mức/phương án/giá đã
// gán, chỉ cập nhật khối lượng - chỉ xoá dòng BOQ cũ khi người dùng tự xác nhận.
export default function UpdateBoqWizard({
  projectId,
  sheetId,
  catalog,
  existingItems,
  initialFile,
  onClose,
}: {
  projectId: string;
  sheetId: string | null;
  catalog: CatalogOption[];
  existingItems: ExistingBoqRow[];
  initialFile?: File;
  onClose?: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"upload" | "loading" | "sheet" | "mapping" | "diff" | "done">(
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
  // cột giá đã dùng ở lần phân tích gần nhất (bảng so sánh chỉ hiện cột giá khi có)
  const [priced, setPriced] = useState({ price: false, amount: false });
  const [matched, setMatched] = useState<MatchedPair[]>([]);
  const [created, setCreated] = useState<CreatedRow[]>([]);
  const [removedCandidates, setRemovedCandidates] = useState<ExistingBoqRow[]>([]);
  const [removeIds, setRemoveIds] = useState<Set<string>>(new Set());
  // Dòng khớp (matched) mà nội dung mới gợi ý 1 mã định mức KHÁC mã đang gán - mặc định vẫn giữ mã cũ
  // (an toàn), chỉ đổi khi người dùng tự bấm "Đổi". Khoá theo existing.id.
  const [workItemOverrides, setWorkItemOverrides] = useState<Map<string, { id: string; name: string }>>(new Map());
  const [busy, setBusy] = useState(false);
  const [withImages, setWithImages] = useState(true);
  const [imageNote, setImageNote] = useState("");
  const [error, setError] = useState("");

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
      if (data.sheets.length === 1) chooseSheet(data.sheets[0]);
      else setStep("sheet");
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
      const incoming = data.rows as NewBoqRow[];
      const diff = diffBoq(existingItems, incoming);
      setMatched(diff.matched);
      setCreated(
        diff.created.map((r) => ({
          ...r,
          workItemId: r.matchedWorkItemId,
          workItemName: r.matchedWorkItemName,
          workItemUnit: r.matchedWorkItemUnit,
        }))
      );
      setRemovedCandidates(diff.removedCandidates);
      setRemoveIds(new Set());
      setStep("diff");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    } finally {
      setBusy(false);
    }
  }

  function updateCreated(idx: number, patch: Partial<CreatedRow>) {
    setCreated((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  // đơn giá CĐT mới của dòng khớp (sửa tay trên bảng so sánh)
  function updateMatchedPrice(existingId: string, price: number | null) {
    setMatched((prev) => prev.map((m) => (m.existing.id === existingId ? { ...m, next: { ...m.next, price } } : m)));
  }
  function removeCreated(idx: number) {
    setCreated((prev) => prev.filter((_, i) => i !== idx));
  }
  function toggleRemove(id: string, checked: boolean) {
    setRemoveIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function applyWorkItemOverride(existingId: string, workItemId: string, name: string) {
    setWorkItemOverrides((prev) => new Map(prev).set(existingId, { id: workItemId, name }));
  }
  function clearWorkItemOverride(existingId: string) {
    setWorkItemOverrides((prev) => {
      const next = new Map(prev);
      next.delete(existingId);
      return next;
    });
  }

  const renamedCount = matched.filter((m) => m.renamed).length;

  // Dòng "bị xoá" (removed) không có vị trí trong file mới - cho nó bám ngay sau dòng cũ liền trước
  // gần nhất mà có khớp, giữ đúng thứ tự tương đối như trong đầu mục cũ (nhiều dòng liền kề cùng
  // không khớp thì xếp lần lượt theo đúng thứ tự cũ của chúng).
  const matchedByOldId = new Map(matched.map((m) => [m.existing.id, m]));
  const removedIdSet = new Set(removedCandidates.map((r) => r.id));
  const removedSortKey = new Map<string, number>();
  {
    let lastKey = 0;
    let sub = 0;
    for (const old of existingItems) {
      const m = matchedByOldId.get(old.id);
      if (m) {
        lastKey = m.next.rowIndex;
        sub = 0;
      } else if (removedIdSet.has(old.id)) {
        sub += 1;
        removedSortKey.set(old.id, lastKey + sub * 0.0001);
      }
    }
  }

  const orderedEntries: OrderedEntry[] = [
    ...matched.map((m) => ({ kind: "matched" as const, sortKey: m.next.rowIndex, m })),
    ...created.map((r, idx) => ({ kind: "created" as const, sortKey: r.rowIndex, idx, r })),
    ...removedCandidates.map((r) => ({ kind: "removed" as const, sortKey: removedSortKey.get(r.id) ?? 0, r })),
  ].sort((a, b) => a.sortKey - b.sortKey);

  async function handleApply() {
    setBusy(true);
    setError("");
    try {
      // Giữ đúng thứ tự orderedEntries khi áp dụng, để BOQ sau khi cập nhật cũng xếp đúng vị trí như
      // bảng xem trước (kể cả dòng cũ không khớp nhưng không bị xoá - giữ nguyên chỗ cũ của nó).
      const slots = orderedEntries
        .filter((entry) => entry.kind !== "removed" || !removeIds.has(entry.r.id))
        .map((entry) => {
          if (entry.kind === "matched") {
            const override = workItemOverrides.get(entry.m.existing.id);
            return {
              kind: "matched" as const,
              id: entry.m.existing.id,
              quantity: entry.m.existing.isHeading ? 0 : entry.m.next.qty,
              rawUnit: entry.m.next.unit,
              stt: entry.m.next.stt,
              rawDescription: entry.m.next.desc,
              ...(override ? { workItemId: override.id } : {}),
              images: entry.m.next.images,
              ...(priced.price && !entry.m.existing.isHeading && entry.m.next.price != null ? { quotedUnitPrice: entry.m.next.price } : {}),
              ...(entry.m.next.note ? { note: entry.m.next.note } : {}), // ô trống trong file: giữ ghi chú đang có
            };
          }
          if (entry.kind === "created") {
            return {
              kind: "created" as const,
              workItemId: entry.r.workItemId,
              quantity: entry.r.qty,
              rawDescription: entry.r.desc,
              rawUnit: entry.r.unit,
              stt: entry.r.stt,
              isHeading: entry.r.isHeading,
              normalizedText: normalizeText(entry.r.desc),
              learnAlias: entry.r.matchType === "manual", // chỉ học mã người dùng tự chọn
              images: entry.r.images,
              quotedUnitPrice: priced.price && !entry.r.isHeading ? (entry.r.price ?? null) : null,
              note: entry.r.note ?? "",
            };
          }
          return { kind: "kept" as const, id: entry.r.id };
        });
      await updateBoqFromImportAction(projectId, sheetId, slots, [...removeIds]);
      setStep("done");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi cập nhật BOQ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {step === "upload" && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm text-slate-600">Chọn file Excel (.xlsx) chứa bản BOQ mới của CĐT</p>
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
                <span className="font-medium">{s.name}</span> <span className="text-slate-400">({s.rowCount} dòng)</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "mapping" && sheet && (
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="font-medium text-slate-900">Chọn cột dữ liệu — sheet &quot;{sheet.name}&quot;</h3>
          <p className="mt-1 text-xs text-slate-500">
            Xem bảng xem trước bên dưới để xác định đúng cột (đánh số cột theo thứ tự từ trái, bắt đầu từ 1).
          </p>

          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
            <ColSelect label="Dòng bắt đầu dữ liệu" value={startRow} onChange={setStartRow} options={rowOptions(sheet.rowCount)} optionLabels={(n) => rowPreviewLabel(sheet, n)} />
            <ColSelect label="Cột STT" value={colStt} onChange={setColStt} options={colOptions(sheet.colCount)} optionLabels={(n) => columnPreviewLabel(sheet, startRow, n)} allowNone />
            <ColSelect label="Cột Mô tả công việc *" value={colDesc} onChange={setColDesc} options={colOptions(sheet.colCount)} optionLabels={(n) => columnPreviewLabel(sheet, startRow, n)} />
            <ColSelect label="Cột ĐVT" value={colUnit} onChange={setColUnit} options={colOptions(sheet.colCount)} optionLabels={(n) => columnPreviewLabel(sheet, startRow, n)} allowNone />
            <ColSelect label="Cột Khối lượng *" value={colQty} onChange={setColQty} options={colOptions(sheet.colCount)} optionLabels={(n) => columnPreviewLabel(sheet, startRow, n)} />
            <ColSelect label="Cột Đơn giá CĐT (nếu đã có giá duyệt)" value={colPrice} onChange={setColPrice} options={colOptions(sheet.colCount)} optionLabels={(n) => columnPreviewLabel(sheet, startRow, n)} allowNone />
            <ColSelect label="Cột Thành tiền (để đối chiếu)" value={colAmount} onChange={setColAmount} options={colOptions(sheet.colCount)} optionLabels={(n) => columnPreviewLabel(sheet, startRow, n)} allowNone />
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
            Nhập kèm hình ảnh trong file (dòng đã có ảnh thì giữ ảnh cũ; ảnh nằm trên dòng nào thì gắn vào dòng BOQ đó; mỗi ảnh tự nén ≤ 1MB)
          </label>
          <div className="mt-4 flex gap-2">
            <button onClick={() => setStep(sheets.length > 1 ? "sheet" : "upload")} className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">
              Quay lại
            </button>
            <button
              onClick={handleParse}
              disabled={busy || !colDesc || !colQty}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
            >
              {busy ? "Đang phân tích..." : "Phân tích & so khớp với BOQ hiện tại"}
            </button>
          </div>
        </div>
      )}

      {step === "diff" && (
        <div className="space-y-4">
          {imageNote && <div className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-800">🖼 {imageNote}</div>}
          <div className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">
            <b>{matched.length}</b> dòng khớp với BOQ hiện tại (giữ nguyên mã định mức/giá đã gán, chỉ cập nhật khối lượng){renamedCount > 0 && <> — trong đó <b>{renamedCount}</b> dòng chỉ đoán khớp theo nội dung gần giống (đổi tên công việc), nên soát lại</>} ·{" "}
            <b>{created.length}</b> dòng mới từ CĐT sẽ thêm vào · <b>{removedCandidates.length}</b> dòng cũ không thấy trong file mới.
          </div>

          {priced.price && (
            <PriceSummary
              rows={[
                ...matched.map((m) => ({ qty: m.next.qty, price: m.next.price ?? null, amount: m.next.amount ?? null, isHeading: m.existing.isHeading })),
                ...created.map((r) => ({ qty: r.qty, price: r.price ?? null, amount: r.amount ?? null, isHeading: r.isHeading })),
              ]}
              showAmount={priced.amount}
            />
          )}
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="font-medium text-slate-900">Bảng so sánh BOQ Cũ / BOQ Mới</h3>
            <p className="mt-1 text-xs text-slate-500">
              Dòng trắng: khớp 100% y hệt chữ (giữ nguyên mã định mức/giá đã gán, không cần xem lại). Dòng vàng đậm ở cột Khối lượng: khối lượng đổi. Dòng đỏ nhạt có nhãn &quot;Đổi nội dung&quot;: nội dung công việc viết khác đi nhưng hệ thống đoán vẫn là công tác đó — mặc định vẫn giữ mã định mức cũ, nhưng nếu nội dung mới (VD đổi mác bê tông) hợp với 1 mã khác trong danh mục hơn thì cột Mã định mức sẽ tô cam và gợi ý mã đó, bấm &quot;Đổi sang mã này&quot; nếu đúng. Dòng xanh: công tác mới từ CĐT — chọn công tác hoặc xoá bớt. Dòng đỏ nhạt có ô tick: có ở BOQ cũ nhưng không thấy trong file mới — mặc định KHÔNG xoá, tick nếu thật sự cần xoá (xoá dòng đã có đơn giá thầu phụ sẽ mất luôn đơn giá/tên thầu phụ đã nhập).
            </p>
            <div className="mt-2 max-h-[calc(100vh-240px)] min-h-[300px] overflow-auto rounded-md border border-slate-200">
              <table className={`w-full text-sm ${priced.price ? "min-w-[1550px]" : "min-w-[1200px]"}`}>
                <thead className="sticky top-0 z-10 bg-slate-100 text-center text-slate-600">
                  <tr>
                    <th rowSpan={2} className="border border-slate-200 px-2 py-1.5 font-medium">TT</th>
                    <th colSpan={2} className="border border-slate-200 px-2 py-1 font-medium">Tên công việc</th>
                    <th colSpan={2} className="border border-slate-200 px-2 py-1 font-medium">Đơn vị</th>
                    <th colSpan={2} className="border border-slate-200 px-2 py-1 font-medium">Khối lượng</th>
                    {priced.price && (
                      <>
                        <th rowSpan={2} className="border border-slate-200 px-2 py-1.5 font-medium">Đơn giá CĐT (mới)</th>
                        <th rowSpan={2} className="border border-slate-200 px-2 py-1.5 font-medium">Thành tiền (KL × ĐG)</th>
                        {priced.amount && <th rowSpan={2} className="border border-slate-200 px-2 py-1.5 font-medium">Thành tiền trong file</th>}
                      </>
                    )}
                    <th rowSpan={2} className="border border-slate-200 px-2 py-1.5 font-medium">Mã định mức / Công tác</th>
                    <th rowSpan={2} className="border border-slate-200 px-2 py-1.5" />
                  </tr>
                  <tr>
                    <th className="border border-slate-200 px-2 py-1 font-medium">BOQ Cũ</th>
                    <th className="border border-slate-200 px-2 py-1 font-medium">BOQ Mới</th>
                    <th className="border border-slate-200 px-2 py-1 font-medium">BOQ Cũ</th>
                    <th className="border border-slate-200 px-2 py-1 font-medium">BOQ Mới</th>
                    <th className="border border-slate-200 px-2 py-1 font-medium">BOQ Cũ</th>
                    <th className="border border-slate-200 px-2 py-1 font-medium">BOQ Mới</th>
                  </tr>
                </thead>
                <tbody>
                  {orderedEntries.map((entry) => {
                    if (entry.kind === "matched") {
                      const m = entry.m;
                      const changed = !m.existing.isHeading && Math.abs(m.existing.quantity - m.next.qty) > 1e-9;
                      const override = workItemOverrides.get(m.existing.id);
                      const effectiveWorkItemId = override?.id ?? m.existing.workItemId;
                      // Chỉ cảnh báo đổi định mức cho dòng ĐỔI NỘI DUNG (renamed) - khớp 100% y hệt
                      // chữ thì chắc chắn vẫn đúng định mức cũ, không cần nghi ngờ.
                      const mismatch = m.renamed && !m.existing.isHeading && !!m.next.matchedWorkItemId && m.next.matchedWorkItemId !== effectiveWorkItemId;
                      return (
                        <tr key={`m${entry.sortKey}`} className={`border-t border-slate-100 text-left ${m.renamed ? "bg-red-50" : ""}`}>
                          <td className="border border-slate-100 px-2 py-1.5 text-center text-slate-500">{m.next.stt}</td>
                          <td className="max-w-[360px] border border-slate-100 px-2 py-1.5 text-slate-500">{m.existing.rawDescription}</td>
                          <td className="max-w-[360px] border border-slate-100 px-2 py-1.5 text-slate-700">
                            {m.next.desc} {m.renamed && <span className="ml-1 rounded bg-red-200 px-1 text-[10px] font-normal text-red-700">Đổi nội dung</span>}{m.next.images?.length ? <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] font-normal text-sky-700" title="Số ảnh lấy từ file Excel">🖼 {m.next.images.length}</span> : null}
                          </td>
                          <td className="border border-slate-100 px-2 py-1.5 text-center text-slate-500">{m.existing.rawUnit}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-center text-slate-700">{m.next.unit}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-right text-slate-500">{m.existing.isHeading ? "-" : fmtQty(m.existing.quantity)}</td>
                          <td className={`border border-slate-100 px-2 py-1.5 text-right font-medium ${changed ? "bg-amber-200 text-amber-900" : "text-slate-700"}`}>
                            {m.existing.isHeading ? "-" : fmtQty(m.next.qty)}
                          </td>
                          {priced.price && (
                            <PriceCells
                              row={{ qty: m.next.qty, price: m.next.price ?? null, amount: m.next.amount ?? null, isHeading: m.existing.isHeading }}
                              showAmount={priced.amount}
                              onPrice={(v) => updateMatchedPrice(m.existing.id, v)}
                              cellClass="border border-slate-100 px-2 py-1.5"
                            />
                          )}
                          <td className={`border border-slate-100 px-2 py-1.5 text-left ${mismatch ? "bg-orange-100" : "text-center"}`}>
                            {override ? (
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-slate-800" title={override.name}>
                                  {override.name} <span className="rounded bg-emerald-200 px-1 text-[10px] text-emerald-800">đã đổi</span>
                                </span>
                                <button className="shrink-0 text-[11px] text-slate-400 hover:text-slate-600" onClick={() => clearWorkItemOverride(m.existing.id)}>
                                  Hoàn tác
                                </button>
                              </div>
                            ) : mismatch ? (
                              <div>
                                <div className="text-slate-500">{m.existing.workItemCode ?? "(chưa gán)"} (đang giữ)</div>
                                <div className="mt-0.5 flex items-center gap-1 text-orange-700">
                                  <span>⚠ Gợi ý: {m.next.matchedWorkItemName}</span>
                                  <button
                                    className="shrink-0 rounded bg-orange-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-orange-700"
                                    onClick={() => applyWorkItemOverride(m.existing.id, m.next.matchedWorkItemId as string, m.next.matchedWorkItemName as string)}
                                  >
                                    Đổi sang mã này
                                  </button>
                                </div>
                              </div>
                            ) : (
                              m.existing.workItemCode ?? "(chưa gán)"
                            )}
                          </td>
                          <td className="border border-slate-100 px-2 py-1.5" />
                        </tr>
                      );
                    }
                    if (entry.kind === "removed") {
                      const r = entry.r;
                      return (
                        <tr key={`x${entry.sortKey}`} className="border-t border-slate-100 bg-red-50 text-left">
                          <td className="border border-slate-100 px-2 py-1.5 text-center text-slate-500">{r.stt}</td>
                          <td className="max-w-[360px] border border-slate-100 px-2 py-1.5 text-slate-700">
                            {r.rawDescription}
                            {r.hasSubData && <span className="ml-1 rounded bg-red-200 px-1 text-[10px] text-red-700">đã có dữ liệu thầu phụ</span>}
                          </td>
                          <td className="border border-slate-100 px-2 py-1.5 text-center text-slate-400">—</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-center text-slate-700">{r.isHeading ? "-" : r.rawUnit}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-center text-slate-400">—</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-right text-slate-700">{r.isHeading ? "-" : fmtQty(r.quantity)}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-center text-slate-400">—</td>
                          {priced.price && (
                            <>
                              <td className="border border-slate-100 px-2 py-1.5" />
                              <td className="border border-slate-100 px-2 py-1.5" />
                              {priced.amount && <td className="border border-slate-100 px-2 py-1.5" />}
                            </>
                          )}
                          <td className="border border-slate-100 px-2 py-1.5 text-center text-slate-500">{r.workItemCode ?? "(chưa gán)"}</td>
                          <td className="border border-slate-100 px-2 py-1.5 text-center">
                            <label className="flex items-center justify-center gap-1 whitespace-nowrap">
                              <input type="checkbox" checked={removeIds.has(r.id)} onChange={(e) => toggleRemove(r.id, e.target.checked)} className="h-3.5 w-3.5 cursor-pointer" />
                              Xoá
                            </label>
                          </td>
                        </tr>
                      );
                    }
                    const { idx, r } = entry;
                    return (
                    <tr key={`c${entry.sortKey}`} className="border-t border-slate-100 bg-sky-50 text-left align-top">
                      <td className="border border-slate-100 px-2 py-1.5 text-center font-semibold text-slate-700">{r.stt}</td>
                      <td className="border border-slate-100 px-2 py-1.5 text-center text-slate-400">—</td>
                      <td className={`max-w-[360px] border border-slate-100 px-2 py-1.5 text-slate-900 ${r.isHeading ? "font-semibold" : ""}`}>
                        {r.desc} {r.isHeading && <span className="ml-1 rounded bg-sky-200 px-1 text-[10px] font-normal">Đầu mục</span>}{r.images?.length ? <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] font-normal text-sky-700" title="Số ảnh lấy từ file Excel">🖼 {r.images.length}</span> : null}
                      </td>
                      <td className="border border-slate-100 px-2 py-1.5 text-center text-slate-400">—</td>
                      <td className="border border-slate-100 px-2 py-1.5 text-center text-slate-700">{r.isHeading ? "-" : r.unit}</td>
                      <td className="border border-slate-100 px-2 py-1.5 text-center text-slate-400">—</td>
                      <td className="border border-slate-100 px-2 py-1.5 text-right">
                        {r.isHeading ? (
                          "-"
                        ) : (
                          <NumInput value={r.qty} decimals qty onLive={(v) => updateCreated(idx, { qty: v })} onCommit={() => {}} className="w-24 rounded-md border border-slate-300 px-1 py-0.5 text-right text-xs" />
                        )}
                      </td>
                      {priced.price && (
                        <PriceCells
                          row={{ qty: r.qty, price: r.price ?? null, amount: r.amount ?? null, isHeading: r.isHeading }}
                          showAmount={priced.amount}
                          onPrice={(v) => updateCreated(idx, { price: v })}
                          cellClass="border border-slate-100 px-2 py-1.5"
                        />
                      )}
                      <td className="min-w-[220px] border border-slate-100 px-2 py-1.5">
                        {r.isHeading ? (
                          ""
                        ) : r.workItemId ? (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-800">{r.workItemName}</span>
                            <button className="text-[11px] text-slate-400 hover:text-slate-600" onClick={() => updateCreated(idx, { workItemId: null, workItemName: null, workItemUnit: null })}>
                              Đổi
                            </button>
                          </div>
                        ) : (
                          <WorkItemInlineSearch items={catalog} suggestions={r.candidates} onPick={(item) => updateCreated(idx, { workItemId: item.id, workItemName: item.name, workItemUnit: item.unit, matchType: "manual" })} />
                        )}
                      </td>
                      <td className="border border-slate-100 px-2 py-1.5 text-center">
                        <button onClick={() => removeCreated(idx)} className="text-[11px] text-red-500 hover:underline">
                          Xoá
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                  {matched.length === 0 && created.length === 0 && removedCandidates.length === 0 && (
                    <tr>
                      <td colSpan={9 + (priced.price ? (priced.amount ? 3 : 2) : 0)} className="px-2 py-4 text-center text-slate-400">
                        Không có dòng nào để so sánh.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <div className="flex gap-2">
            <button onClick={() => setStep("mapping")} className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">
              Quay lại
            </button>
            <button onClick={handleApply} disabled={busy} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40">
              {busy ? "Đang áp dụng..." : `Áp dụng cập nhật BOQ${removeIds.size ? ` (xoá ${removeIds.size} dòng)` : ""}`}
            </button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center">
          <p className="text-sm font-medium text-green-800">
            Đã cập nhật BOQ: {matched.length} dòng cập nhật khối lượng, {created.length} dòng mới, {removeIds.size} dòng đã xoá.
          </p>
          <button onClick={() => onClose?.()} className="mt-3 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
            Đóng
          </button>
        </div>
      )}
    </div>
  );
}
