"use client";

import { useState } from "react";

// Ô chọn hợp đồng của DT-CP, dùng ở form tạo dự án và ở sheet Thông tin dự án.
// Tạo mới: "DT-CP mới (hợp đồng mới)" hoặc "thuộc hợp đồng đã có" (VD phụ lục). Sửa (có current): thêm "Giữ nguyên hợp đồng hiện tại" (đổi được tên hợp đồng).
export default function ContractFields({ options, current }: { options: { value: string; label: string }[]; current?: { name: string; count: number } }) {
  const [mode, setMode] = useState<"keep" | "new" | "existing">(current ? "keep" : "new");
  const radio = "flex cursor-pointer items-center gap-2";
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 sm:col-span-2 lg:col-span-4">
      <div className="text-sm font-medium text-slate-700">Hợp đồng</div>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {current && (
          <label className={radio}>
            <input type="radio" name="contractMode" value="keep" checked={mode === "keep"} onChange={() => setMode("keep")} />
            Giữ nguyên hợp đồng hiện tại
          </label>
        )}
        <label className={radio}>
          <input type="radio" name="contractMode" value="new" checked={mode === "new"} onChange={() => setMode("new")} />
          {current ? "Tách thành hợp đồng mới" : "DT-CP mới (hợp đồng mới)"}
        </label>
        <label className={`flex items-center gap-2 ${options.length ? "cursor-pointer" : "cursor-not-allowed text-slate-400"}`}>
          <input type="radio" name="contractMode" value="existing" disabled={options.length === 0} checked={mode === "existing"} onChange={() => setMode("existing")} />
          {current ? "Chuyển sang hợp đồng đã có (VD phụ lục)" : "DT-CP thuộc hợp đồng đã có (VD phụ lục)"}
        </label>
      </div>
      {mode === "keep" && current && (
        <div className="mt-2">
          <label className="block text-xs text-slate-500">
            Số / tên hợp đồng hiện tại ({current.count} DT-CP thuộc hợp đồng này) — sửa để đổi tên hợp đồng
          </label>
          <input name="contractName" defaultValue={current.name} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none" />
        </div>
      )}
      {mode === "new" && (
        <div className="mt-2">
          <label className="block text-xs text-slate-500">Số / tên hợp đồng mới (để trống = lấy theo tên dự án)</label>
          <input name="contractName" className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none" />
        </div>
      )}
      {mode === "existing" && (
        <div className="mt-2">
          <label className="block text-xs text-slate-500">Chọn hợp đồng</label>
          <select name="contractRef" required className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none">
            <option value="">— Chọn hợp đồng —</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
