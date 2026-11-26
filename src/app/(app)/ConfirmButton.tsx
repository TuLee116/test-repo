"use client";

import { confirmNear } from "@/app/(app)/confirm-near";

// Nút xoá dùng trong <form action={...}> của server component: hỏi xác nhận (hộp hiện ngay cạnh nút) rồi mới gửi.
export default function ConfirmButton({
  message,
  className,
  children,
}: {
  message: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      className={className}
      onClick={(e) => {
        e.preventDefault();
        const btn = e.currentTarget;
        void confirmNear(message).then((ok) => ok && btn.form?.requestSubmit(btn));
      }}
    >
      {children}
    </button>
  );
}
