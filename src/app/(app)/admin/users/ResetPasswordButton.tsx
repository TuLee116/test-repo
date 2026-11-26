"use client";

import { useState, useTransition } from "react";
import { resetUserPasswordAction } from "@/lib/actions";

// Quản trị viên đặt mật khẩu mới cho 1 tài khoản (kể cả tài khoản của chính mình)
export default function ResetPasswordButton({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-blue-700 hover:underline">
        Đổi mật khẩu
      </button>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <input
        type="password"
        autoComplete="new-password"
        value={pw}
        onChange={(e) => {
          setPw(e.target.value);
          setMsg("");
        }}
        placeholder={`Mật khẩu mới cho ${name} (≥ 8 ký tự)`}
        className="w-64 rounded border border-slate-300 px-2 py-1"
      />
      <button
        type="button"
        disabled={pending || pw.length < 8}
        onClick={() =>
          start(async () => {
            try {
              await resetUserPasswordAction(userId, pw);
              setMsg("✓ Đã đổi");
              setPw("");
              setTimeout(() => setOpen(false), 1200);
            } catch (e) {
              setMsg(e instanceof Error ? e.message : "Lỗi");
            }
          })
        }
        className="rounded bg-slate-900 px-2 py-1 font-medium text-white disabled:opacity-40"
      >
        Lưu
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-slate-500 hover:underline">
        Huỷ
      </button>
      {msg && <span className={msg.startsWith("✓") ? "text-emerald-600" : "text-red-600"}>{msg}</span>}
    </span>
  );
}
