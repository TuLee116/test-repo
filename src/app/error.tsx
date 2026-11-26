"use client";

import { ErrorPage } from "./ErrorBox";

// Trang không mở được → hiện lý do bằng tiếng Việt thay cho đoạn code
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorPage error={error} retry={retry} />;
}
