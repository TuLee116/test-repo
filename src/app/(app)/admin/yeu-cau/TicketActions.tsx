"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideAiTicketAction } from "@/lib/ai-actions";

// Nút xử lý phiếu yêu cầu (chỉ quản trị): Duyệt / Từ chối / Đánh dấu xong, kèm ghi chú gửi lại người dùng
export default function TicketActions({ id, status, note: initNote }: { id: string; status: string; note: string }) {
  const [note, setNote] = useState(initNote);
  const [pending, start] = useTransition();
  const router = useRouter();
  const go = (s: "APPROVED" | "REJECTED" | "DONE") =>
    start(async () => {
      const r = await decideAiTicketAction(id, s, note);
      if (!r.ok) return void window.alert(r.error);
      router.refresh();
    });
  return (
    <div className="mt-2 space-y-2">
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Ghi chú gửi lại người dùng (bắt buộc khi từ chối)" className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />
      <div className="flex flex-wrap gap-2">
        {status === "PENDING" && (
          <>
            <button disabled={pending} onClick={() => go("APPROVED")} className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50">
              ✓ Duyệt (cho phép chỉnh sửa)
            </button>
            <button disabled={pending} onClick={() => go("REJECTED")} className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
              ✕ Từ chối
            </button>
          </>
        )}
        {status === "APPROVED" && (
          <button disabled={pending} onClick={() => go("DONE")} className="rounded-md bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50">
            ✔ Đánh dấu đã xong
          </button>
        )}
        {status !== "PENDING" && (
          <button disabled={pending} onClick={() => go(status === "DONE" ? "DONE" : status === "REJECTED" ? "REJECTED" : "APPROVED")} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Lưu ghi chú
          </button>
        )}
      </div>
    </div>
  );
}
