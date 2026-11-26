"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { ActionResult } from "@/lib/proc-actions";
import { confirmNear } from "@/app/(app)/confirm-near";

// Nút gọi 1 server action của phân hệ Mua vật tư (đã bind sẵn id ở server component).
// confirm: hỏi trước khi làm; prompt: hỏi thêm 1 dòng chữ (VD lý do trả lại) rồi truyền vào action;
// goto: chuyển trang sau khi xong (có "{id}" thì thay bằng id action trả về).
export default function ActionButton({
  action,
  children,
  confirm,
  prompt,
  promptRequired,
  goto,
  variant = "default",
}: {
  action: (text?: string) => Promise<ActionResult>;
  children: React.ReactNode;
  confirm?: string;
  prompt?: string;
  promptRequired?: boolean;
  goto?: string;
  variant?: "primary" | "danger" | "default" | "link";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const cls = {
    primary: "rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800",
    danger: "rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50",
    default: "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50",
    link: "text-xs text-red-600 hover:underline",
  }[variant];
  return (
    <button
      type="button"
      disabled={pending}
      className={`${cls} disabled:opacity-50 print:hidden`}
      onClick={async () => {
        let text: string | undefined;
        if (prompt) {
          const t = window.prompt(prompt);
          if (t === null) return;
          if (promptRequired && !t.trim()) return window.alert("Cần nhập nội dung");
          text = t;
        } else if (confirm && !(await confirmNear(confirm))) return;
        start(async () => {
          const r = await action(text);
          if (!r.ok) return window.alert(r.error);
          if (goto) router.push(goto.replace("{id}", r.id ?? ""));
          else router.refresh();
        });
      }}
    >
      {pending ? "Đang xử lý..." : children}
    </button>
  );
}
