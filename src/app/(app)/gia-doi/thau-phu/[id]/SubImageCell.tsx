"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { deleteSubImageAction } from "@/lib/thau-phu-actions";
import { confirmNear } from "@/app/(app)/confirm-near";

const src = (id: string, thumb = false) => `/api/sub-images/${id}${thumb ? "?thumb=1" : ""}`;

// Ô "HÌNH ẢNH" của 1 dòng trình giá thầu phụ NỘI THẤT (giống ô ảnh BOQ): ảnh thu nhỏ, bấm xem lớn; QSĐT / QSTT thêm ảnh bằng nút +
// hoặc bấm vào ô rồi dán Ctrl+V. Ảnh lưu ngay (không chờ Lưu nháp); dòng mới thêm phải Lưu nháp trước.
export default function SubImageCell({ lineId, images, editable }: { lineId: string; images: string[]; editable: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const unsaved = lineId.startsWith("new:");

  async function upload(files: File[]) {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    if (unsaved) return window.alert("Dòng mới thêm: bấm Lưu nháp trước rồi mới thêm ảnh.");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("lineId", lineId);
      for (const f of imgs) fd.append("file", f, f.name || "anh-dan.png");
      const res = await fetch("/api/sub-images", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (data.error) window.alert(data.error);
      router.refresh();
    } catch {
      window.alert("Không tải được ảnh lên (mất kết nối?)");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      tabIndex={editable ? 0 : undefined}
      title={editable ? "Bấm vào ô rồi Ctrl+V để dán ảnh, hoặc bấm + để chọn file" : undefined}
      onPaste={(e) => {
        if (!editable) return;
        const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
        if (!files.length) return;
        e.preventDefault();
        upload(files);
      }}
      className="group flex min-h-[28px] flex-wrap items-center justify-center gap-1 rounded py-0.5 outline-none focus:bg-sky-50 focus:ring-1 focus:ring-sky-400"
    >
      {images.map((id, i) => (
        <button key={id} type="button" onClick={() => setOpen(i)} className="block" title="Xem ảnh lớn">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src(id, true)} alt="" loading="lazy" className="h-14 max-w-[88px] rounded border border-slate-200 object-contain" />
        </button>
      ))}
      {editable && (
        <button
          type="button"
          disabled={busy}
          onClick={() => (unsaved ? window.alert("Dòng mới thêm: bấm Lưu nháp trước rồi mới thêm ảnh.") : fileRef.current?.click())}
          className={`h-6 w-6 rounded border border-dashed border-slate-300 text-xs text-slate-400 hover:border-sky-500 hover:text-sky-600 ${images.length ? "invisible group-hover:visible group-focus:visible" : ""}`}
          title="Thêm ảnh (chọn được nhiều ảnh)"
        >
          {busy ? "…" : "+"}
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          upload(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      {open != null && images[open] && <Lightbox images={images} index={open} editable={editable} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Lightbox({ images, index, editable, onIndex, onClose }: { images: string[]; index: number; editable: boolean; onIndex: (i: number) => void; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const n = images.length;
  const id = images[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && n > 1) onIndex((index + 1) % n);
      if (e.key === "ArrowLeft" && n > 1) onIndex((index - 1 + n) % n);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, n, onClose, onIndex]);

  async function remove() {
    if (!(await confirmNear("Xoá ảnh này khỏi dòng?"))) return;
    setBusy(true);
    const r = await deleteSubImageAction(id);
    setBusy(false);
    if (!r.ok) window.alert(r.error || "Không xoá được ảnh");
    onClose();
    router.refresh();
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="relative flex max-h-full max-w-full flex-col items-center" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src(id)} alt="" className="max-h-[80vh] max-w-[92vw] rounded bg-white object-contain" />
        <div className="mt-3 flex items-center gap-2 text-sm">
          {n > 1 && (
            <button type="button" onClick={() => onIndex((index - 1 + n) % n)} className="rounded bg-white/90 px-3 py-1 hover:bg-white">
              ‹ Trước
            </button>
          )}
          <span className="text-white/80">
            {index + 1} / {n}
          </span>
          {n > 1 && (
            <button type="button" onClick={() => onIndex((index + 1) % n)} className="rounded bg-white/90 px-3 py-1 hover:bg-white">
              Sau ›
            </button>
          )}
          <a href={src(id)} target="_blank" rel="noreferrer" className="rounded bg-white/90 px-3 py-1 hover:bg-white">
            Mở ảnh gốc
          </a>
          {editable && (
            <button type="button" disabled={busy} onClick={remove} className="rounded bg-red-600 px-3 py-1 text-white hover:bg-red-700 disabled:opacity-50">
              Xoá ảnh
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded bg-white/90 px-3 py-1 hover:bg-white">
            Đóng (Esc)
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
