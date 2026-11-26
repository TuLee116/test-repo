"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createBlankSheetAction } from "@/lib/actions";
import ImportWizard from "./import/ImportWizard";
import type { CatalogOption } from "./import/WorkItemInlineSearch";

// Nút "＋ Thêm sheet" ở thanh tab: thêm sheet ngoài 8 sheet chuẩn (Prelim, BPTC, BOQ hạng mục hoàn thiện...)
export default function AddSheetModal({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"" | "excel" | "blank">("");
  const [name, setName] = useState("");
  const [autoMatch, setAutoMatch] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState(20);
  const [cols, setCols] = useState(6);
  const [catalog, setCatalog] = useState<CatalogOption[] | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function close() {
    setOpen(false);
    setMode("");
    setName("");
    setFile(null);
    setError("");
  }

  function openModal() {
    setOpen(true);
    if (!catalog) {
      fetch("/api/catalog")
        .then((r) => r.json())
        .then((d) => setCatalog(d.items as CatalogOption[]));
    }
  }

  const card = "flex-1 rounded-lg border-2 p-4 text-left transition";

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="ml-1 whitespace-nowrap rounded-md border border-dashed border-slate-400 px-3 py-1 text-sm font-medium text-slate-600 hover:bg-slate-50"
        title="Thêm sheet mới (Prelim, BPTC, BOQ hạng mục khác...)"
      >
        ＋ Thêm sheet
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="my-4 w-full max-w-[96vw] rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Thêm sheet mới</h2>
              <button type="button" onClick={close} className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                ✕
              </button>
            </div>

            {/* Đã chọn file Excel → chạy trình nhập BOQ, kết quả nằm trong sheet mới */}
            {mode === "excel" && file ? (
              <div className="mt-4">
                <p className="mb-3 text-sm text-slate-600">
                  Sheet mới: <b>{name || file.name.replace(/\.[^.]+$/, "")}</b> ·{" "}
                  {autoMatch ? "chiết tính từ định mức (tự khớp mã, đưa vào CHI TIẾT)" : "không tự khớp định mức (tự link vào CHI TIẾT)"}
                </p>
                <ImportWizard
                  key={file.name + file.lastModified}
                  projectId={projectId}
                  catalog={catalog ?? []}
                  initialFile={file}
                  newSheetName={name.trim() || file.name.replace(/\.[^.]+$/, "")}
                  autoMatch={autoMatch}
                  onClose={close}
                />
              </div>
            ) : (
              <>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <button type="button" onClick={() => setMode("excel")} className={`${card} ${mode === "excel" ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-400"}`}>
                    <div className="font-semibold text-slate-900">📥 Nhập từ Excel</div>
                    <div className="mt-1 text-xs text-slate-500">Nhập BOQ / bảng Prelim, BPTC từ file Excel. Các dòng đi vào sheet mới và sheet CHI TIẾT.</div>
                  </button>
                  <button type="button" onClick={() => setMode("blank")} className={`${card} ${mode === "blank" ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-400"}`}>
                    <div className="font-semibold text-slate-900">▦ Sheet trống mới (bảng tự do)</div>
                    <div className="mt-1 text-xs text-slate-500">Chọn số dòng, số cột rồi gõ hoặc dán từ Excel. Có thể chọn 1 cột làm &quot;Thành tiền&quot; để link vào DT-CP.</div>
                  </button>
                </div>

                {mode !== "" && (
                  <div className="mt-4 space-y-3 rounded-lg border border-slate-200 p-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700">Tên sheet</label>
                      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Prelim, BPTC, Hoàn thiện tầng 1..." className="w-full max-w-md rounded border border-slate-300 px-2 py-1.5 text-sm" />
                    </div>

                    {mode === "excel" && (
                      <>
                        <div className="space-y-1.5 text-sm">
                          <label className="flex items-start gap-2">
                            <input type="radio" checked={autoMatch} onChange={() => setAutoMatch(true)} className="mt-1" />
                            <span>
                              <b>Chiết tính từ định mức</b> — hệ thống tự khớp mã định mức và bổ sung các dòng vào sheet CHI TIẾT.
                            </span>
                          </label>
                          <label className="flex items-start gap-2">
                            <input type="radio" checked={!autoMatch} onChange={() => setAutoMatch(false)} className="mt-1" />
                            <span>
                              <b>Link vào CHI TIẾT thủ công</b> — không tự khớp; các dòng vẫn hiện ở CHI TIẾT và anh tự chọn Mã ĐM, chuyển thầu phụ hoặc bổ sung định mức cho từng dòng.
                            </span>
                          </label>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700">File Excel</label>
                          <input
                            type="file"
                            accept=".xlsx,.xls"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) setFile(f);
                            }}
                            className="text-sm"
                          />
                        </div>
                      </>
                    )}

                    {mode === "blank" && (
                      <>
                        <div className="flex flex-wrap gap-4">
                          <div>
                            <label className="block text-xs font-medium text-slate-700">Số dòng</label>
                            <input type="number" min={1} max={500} value={rows} onChange={(e) => setRows(Number(e.target.value))} className="w-24 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-700">Số cột</label>
                            <input type="number" min={1} max={30} value={cols} onChange={(e) => setCols(Number(e.target.value))} className="w-24 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                          </div>
                        </div>
                        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              setError("");
                              try {
                                const res = await createBlankSheetAction(projectId, name, rows, cols);
                                close();
                                router.push(`/projects/${projectId}/s/${res.sheetId}`);
                              } catch (e) {
                                setError(e instanceof Error ? e.message : "Lỗi khi tạo sheet");
                              }
                            })
                          }
                          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                        >
                          {pending ? "Đang tạo..." : "Tạo sheet"}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
