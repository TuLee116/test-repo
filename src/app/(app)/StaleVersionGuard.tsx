"use client";

import { useEffect, useState } from "react";

// Sau mỗi lần cập nhật phần mềm lên web, trang đang mở sẵn vẫn là bản cũ → bấm Lưu/thao tác sẽ gọi hàm
// máy chủ không còn tồn tại ("Failed to find Server Action" / "was not found on the server"). Bắt lỗi đó ở
// mọi trang và mời người dùng tải lại, thay vì để hiện mã lỗi khó hiểu.
const STALE = /Server Action .*(not found|was not found)|Failed to find Server Action|older or newer deployment/i;

export default function StaleVersionGuard() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const check = (msg: unknown) => {
      const text = msg instanceof Error ? msg.message : String(msg ?? "");
      if (STALE.test(text)) setStale(true);
    };
    const onError = (e: ErrorEvent) => check(e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => check(e.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  if (!stale) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow">
      Phần mềm vừa được cập nhật phiên bản mới — thao tác vừa rồi chưa được lưu.
      <button type="button" onClick={() => window.location.reload()} className="rounded bg-white px-3 py-1 text-amber-700 hover:bg-amber-50">
        Tải lại trang
      </button>
    </div>
  );
}
