"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { rebuildSheetsAction } from "@/lib/hop-dong-actions";

// Chụp lại các sheet DT-CP / BOQ / CHI TIẾT từ file Excel gốc đã lưu (cập nhật cách hiển thị, không phải chọn lại file)
export default function RebuildSheetsButton({ contractId }: { contractId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      title="Đọc lại các sheet từ file Excel gốc đã lưu trong phần mềm"
      className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      onClick={() =>
        start(async () => {
          const r = await rebuildSheetsAction(contractId);
          if (!r.ok) return window.alert(r.error);
          router.refresh();
        })
      }
    >
      {pending ? "Đang đọc lại..." : "↻ Đọc lại từ file gốc"}
    </button>
  );
}
