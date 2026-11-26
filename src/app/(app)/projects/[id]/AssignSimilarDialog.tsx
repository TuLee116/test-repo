"use client";

import { useState, useTransition } from "react";
import { assignWorkItemToRowsAction, type UnassignedSimilarRow } from "@/lib/actions";

// Sau khi tạo định mức mới cho 1 dòng BOQ: liệt kê các dòng CÙNG LOẠI trong dự án còn "Chưa có ĐM" để
// người dùng tick chọn gán luôn định mức vừa tạo.
export default function AssignSimilarDialog({
  projectId,
  workItemId,
  code,
  rows,
  onClose,
}: {
  projectId: string;
  workItemId: string;
  code: string;
  rows: UnassignedSimilarRow[];
  onClose: () => void;
}) {
  // mặc định KHÔNG chọn sẵn: các dòng cùng loại thường khác quy cách, người dùng tự chọn dòng phù hợp
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const all = picked.size === rows.length;
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="my-8 w-full max-w-3xl rounded-lg bg-white p-5 text-left not-italic text-slate-800 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Gán định mức {code} cho các công tác tương tự?</h2>
            <p className="mt-1 text-xs text-slate-600">Các dòng cùng loại dưới đây trong dự án đang &quot;Chưa có ĐM&quot;. Tick chọn dòng dùng chung định mức vừa tạo.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            ✕
          </button>
        </div>
        <div className="mt-3 max-h-[60vh] overflow-y-auto rounded border border-slate-200">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="w-8 border-b border-slate-200 px-2 py-1.5">
                  <input type="checkbox" checked={all} onChange={() => setPicked(all ? new Set() : new Set(rows.map((r) => r.id)))} title="Chọn / bỏ chọn tất cả" />
                </th>
                <th className="w-12 border-b border-slate-200 px-2 py-1.5">STT</th>
                <th className="border-b border-slate-200 px-2 py-1.5">Công tác BOQ</th>
                <th className="w-14 border-b border-slate-200 px-2 py-1.5">ĐVT</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-b border-slate-100 align-top hover:bg-blue-50/50" onClick={() => toggle(r.id)}>
                  <td className="px-2 py-1.5">
                    <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} />
                  </td>
                  <td className="px-2 py-1.5 font-mono text-slate-500">{r.stt}</td>
                  <td className="px-2 py-1.5">{r.desc}</td>
                  <td className="px-2 py-1.5 text-slate-600">{r.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            Không cần
          </button>
          <button
            type="button"
            disabled={pending || picked.size === 0}
            onClick={() =>
              start(async () => {
                try {
                  await assignWorkItemToRowsAction(projectId, [...picked], workItemId);
                  onClose();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Lỗi");
                }
              })
            }
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
          >
            {pending ? "Đang gán..." : `Gán cho ${picked.size} dòng đã chọn`}
          </button>
        </div>
      </div>
    </div>
  );
}
