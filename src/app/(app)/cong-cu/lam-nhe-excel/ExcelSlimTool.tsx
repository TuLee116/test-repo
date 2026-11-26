"use client";

import { useState } from "react";
import { browserResize, slimXlsx, type SlimOptions, type SlimReport } from "@/lib/excel-slim";

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
const MAX_FILE = 500 * 1024 * 1024;

// Công cụ LÀM NHẸ FILE EXCEL: xử lý ngay trên máy người dùng (file không gửi lên máy chủ) → tải về file nhẹ
export default function ExcelSlimTool() {
  const [file, setFile] = useState<File | null>(null);
  const [opt, setOpt] = useState<SlimOptions>({ images: "compress", maxSide: 1600, quality: 0.8, breakLinks: false, junk: true });
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<{ url: string; name: string; report: SlimReport } | null>(null);
  const [drag, setDrag] = useState(false);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!/\.(xlsx|xlsm)$/i.test(f.name)) return window.alert("Chỉ làm nhẹ được file .xlsx / .xlsm (file .xls cũ: mở bằng Excel rồi Lưu thành .xlsx trước)");
    if (f.size > MAX_FILE) return window.alert("File lớn hơn 500 MB — máy không đủ bộ nhớ để xử lý");
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    setFile(f);
  };

  const run = async () => {
    if (!file) return;
    setBusy("Đang đọc file...");
    setResult(null);
    try {
      const { data, report } = await slimXlsx(await file.arrayBuffer(), opt, browserResize, setBusy);
      const isM = /\.xlsm$/i.test(file.name);
      const blob = new Blob([data as BlobPart], { type: isM ? "application/vnd.ms-excel.sheet.macroEnabled.12" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const name = file.name.replace(/(\.xlsx|\.xlsm)$/i, ` (nhẹ)$1`);
      setResult({ url: URL.createObjectURL(blob), name, report });
    } catch (e) {
      window.alert(`Không làm nhẹ được file: ${e instanceof Error ? e.message : String(e)}\n(File có thể bị hỏng hoặc đang được đặt mật khẩu)`);
    } finally {
      setBusy("");
    }
  };

  const radio = (v: SlimOptions["images"], label: string, hint: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input type="radio" className="mt-1" checked={opt.images === v} onChange={() => setOpt({ ...opt, images: v })} />
      <span>
        <b>{label}</b> <span className="text-slate-500">— {hint}</span>
      </span>
    </label>
  );

  return (
    <div className="space-y-4">
      <div
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center ${drag ? "border-sky-500 bg-sky-50" : "border-slate-300 bg-white"}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        data-allow-large="1" // nhận cả file rất nặng: hộp chặn file >45MB chung của phần mềm bỏ qua vùng này
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          pick(e.dataTransfer.files[0]);
        }}
      >
        <p className="text-3xl">🗜</p>
        <p className="font-medium text-slate-800">{file ? file.name : "Kéo thả file Excel vào đây"}</p>
        <p className="text-sm text-slate-500">{file ? `Dung lượng hiện tại: ${mb(file.size)}` : "hoặc bấm nút bên dưới để chọn file (.xlsx, .xlsm — tối đa 500 MB)"}</p>
        <label className="mt-1 cursor-pointer rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
          {file ? "Chọn file khác" : "Chọn file"}
          <input type="file" accept=".xlsx,.xlsm" data-allow-large="1" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
      </div>

      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2">
        <div className="space-y-2">
          <p className="font-medium text-slate-800">🖼 Ảnh trong file</p>
          {radio("compress", "Nén ảnh", "thu nhỏ ảnh, vẫn xem / in rõ (thường nhẹ đi 10–20 lần)")}
          {opt.images === "compress" && (
            <label className="ml-6 flex items-center gap-2 text-sm text-slate-600">
              Cạnh dài tối đa
              <select className="rounded border border-slate-300 px-2 py-1" value={opt.maxSide} onChange={(e) => setOpt({ ...opt, maxSide: Number(e.target.value) })}>
                <option value={1200}>1200 px (nhẹ nhất)</option>
                <option value={1600}>1600 px (khuyên dùng)</option>
                <option value={2400}>2400 px (in khổ lớn rõ hơn)</option>
              </select>
            </label>
          )}
          {radio("delete", "Xoá hẳn ảnh", "khi ảnh chỉ để minh hoạ, không cần giữ")}
          {radio("keep", "Giữ nguyên ảnh", "")}
        </div>
        <div className="space-y-2">
          <p className="font-medium text-slate-800">🧹 Dọn thêm</p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={opt.junk} onChange={(e) => setOpt({ ...opt, junk: e.target.checked })} />
            <span>
              <b>Dọn rác</b> <span className="text-slate-500">— tên vùng lỗi #REF!, cài đặt máy in, bảng tính toán tạm (Excel tự tạo lại, không ảnh hưởng số liệu)</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={opt.breakLinks} onChange={(e) => setOpt({ ...opt, breakLinks: e.target.checked })} />
            <span>
              <b>Gỡ liên kết tới file Excel khác</b>{" "}
              <span className="text-slate-500">— ô lấy số từ file khác được giữ nguyên giá trị đang hiện (như &quot;Break Links&quot;), hết hỏi &quot;Update links&quot; khi mở file</span>
            </span>
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={!file || !!busy} onClick={run} className="rounded-md bg-sky-700 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50">
          {busy ? "Đang xử lý..." : "🗜 Làm nhẹ file"}
        </button>
        {busy && <span className="text-sm text-slate-600">{busy}</span>}
      </div>

      {result && (
        <div className="space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-lg font-semibold text-emerald-900">
            {mb(result.report.before)} → {mb(result.report.after)}{" "}
            <span className="text-sm font-normal">(nhẹ đi {Math.max(0, Math.round((1 - result.report.after / result.report.before) * 100))}%)</span>
          </p>
          <ul className="list-inside list-disc text-sm text-emerald-900">
            {result.report.imagesCompressed > 0 && <li>Đã nén {result.report.imagesCompressed} ảnh</li>}
            {result.report.imagesDeleted > 0 && <li>Đã xoá {result.report.imagesDeleted} ảnh</li>}
            {result.report.linksRemoved > 0 && (
              <li>
                Đã gỡ {result.report.linksRemoved} liên kết tới file khác ({result.report.formulasToValues} ô chuyển thành giá trị)
              </li>
            )}
            {result.report.namesRemoved > 0 && <li>Đã xoá {result.report.namesRemoved.toLocaleString("vi-VN")} tên vùng lỗi / thừa</li>}
            {result.report.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          {result.report.after > 45 * 1024 * 1024 && (
            <p className="text-sm text-amber-800">⚠ File vẫn trên 45 MB — chọn &quot;Xoá hẳn ảnh&quot; hoặc cạnh ảnh 1200 px rồi làm lại để tải lên phần mềm được.</p>
          )}
          <a href={result.url} download={result.name} className="inline-block rounded-md bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
            ⬇ Tải file nhẹ: {result.name}
          </a>
          <p className="text-xs text-slate-500">Mở file vừa tải bằng Excel kiểm tra lại trước khi dùng. File gốc trên máy không bị thay đổi.</p>
        </div>
      )}
    </div>
  );
}
