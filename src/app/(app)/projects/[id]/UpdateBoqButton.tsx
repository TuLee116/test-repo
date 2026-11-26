"use client";

import { useRef, useState } from "react";
import UpdateBoqWizard from "./import/UpdateBoqWizard";
import type { CatalogOption } from "./import/WorkItemInlineSearch";
import type { ExistingBoqRow } from "@/lib/boq-diff";

// Khác "Nhập từ Excel" (luôn tạo dòng mới): dùng khi CĐT gửi lại BOQ đã sửa đổi, khớp theo mô tả công
// việc với BOQ hiện có để giữ lại mã định mức/giá đã gán, chỉ cập nhật khối lượng.
export default function UpdateBoqButton({
  projectId,
  sheetId,
  catalog,
  existingItems,
}: {
  projectId: string;
  sheetId: string | null;
  catalog: CatalogOption[];
  existingItems: ExistingBoqRow[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setFile(f);
            setOpen(true);
          }
          e.target.value = "";
        }}
      />
      <button
        type="button"
        title="CĐT gửi BOQ sửa đổi: khớp theo mô tả công việc với BOQ hiện tại, giữ lại mã định mức/giá đã gán, chỉ cập nhật khối lượng"
        onClick={() => inputRef.current?.click()}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
      >
        Cập nhật BOQ
      </button>

      {open && file && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="my-4 w-full max-w-[96vw] rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Cập nhật BOQ từ file CĐT sửa đổi</h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                ✕
              </button>
            </div>
            <div className="mt-4">
              <UpdateBoqWizard
                key={file.name + file.lastModified}
                projectId={projectId}
                sheetId={sheetId}
                catalog={catalog}
                existingItems={existingItems}
                initialFile={file}
                onClose={() => setOpen(false)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
