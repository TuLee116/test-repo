"use client";

import { Suspense, useActionState, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { loginAction, type LoginState } from "./actions";

function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, undefined);
  // "Quay lại" từ bước nhập mã → hiện lại ô mật khẩu (giữ tên đăng nhập)
  const [backFrom, setBackFrom] = useState<LoginState>(undefined);
  const otp = state !== backFrom ? state?.otp : undefined;
  const error = state !== backFrom ? state?.error : undefined;
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  // vào trang đăng nhập = phiên mới → đăng nhập xong được nhắc lại "Việc của tôi" (xem TaskBell)
  useEffect(() => {
    try {
      sessionStorage.removeItem("dtcp-task-reminded");
    } catch {}
  }, []);

  return (
    <form
      action={formAction}
      className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/tmn-logo.png" alt="Tân Minh Nhân" className="mx-auto h-16 w-auto" />
      <h1 className="mt-3 text-center text-lg font-semibold text-slate-900">Khối Kinh Tế Kế Hoạch</h1>
      <p className="mt-1 text-center text-sm text-slate-500">Công ty CP XD Kiến trúc Tân Minh Nhân — Đăng nhập để tiếp tục</p>

      <input type="hidden" name="callbackUrl" value={callbackUrl} />

      {otp ? (
        <div className="mt-6 space-y-4">
          <input type="hidden" name="otpId" value={otp.otpId} />
          <p className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900">
            Đã gửi mã 6 số tới email <b>{otp.email}</b>. Mở hộp thư (kể cả mục Thư rác / Junk) và nhập mã. Mã có hiệu lực 5 phút.
          </p>
          <div>
            <label className="block text-sm font-medium text-slate-700">Mã đăng nhập</label>
            <input
              key={otp.otpId}
              name="code"
              required
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="______"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-center font-mono text-xl tracking-[0.5em] focus:border-slate-500 focus:outline-none"
            />
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">Tên đăng nhập</label>
            <input
              name="username"
              required
              autoFocus
              defaultValue={state?.otp?.username}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Mật khẩu</label>
            <input
              name="password"
              type="password"
              required
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-6 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
      >
        {pending ? (otp ? "Đang kiểm tra mã..." : "Đang đăng nhập...") : otp ? "Xác nhận mã" : "Đăng nhập"}
      </button>
      {otp && (
        <button type="button" onClick={() => setBackFrom(state)} className="mt-3 w-full text-sm text-slate-500 hover:underline">
          ← Quay lại (nhận mã mới)
        </button>
      )}
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
