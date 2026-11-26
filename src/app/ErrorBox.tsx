"use client";

import { useEffect, useState } from "react";
import { friendlyError, isMasked, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, type Friendly } from "@/lib/friendly-error";

// Hỏi máy chủ lý do thật của lỗi (bản production ẩn nội dung lỗi gửi về trình duyệt)
export async function resolveError(raw: unknown): Promise<{ f: Friendly; code: string }> {
  const msg = (raw as { message?: string })?.message ?? String(raw ?? "");
  let code = (raw as { digest?: string })?.digest ?? "";
  let real: unknown = raw;
  if (isMasked(msg)) {
    try {
      const r = await fetch("/api/last-error", { cache: "no-store" });
      const j = (await r.json()) as { message?: string; digest?: string };
      if (j.message) {
        real = j.message;
        code = code || j.digest || "";
      }
    } catch {
      /* máy chủ không trả lời → giữ lỗi gốc */
    }
  }
  return { f: friendlyError(real), code };
}

// Khung báo lỗi dễ hiểu (dùng cho trang lỗi và hộp báo lỗi nổi)
export function ErrorPanel({ f, code, onRetry, onClose }: { f: Friendly; code?: string; onRetry?: () => void; onClose?: () => void }) {
  const [showDetail, setShowDetail] = useState(false);
  return (
    <div className="rounded-lg border border-red-300 bg-white p-4 shadow-lg">
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none">⚠️</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-red-800">{f.title}</p>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{f.hint}</p>
          {code && <p className="mt-1 text-xs text-slate-400">Mã lỗi: {code}</p>}
          {f.detail && (
            <button type="button" className="mt-1 text-xs text-slate-400 hover:underline" onClick={() => setShowDetail((x) => !x)}>
              {showDetail ? "Ẩn chi tiết" : "Chi tiết kỹ thuật"}
            </button>
          )}
          {showDetail && <p className="mt-1 break-words rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-500">{f.detail}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {onRetry && (
              <button type="button" onClick={onRetry} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800">
                Thử lại
              </button>
            )}
            <button type="button" onClick={() => window.location.reload()} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
              Tải lại trang
            </button>
            <button type="button" onClick={() => window.location.assign("/")} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
              Về trang chủ
            </button>
            {onClose && (
              <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">
                Đóng
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Trang lỗi (error.tsx): hiện lý do lỗi khi trang không mở được
export function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry?: () => void }) {
  const [res, setRes] = useState<{ f: Friendly; code: string } | null>(null);
  useEffect(() => {
    let alive = true;
    resolveError(error).then((r) => alive && setRes(r));
    return () => {
      alive = false;
    };
  }, [error]);
  return (
    <div className="mx-auto mt-10 w-full max-w-xl px-4">
      {res ? <ErrorPanel f={res.f} code={res.code} onRetry={retry} /> : <p className="text-sm text-slate-500">Đang kiểm tra lỗi...</p>}
    </div>
  );
}

// Hộp báo lỗi nổi góc dưới màn hình: bắt mọi lỗi chưa được xử lý (VD bấm nút lưu mà máy chủ báo lỗi)
export function ErrorReporter() {
  const [items, setItems] = useState<{ id: number; f: Friendly; code: string }[]>([]);
  useEffect(() => {
    let n = 0;
    const show = async (raw: unknown) => {
      const r = await resolveError(raw);
      const id = ++n;
      setItems((x) => [...x.filter((y) => y.f.title + y.f.hint !== r.f.title + r.f.hint), { id, ...r }].slice(-3));
    };
    const onRej = (e: PromiseRejectionEvent) => {
      // bỏ qua chuyển trang của Next (redirect / notFound được ném như lỗi)
      const d = (e.reason as { digest?: string })?.digest ?? "";
      if (/^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR)/.test(d)) return;
      void show(e.reason);
    };
    const onErr = (e: ErrorEvent) => {
      if (!e.error && /ResizeObserver/.test(e.message)) return;
      void show(e.error ?? e.message);
    };
    // chọn file quá nặng → báo ngay, không gửi lên máy chủ (chặn trước khi ô chọn file của trang xử lý)
    const onPick = (e: Event) => {
      const el = e.target as HTMLInputElement | null;
      if (!el || el.tagName !== "INPUT" || el.type !== "file" || !el.files) return;
      if (el.closest("[data-allow-large]")) return; // công cụ nhận file nặng (VD Làm nhẹ file Excel)
      const big = [...el.files].find((f) => f.size > MAX_UPLOAD_BYTES);
      if (!big) return;
      e.stopImmediatePropagation();
      el.value = "";
      const mb = (big.size / 1024 / 1024).toFixed(0);
      setItems((x) => [
        ...x,
        {
          id: ++n,
          code: "",
          f: {
            title: `File quá nặng: ${mb} MB`,
            hint: `"${big.name}" vượt mức tối đa ${MAX_UPLOAD_MB} MB máy chủ nhận được. Mở file bằng Excel, xoá ảnh / sheet không cần (hoặc copy các sheet cần sang file mới) rồi "Lưu thành" file mới — file Excel bình thường chỉ vài MB.`,
            detail: "",
          },
        },
      ]);
    };
    window.addEventListener("unhandledrejection", onRej);
    window.addEventListener("error", onErr);
    window.addEventListener("change", onPick, true);
    window.addEventListener("drop", onDrop, true);
    return () => {
      window.removeEventListener("unhandledrejection", onRej);
      window.removeEventListener("error", onErr);
      window.removeEventListener("change", onPick, true);
      window.removeEventListener("drop", onDrop, true);
    };
    // kéo thả file quá nặng vào ô tải lên
    function onDrop(e: DragEvent) {
      if ((e.target as Element | null)?.closest?.("[data-allow-large]")) return;
      const big = [...(e.dataTransfer?.files ?? [])].find((f) => f.size > MAX_UPLOAD_BYTES);
      if (!big) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setItems((x) => [...x, { id: ++n, code: "", f: { title: `File quá nặng: ${(big.size / 1024 / 1024).toFixed(0)} MB`, hint: `"${big.name}" vượt mức tối đa ${MAX_UPLOAD_MB} MB. Xoá ảnh / sheet không cần rồi "Lưu thành" file mới.`, detail: "" } }]);
    }
  }, []);
  if (!items.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] w-[min(28rem,calc(100vw-2rem))] space-y-2">
      {items.map((it) => (
        <ErrorPanel key={it.id} f={it.f} code={it.code} onClose={() => setItems((x) => x.filter((y) => y.id !== it.id))} />
      ))}
    </div>
  );
}
