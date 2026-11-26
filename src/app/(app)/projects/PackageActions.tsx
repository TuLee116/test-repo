"use client";

import { useEffect, useRef, useState } from "react";
import ProjectRowActions from "./ProjectRowActions";

// Nút "⋯" ở từng gói thầu trong menu dọc: mở bảng Điều chỉnh / Nhân bản / Xoá ngay cạnh nút (đặt fixed để không bị menu cuộn cắt mất)
export default function PackageActions({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setPos(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pos]);

  return (
    <div ref={root} className="shrink-0">
      <button
        type="button"
        title="Điều chỉnh / Nhân bản / Xoá"
        aria-label="Thao tác với gói thầu"
        onClick={(e) => {
          if (pos) return setPos(null);
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ left: Math.min(r.right + 6, window.innerWidth - 420), top: Math.min(r.top - 4, window.innerHeight - 90) });
        }}
        className="rounded px-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
      >
        ⋯
      </button>
      {pos && (
        <div className="fixed z-50 rounded-lg border border-slate-200 bg-white p-2 shadow-xl" style={{ left: Math.max(4, pos.left), top: pos.top }}>
          <ProjectRowActions projectId={projectId} projectName={projectName} />
        </div>
      )}
    </div>
  );
}
