"use client";

import { useState, useTransition } from "react";
import { changeOwnPasswordAction } from "@/lib/account-actions";

// Nút "Đổi mật khẩu" trên thanh trên cùng: người dùng tự đổi mật khẩu của mình
export default function ChangePasswordButton() {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [err, setErr] = useState("");

  const close = () => {
    setOpen(false);
    setCur("");
    setNext("");
    setAgain("");
    setErr("");
  };
  const save = () => {
    if (next.length < 8) return setErr("Mật khẩu mới phải từ 8 ký tự");
    if (next !== again) return setErr("Nhập lại mật khẩu mới không khớp");
    start(async () => {
      const r = await changeOwnPasswordAction(cur, next);
      if (!r.ok) return setErr(r.error ?? "Không đổi được mật khẩu");
      close();
      window.alert("Đã đổi mật khẩu. Lần đăng nhập sau dùng mật khẩu mới.");
    });
  };

  const inp = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
        🔑 Đổi mật khẩu
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-6 pt-24" onClick={() => !pending && close()}>
          <form
            className="w-full max-w-sm space-y-3 rounded-lg bg-white p-5 text-left shadow-xl"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <h3 className="font-semibold text-slate-900">Đổi mật khẩu</h3>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Mật khẩu hiện tại</span>
              <input type="password" autoComplete="current-password" autoFocus className={inp} value={cur} onChange={(e) => setCur(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Mật khẩu mới (≥ 8 ký tự)</span>
              <input type="password" autoComplete="new-password" className={inp} value={next} onChange={(e) => setNext(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">Nhập lại mật khẩu mới</span>
              <input type="password" autoComplete="new-password" className={inp} value={again} onChange={(e) => setAgain(e.target.value)} />
            </label>
            {err && <p className="rounded bg-red-50 px-2 py-1 text-sm text-red-700">{err}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={pending || !cur || !next} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
                {pending ? "Đang lưu..." : "Đổi mật khẩu"}
              </button>
              <button type="button" disabled={pending} onClick={close} className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50">
                Huỷ
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
