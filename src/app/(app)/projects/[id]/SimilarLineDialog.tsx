"use client";

import { useState, useTransition } from "react";
import { addLineToWorkItemsAction, type SimilarWorkItem } from "@/lib/actions";

// Sau khi thêm 1 dòng hao phí cho 1 công tác: liệt kê các công tác CÙNG LOẠI trong dự án (chưa có hao phí
// này) để người dùng tick chọn bổ sung luôn, khỏi phải thêm tay từng công tác.
export default function SimilarLineDialog({
  sourceWorkItemId,
  resourceId,
  resourceName,
  items,
  onClose,
}: {
  sourceWorkItemId: string;
  resourceId: string;
  resourceName: string;
  items: SimilarWorkItem[];
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(items.map((i) => i.workItemId)));
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const all = picked.size === items.length;
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
            <h2 className="text-base font-semibold text-slate-900">Bổ sung cho các công tác tương tự?</h2>
            <p className="mt-1 text-xs text-slate-600">
              Vừa thêm hao phí <b>{resourceName}</b>. Các công tác cùng loại dưới đây trong dự án chưa có hao phí này — tick chọn công tác cần bổ sung (định mức tự quy đổi theo ĐVT của từng định mức, VD kg ↔ tấn).
            </p>
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
                  <input type="checkbox" checked={all} onChange={() => setPicked(all ? new Set() : new Set(items.map((i) => i.workItemId)))} title="Chọn / bỏ chọn tất cả" />
                </th>
                <th className="border-b border-slate-200 px-2 py-1.5">Công tác BOQ (STT)</th>
                <th className="w-48 border-b border-slate-200 px-2 py-1.5">Định mức</th>
                <th className="w-14 border-b border-slate-200 px-2 py-1.5">ĐVT</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.workItemId} className="cursor-pointer border-b border-slate-100 align-top hover:bg-blue-50/50" onClick={() => toggle(it.workItemId)}>
                  <td className="px-2 py-1.5">
                    <input type="checkbox" checked={picked.has(it.workItemId)} onChange={() => toggle(it.workItemId)} onClick={(e) => e.stopPropagation()} />
                  </td>
                  <td className="px-2 py-1.5">
                    {it.rows.map((r, i) => (
                      <div key={i} className="leading-snug">
                        <span className="mr-1 font-mono text-slate-400">[{r.stt || "?"}]</span>
                        {r.desc}
                      </div>
                    ))}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="font-mono text-slate-700">{it.code}</div>
                    <div className="text-[11px] text-slate-500">{it.name}</div>
                  </td>
                  <td className="px-2 py-1.5 text-slate-600">{it.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-amber-700">Lưu ý: định mức dùng chung cho mọi gói thầu — dự án khác đang dùng các định mức này cũng sẽ có thêm dòng hao phí.</p>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            Không, chỉ công tác vừa sửa
          </button>
          <button
            type="button"
            disabled={pending || picked.size === 0}
            onClick={() =>
              start(async () => {
                try {
                  await addLineToWorkItemsAction(sourceWorkItemId, resourceId, [...picked]);
                  onClose();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Lỗi");
                }
              })
            }
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
          >
            {pending ? "Đang bổ sung..." : `Bổ sung cho ${picked.size} công tác đã chọn`}
          </button>
        </div>
      </div>
    </div>
  );
}
