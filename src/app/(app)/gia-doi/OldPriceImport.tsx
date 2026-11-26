"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { analyzeOldPriceAction, importOldPriceAction, type OldSheetInfo } from "@/lib/gia-doi-import";
import { CATEGORIES } from "@/lib/gia-doi-calc";

type Contract = { id: string; name: string; packageName: string; contractNo: string };
type Row = OldSheetInfo & { on: boolean; crew: string; reviewer: string };

const money = (n: number) => Math.round(n).toLocaleString("vi-VN");

// Nhập hồ sơ giá đội CŨ ĐÃ DUYỆT (các đợt trước khi dùng phần mềm) → ghi sổ giá của hợp đồng, sẵn sàng so cho đợt đề xuất tiếp theo
export default function OldPriceImport({ contracts, contractId: fixedContract }: { contracts: Contract[]; contractId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [contractId, setContractId] = useState(fixedContract ?? "");
  const [category, setCategory] = useState("");
  const [crewAll, setCrewAll] = useState("");
  const [reviewerAll, setReviewerAll] = useState("");

  const reset = () => {
    setFile(null);
    setRows([]);
    setCrewAll("");
    setReviewerAll("");
  };
  const analyze = (f: File) =>
    start(async () => {
      setFile(f);
      const fd = new FormData();
      fd.set("file", f);
      const r = await analyzeOldPriceAction(fd);
      if (!r.ok) {
        setFile(null);
        return window.alert(r.error);
      }
      setRows(r.sheets.map((s) => ({ ...s, on: s.approved > 0, crew: "", reviewer: "" })));
    });
  const set = (i: number, patch: Partial<Row>) => setRows((x) => x.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.on);

  const save = () => {
    if (!file) return;
    if (!contractId) return window.alert("Chọn hợp đồng (DT-CP) của hồ sơ");
    if (!chosen.length) return window.alert("Tick ít nhất 1 đợt (sheet) để nhập");
    const missing = chosen.find((r) => !r.date);
    if (missing) return window.alert(`Sheet "${missing.sheetName}": nhập ngày duyệt`);
    if (!window.confirm(`Ghi nhận ${chosen.length} đợt đã duyệt vào sổ giá hợp đồng?`)) return;
    start(async () => {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("contractId", contractId);
      fd.set("category", category);
      fd.set("config", JSON.stringify(chosen.map((r) => ({ sheetName: r.sheetName, date: r.date, crew: r.crew || crewAll, batch: r.batch, reviewer: r.reviewer || reviewerAll }))));
      const r = await importOldPriceAction(fd);
      if (!r.ok) return window.alert(r.error);
      window.alert(`Đã nhập ${r.count} đợt, ghi ${r.prices} dòng giá duyệt vào sổ giá hợp đồng.`);
      reset();
      setOpen(false);
      router.refresh();
    });
  };

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-emerald-400 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100">
        📥 Nhập hồ sơ cũ đã duyệt (các đợt trước)
      </button>
    );

  const inp = "w-full rounded border border-slate-300 px-2 py-1 text-sm";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-6" onClick={() => !pending && setOpen(false)}>
      <div className="w-full max-w-6xl space-y-3 rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="font-semibold text-slate-900">Nhập hồ sơ giá đội cũ ĐÃ DUYỆT</h3>
          <p className="text-xs text-slate-500">
            Mỗi sheet trong file = 1 đợt. Giá duyệt lấy ở cột <b>Đơn giá của P.ĐT-TT</b>; dòng chỉ ghi &quot;Đồng ý&quot; (không có đơn giá) hoặc file không có khối P.ĐT-TT thì lấy <b>giá BCH đề xuất</b>. Dòng không có kết quả duyệt (dòng phân tích, &quot;trình sau&quot;...) chỉ lưu ở hồ sơ, không vào sổ giá. Giá có hiệu lực từ <b>ngày duyệt</b> anh nhập.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm lg:col-span-2">
            <span className="font-medium text-slate-700">Hợp đồng (DT-CP) *</span>
            <select className={inp} value={contractId} disabled={!!fixedContract} onChange={(e) => setContractId(e.target.value)}>
              <option value="">— chọn hợp đồng —</option>
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.packageName ? ` — ${c.packageName}` : ""}
                  {c.contractNo ? ` (${c.contractNo})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="font-medium text-slate-700">Hạng mục (Trưởng phòng đã duyệt)</span>
            <select className={inp} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">— không ghi —</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="font-medium text-slate-700">File Excel đệ trình cũ (.xlsx)</span>
            <input type="file" accept=".xlsx" className="block w-full text-sm" disabled={pending} onChange={(e) => e.target.files?.[0] && analyze(e.target.files[0])} />
          </label>
        </div>

        {pending && !rows.length && <p className="text-sm text-slate-500">Đang đọc file...</p>}

        {rows.length > 0 && (
          <>
            <div className="flex flex-wrap items-end gap-3 rounded-md bg-slate-50 p-2 text-sm">
              <span className="text-slate-600">Điền chung cho các đợt để trống:</span>
              <label>
                Đội <input className="ml-1 rounded border border-slate-300 px-2 py-1" value={crewAll} onChange={(e) => setCrewAll(e.target.value)} placeholder="tên tổ đội (có thể trống)" />
              </label>
              <label>
                Người duyệt <input className="ml-1 rounded border border-slate-300 px-2 py-1" value={reviewerAll} onChange={(e) => setReviewerAll(e.target.value)} placeholder="VD: Nguyễn Quốc Đạt" />
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-left text-xs text-slate-600">
                  <tr>
                    <th className="px-2 py-1.5">Nhập</th>
                    <th className="px-2 py-1.5">Sheet (đợt)</th>
                    <th className="px-2 py-1.5">Mẫu</th>
                    <th className="px-2 py-1.5 text-right">Dòng duyệt / tổng</th>
                    <th className="px-2 py-1.5 text-right">Giá trị duyệt</th>
                    <th className="px-2 py-1.5">Ngày duyệt *</th>
                    <th className="px-2 py-1.5">Đợt</th>
                    <th className="px-2 py-1.5">Đội</th>
                    <th className="px-2 py-1.5">Người duyệt</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.sheetName} className={`border-t border-slate-100 ${r.on ? "" : "opacity-50"}`}>
                      <td className="px-2 py-1">
                        <input type="checkbox" className="h-4 w-4" checked={r.on} onChange={(e) => set(i, { on: e.target.checked })} />
                      </td>
                      <td className="px-2 py-1 font-medium">{r.sheetName}</td>
                      <td className="px-2 py-1 text-xs text-slate-500">{r.kindLabel}</td>
                      <td className="px-2 py-1 text-right">
                        {r.approved} / {r.items}
                      </td>
                      <td className="px-2 py-1 text-right">{money(r.total)}</td>
                      <td className="px-2 py-1">
                        <input type="date" className={inp} value={r.date} onChange={(e) => set(i, { date: e.target.value })} />
                      </td>
                      <td className="px-2 py-1">
                        <input className={inp} value={r.batch} onChange={(e) => set(i, { batch: e.target.value })} />
                      </td>
                      <td className="px-2 py-1">
                        <input className={inp} value={r.crew} placeholder={crewAll} onChange={(e) => set(i, { crew: e.target.value })} />
                      </td>
                      <td className="px-2 py-1">
                        <input className={inp} value={r.reviewer} placeholder={reviewerAll} onChange={(e) => set(i, { reviewer: e.target.value })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500">Ngày duyệt gợi ý theo tên sheet — kiểm tra lại theo ngày ký tờ trình. Sau khi nhập, phần mềm tự khớp từng dòng với TH Nhân Công của DT-CP; dòng chưa khớp vẫn lưu ở sổ (mục ngoài DT-CP).</p>
          </>
        )}

        <div className="flex gap-2">
          <button type="button" disabled={pending || !chosen.length} onClick={save} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50">
            {pending && rows.length ? "Đang ghi nhận..." : `Ghi nhận ${chosen.length || ""} đợt vào sổ giá`}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              reset();
              setOpen(false);
            }}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
          >
            Huỷ
          </button>
        </div>
      </div>
    </div>
  );
}
