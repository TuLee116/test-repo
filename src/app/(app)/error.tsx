"use client";

import { ErrorPage } from "../ErrorBox";

// Lỗi trong 1 trang của phần mềm: giữ thanh menu, khung nội dung hiện lý do lỗi
export default function SectionError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorPage error={error} retry={retry} />;
}
