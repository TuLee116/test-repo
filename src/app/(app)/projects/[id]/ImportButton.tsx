"use client";

import { useRef, useState } from "react";
import ImportWizard from "./import/ImportWizard";
import type { CatalogOption } from "./import/WorkItemInlineSearch";

export default function ImportButton({ projectId, catalog, sheetId = null }: { projectId: string; catalog: CatalogOption[]; sheetId?: string | null }) {
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
        onClick={() => inputRef.current?.click()}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
      >
        Nhập từ Excel
      </button>

      {open && file && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="my-4 w-full max-w-[96vw] rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Nhập BOQ từ Excel</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
            <div className="mt-4">
              <ImportWizard
                key={file.name + file.lastModified}
                projectId={projectId}
                catalog={catalog}
                sheetId={sheetId}
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
