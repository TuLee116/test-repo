"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminDeletePricesAction } from "@/lib/admin-delete-actions";

// Quản trị: tick các hồ sơ trong 1 nhóm hợp đồng (ô tick nằm trong bảng, gắn form={formId}) rồi xoá cùng lúc
export default function BulkDelete({ formId }: { formId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [n, setN] = useState(0);
  const boxes = () => [...document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][form="${formId}"]`)];
  // ô tick nằm ngoài <form> (trong bảng) nên sự kiện không nổi lên form → nghe ở document
  useEffect(() => {
    const on = (e: Event) => {
      if (e.target instanceof HTMLInputElement && e.target.getAttribute("form") === formId) setN(boxes().filter((b) => b.checked).length);
    };
    document.addEventListener("change", on);
    return () => document.removeEventListener("change", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);
  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault();
        const ids = boxes().filter((b) => b.checked).map((b) => b.value);
        if (!ids.length) return window.alert("Tick các hồ sơ cần xoá");
        if (!window.confirm(`[Quản trị] Xoá hẳn ${ids.length} hồ sơ đã chọn (kể cả đã duyệt)? Giá đã ghi vào sổ giá từ các hồ sơ này cũng bị gỡ. Không khôi phục được.`)) return;
        start(async () => {
          const r = await adminDeletePricesAction(ids);
          if (!r.ok) return window.alert(r.error);
          setN(0);
          router.refresh();
        });
      }}
      className="flex items-center gap-3 px-2 pt-2 text-xs"
    >
      <label className="flex cursor-pointer items-center gap-1 text-slate-600">
        <input
          type="checkbox"
          onChange={(e) => {
            for (const b of boxes()) b.checked = e.target.checked;
            setN(e.target.checked ? boxes().length : 0);
          }}
        />
        Chọn tất cả
      </label>
      <button type="submit" disabled={pending || !n} className="rounded-md border border-red-300 bg-white px-3 py-1 text-red-700 hover:bg-red-50 disabled:opacity-40">
        {pending ? "Đang xoá..." : `🗑 Xoá các hồ sơ đã chọn (${n})`}
      </button>
      <span className="text-slate-400">Chỉ quản trị thấy mục này</span>
    </form>
  );
}
