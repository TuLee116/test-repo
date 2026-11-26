"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";

// Nút "Tạo DT-CP" trên thanh menu: mở biểu mẫu trong cửa sổ nổi (biểu mẫu truyền qua children).
// Nút nằm ở layout nên không tự mất khi chuyển trang: key theo đường dẫn để tạo xong (chuyển sang DT-CP mới) cửa sổ tự đóng.
export default function CreateDtcpButton({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <Inner key={pathname}>{children}</Inner>;
}

function Inner({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="w-full rounded-md bg-gradient-to-r from-sky-600 to-blue-700 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:from-sky-700 hover:to-blue-800">
        + Tạo DT-CP
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/40 p-4 text-left">
          <div className="my-6 w-full max-w-5xl rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Tạo DT-CP</h2>
              <button type="button" aria-label="Đóng" onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                ✕
              </button>
            </div>
            {children}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
