"use client";

import { useRouter } from "next/navigation";

// Bật / tắt cột "Hình ảnh" trên bảng BOQ - nhớ theo từng sheet ở trình duyệt của người dùng (cookie,
// để máy chủ vẽ bảng đúng số cột ngay từ đầu)
export default function BoqImageToggle({ cookieName, on, count }: { cookieName: string; on: boolean; count: number }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        document.cookie = `${cookieName}=${on ? "0" : "1"}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }}
      className={`rounded-md border px-3 py-1.5 text-sm ${on ? "border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}
      title={on ? "Ẩn cột Hình ảnh" : "Hiện cột Hình ảnh để xem / thêm ảnh cho từng dòng"}
    >
      🖼 {on ? "Ẩn cột ảnh" : "Hiện cột ảnh"}
      {count > 0 ? ` (${count})` : ""}
    </button>
  );
}
