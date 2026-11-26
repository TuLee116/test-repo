"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadPriceFileAction } from "@/lib/gia-doi-actions";

type UploadResult = { ok: true; id?: string; info?: string } | { ok: false; error: string };

// QSTT tải file Excel đề xuất đơn giá tổ đội do BCH gửi về → hệ thống đọc file, tạo hồ sơ để kiểm tra
export default function UploadForm({
  action = uploadPriceFileAction,
  basePath = "/gia-doi",
  title = "Tải file Excel đề xuất đơn giá tổ đội (BCH gửi về)",
  hint,
}: {
  action?: (fd: FormData) => Promise<UploadResult>;
  basePath?: string;
  title?: string;
  hint?: string;
} = {}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const upload = (file: File) =>
    start(async () => {
      const fd = new FormData();
      fd.set("file", file);
      const r = await action(fd);
      if (ref.current) ref.current.value = "";
      setName("");
      if (!r.ok) return window.alert(r.error);
      if (r.info) window.alert(r.info);
      router.push(`${basePath}/${r.id}`);
    });
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-dashed border-sky-300 bg-sky-50/50 p-4"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) upload(f);
      }}
    >
      <div className="flex-1">
        <p className="font-medium text-slate-900">{title}</p>
        <p className="text-xs text-slate-500">
          {hint ?? "Đúng mẫu ĐTKSTT-ĐXĐGĐ (sheet \"Đơn giá đội trình duyệt\" hoặc \"Đề xuất đơn giá ngoài HĐ, PL\"). Kéo thả file vào đây hoặc bấm chọn file. Hệ thống đọc file và tạo hồ sơ để QSTT kiểm tra."}
        </p>
      </div>
      <input
        ref={ref}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setName(f.name);
            upload(f);
          }
        }}
      />
      <button type="button" disabled={pending} onClick={() => ref.current?.click()} className="rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50">
        {pending ? `Đang đọc ${name}...` : "📎 Chọn file Excel"}
      </button>
    </div>
  );
}
