"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

// CỬA SỔ LÀM VIỆC TOÀN MÀN HÌNH cho 1 tác vụ (VD QSTT trình giá đội, Trưởng phòng duyệt):
// phủ kín màn hình (che thanh đầu trang + menu trái), chỉ còn nội dung tác vụ.
// Hoàn thành tác vụ (trình / duyệt / soạn mail xong) → ws.done("...") → về màn hình chính + thông báo nhỏ.
// "✕ Về màn hình chính" khi còn thay đổi chưa lưu → hỏi Lưu nháp rồi thoát / Thoát không lưu / Ở lại.

type Guard = { dirty: boolean; save: () => Promise<boolean> };
type Ctx = { setGuard: (g: Guard | null) => void; done: (msg: string) => void };
const TaskCtx = createContext<Ctx | null>(null);
/** null = trang đang hiển thị bình thường (không ở cửa sổ làm việc) */
export const useTaskWorkspace = () => useContext(TaskCtx);

const DONE_KEY = "task-done-msg";

export default function TaskWorkspace({
  title,
  code,
  sub,
  exitHref,
  history,
  layer = "z-[60]",
  children,
}: {
  title: string; // VD "QSTT · Kiểm tra & trình giá đội"
  code: string; // mã hồ sơ, ghi vào thông báo hoàn thành
  sub?: string;
  exitHref: string; // màn hình chính để quay về
  history?: React.ReactNode; // lịch sử xử lý: mở ngăn bên phải
  layer?: string; // lớp z: DT-CP dùng thấp hơn để các khung nổi (gắn vào body, z-50) hiện được phía trên
  children: React.ReactNode;
}) {
  const router = useRouter();
  const guard = useRef<Guard | null>(null);
  const [ask, setAsk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showHist, setShowHist] = useState(false);

  // khoá cuộn trang nền phía sau
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const ctx = useMemo<Ctx>(
    () => ({
      setGuard: (g) => {
        guard.current = g;
      },
      done: (msg) => {
        try {
          sessionStorage.setItem(DONE_KEY, `${msg} — ${code}`);
        } catch {}
        router.push(exitHref);
      },
    }),
    [router, exitHref, code],
  );

  const leave = () => router.push(exitHref);
  const exit = () => (guard.current?.dirty ? setAsk(true) : leave());

  return (
    <TaskCtx.Provider value={ctx}>
      <div className={`task-ws fixed inset-0 ${layer} flex flex-col bg-slate-100`}>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-300 bg-white px-3 py-1.5 shadow-sm">
          <span className="rounded bg-sky-700 px-2 py-0.5 text-xs font-semibold text-white">Đang làm</span>
          <b className="text-sm text-slate-900">{title}</b>
          <span className="text-sm font-medium text-slate-600">{code}</span>
          {sub && <span className="truncate text-xs text-slate-500">· {sub}</span>}
          <span className="flex-1" />
          {history && (
            <button type="button" onClick={() => setShowHist((v) => !v)} className={`rounded-md border px-3 py-1 text-sm ${showHist ? "border-sky-400 bg-sky-50 text-sky-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
              🕘 Lịch sử xử lý
            </button>
          )}
          <button type="button" onClick={exit} className="rounded-md border border-slate-400 bg-white px-3 py-1 text-sm font-medium text-slate-800 hover:bg-slate-100">
            ✕ Về màn hình chính
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-auto px-3 py-3">{children}</div>
          {history && showHist && <aside className="w-96 shrink-0 overflow-y-auto border-l border-slate-300 bg-white p-3">{history}</aside>}
        </div>
      </div>

      {ask && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <p className="font-medium text-slate-900">Có thay đổi chưa lưu</p>
            <p className="mt-1 text-sm text-slate-600">Anh/chị muốn lưu nháp trước khi về màn hình chính?</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setAsk(false)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
                Ở lại
              </button>
              <button type="button" disabled={saving} onClick={leave} className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">
                Thoát không lưu
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  const ok = (await guard.current?.save()) ?? true;
                  setSaving(false);
                  if (ok) leave();
                  else setAsk(false);
                }}
                className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {saving ? "Đang lưu..." : "Lưu nháp rồi thoát"}
              </button>
            </div>
          </div>
        </div>
      )}
    </TaskCtx.Provider>
  );
}

// Thông báo nhỏ ở màn hình chính sau khi hoàn thành tác vụ (đặt ở layout chung)
export function TaskDoneToast() {
  const path = usePathname();
  const [msg, setMsg] = useState("");
  useEffect(() => {
    let m = "";
    try {
      m = sessionStorage.getItem(DONE_KEY) ?? "";
      if (m) sessionStorage.removeItem(DONE_KEY);
    } catch {}
    if (!m) return;
    const show = setTimeout(() => setMsg(m), 0);
    const hide = setTimeout(() => setMsg(""), 6000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [path]);
  if (!msg) return null;
  return (
    <div className="fixed bottom-5 right-5 z-[90] flex items-center gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-lg">
      <span>✓ {msg}</span>
      <button type="button" onClick={() => setMsg("")} className="text-emerald-700 hover:text-emerald-900">
        ✕
      </button>
    </div>
  );
}
