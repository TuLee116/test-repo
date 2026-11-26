"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { deleteBoqImageAction } from "@/lib/actions";
import { confirmNear } from "@/app/(app)/confirm-near";

export type BoqImageRef = { id: string };

const src = (id: string, thumb = false) => `/api/boq-images/${id}${thumb ? "?thumb=1" : ""}`;

// Ô "Hình ảnh" của 1 dòng BOQ: ảnh thu nhỏ (bấm để xem lớn), thêm ảnh bằng nút + (chọn nhiều file) hoặc
// bấm vào ô rồi dán Ctrl+V. Ảnh tự nén về tối đa 1MB ở máy chủ.
export default function BoqImageCell({ projectId, boqItemId, images }: { projectId: string; boqItemId: string; images: BoqImageRef[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  async function upload(files: File[]) {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("projectId", projectId);
      fd.append("boqItemId", boqItemId);
      for (const f of imgs) fd.append("file", f, f.name || "anh-dan.png");
      const res = await fetch("/api/boq-images", { method: "POST", body: fd });
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
      tabIndex={0}
      title="Bấm vào ô rồi Ctrl+V để dán ảnh, hoặc bấm + để chọn file"
      onPaste={(e) => {
        const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
        if (!files.length) return;
        e.preventDefault();
        upload(files);
      }}
      className="group flex min-h-[28px] flex-wrap items-center justify-center gap-1 rounded py-0.5 outline-none focus:bg-sky-50 focus:ring-1 focus:ring-sky-400"
    >
      {images.map((im, i) => (
        <button key={im.id} type="button" onClick={() => setOpen(i)} className="block" title="Xem ảnh lớn">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src(im.id, true)} alt="" loading="lazy" className="h-12 max-w-[96px] rounded border border-slate-200 object-contain" />
        </button>
      ))}
      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        className={`h-6 w-6 rounded border border-dashed border-slate-300 text-xs text-slate-400 hover:border-sky-500 hover:text-sky-600 ${images.length ? "invisible group-hover:visible group-focus:visible" : ""}`}
        title="Thêm ảnh (chọn được nhiều ảnh)"
      >
        {busy ? "…" : "+"}
      </button>
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
      {open != null && images[open] && <Lightbox projectId={projectId} images={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Lightbox({ projectId, images, index, onIndex, onClose }: { projectId: string; images: BoqImageRef[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const n = images.length;
  const im = images[index];

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
    if (!(await confirmNear("Xoá ảnh này khỏi dòng BOQ?"))) return;
    setBusy(true);
    const r = await deleteBoqImageAction(projectId, im.id);
    setBusy(false);
    if (!r.ok) window.alert(r.error || "Không xoá được ảnh");
    onClose();
    router.refresh();
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="relative flex max-h-full max-w-full flex-col items-center" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src(im.id)} alt="" className="max-h-[80vh] max-w-[92vw] rounded bg-white object-contain" />
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
          <a href={src(im.id)} target="_blank" rel="noreferrer" className="rounded bg-white/90 px-3 py-1 hover:bg-white">
            Mở ảnh gốc
          </a>
          <button type="button" disabled={busy} onClick={remove} className="rounded bg-red-600 px-3 py-1 text-white hover:bg-red-700 disabled:opacity-50">
            Xoá ảnh
          </button>
          <button type="button" onClick={onClose} className="rounded bg-white/90 px-3 py-1 hover:bg-white">
            Đóng (Esc)
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
