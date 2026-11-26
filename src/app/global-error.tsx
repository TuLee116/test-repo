"use client";

import "./globals.css";
import { ErrorPage } from "./ErrorBox";

// Lỗi ở khung ngoài cùng (layout gốc) → thay cả trang
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="vi">
      <body className="bg-slate-50 text-slate-900">
        <ErrorPage error={error} retry={retry} />
      </body>
    </html>
  );
}
