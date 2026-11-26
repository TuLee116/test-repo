"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { MyTask } from "@/lib/my-tasks";

// Chuông "Việc của tôi" trên thanh menu + HỘP NHẮC tự bật 1 lần sau mỗi lần đăng nhập khi có việc cần xử lý.
// (trang đăng nhập xoá cờ "đã nhắc" → đăng nhập lại là được nhắc lại)
export const REMIND_KEY = "dtcp-task-reminded";

export default function TaskBell({ tasks, userId }: { tasks: MyTask[]; userId: string }) {
  const [open, setOpen] = useState(false);
  const [popup, setPopup] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const total = tasks.reduce((s, t) => s + t.count, 0);

  useEffect(() => {
    if (!total) return;
    try {
      if (sessionStorage.getItem(REMIND_KEY) === userId) return;
    } catch {
      /* trình duyệt chặn sessionStorage: vẫn nhắc */
    }
    // bật hộp nhắc sau khi trang hiện xong (đánh dấu "đã nhắc" lúc bật để không nhắc lại khi chuyển trang)
    const t = setTimeout(() => {
      try {
        sessionStorage.setItem(REMIND_KEY, userId);
      } catch {}
      setPopup(true);
    }, 400);
    return () => clearTimeout(t);
  }, [total, userId]);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);

  const list = (onPick: () => void) =>
    tasks.length === 0 ? (
      <p className="px-3 py-4 text-center text-sm text-slate-500">Không có việc nào đang chờ bạn 👍</p>
    ) : (
      <ul className="divide-y divide-slate-100">
        {tasks.map((t) => (
          <li key={`${t.app}-${t.label}`}>
            <Link href={t.href} onClick={onPick} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-sky-50">
              <span className="min-w-7 rounded-full bg-red-600 px-1.5 text-center text-xs font-semibold text-white">{t.count}</span>
              <span className="flex-1">
                <span className="block text-slate-800">{t.label}</span>
                <span className="text-xs text-slate-400">{t.app}</span>
              </span>
              <span className="text-sky-700">→</span>
            </Link>
          </li>
        ))}
      </ul>
    );

  return (
    <>
      <div ref={ref} className="relative">
        <button type="button" onClick={() => setOpen((o) => !o)} className="relative rounded-md border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-50" title="Việc của tôi">
          🔔 Việc của tôi
          {total > 0 && <span className="ml-1.5 rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white">{total}</span>}
        </button>
        {open && <div className="absolute right-0 top-full z-50 mt-1 w-96 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">{list(() => setOpen(false))}</div>}
      </div>
      {popup && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/30 p-6 pt-24" onClick={() => setPopup(false)}>
          <div className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-slate-100 bg-amber-50 px-4 py-3">
              <h2 className="font-semibold text-slate-900">🔔 Bạn có {total} việc cần xử lý</h2>
              <p className="text-xs text-slate-500">Bấm vào từng việc để đi tới nơi xử lý. Xem lại bất cứ lúc nào ở nút &quot;Việc của tôi&quot; trên thanh menu.</p>
            </div>
            {list(() => setPopup(false))}
            <div className="border-t border-slate-100 px-4 py-2 text-right">
              <button type="button" onClick={() => setPopup(false)} className="rounded-md border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-50">
                Để sau
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
