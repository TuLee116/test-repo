"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cloneProjectAction, deleteProjectAction } from "@/lib/actions";

export default function ProjectRowActions({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [confirming, setConfirming] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (cloning) {
    // Nhân bản: tạo DT-CP mới độc lập giống hệt dự án này (VD tháp 2), sau đó chỉ cần sửa khối lượng / phần khác nhau
    const submit = () =>
      startTransition(async () => {
        setError("");
        const r = await cloneProjectAction(projectId, cloneName);
        if (!r.ok || !r.id) return setError(r.error ?? "Nhân bản không thành công");
        router.push(`/projects/${r.id}/info`);
      });
    return (
      <div className="flex flex-col items-end gap-1 text-xs">
        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
          <input
            autoFocus
            value={cloneName}
            disabled={pending}
            onChange={(e) => setCloneName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setCloning(false);
            }}
            placeholder="Tên DT-CP mới"
            className="w-56 rounded border border-slate-300 px-2 py-1"
          />
          <button type="button" disabled={pending || !cloneName.trim()} onClick={submit} className="rounded bg-blue-600 px-2 py-1 font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {pending ? "Đang nhân bản..." : "Nhân bản"}
          </button>
          <button type="button" disabled={pending} onClick={() => setCloning(false)} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">
            Huỷ
          </button>
        </div>
        <div className={error ? "text-red-600" : "text-slate-500"}>{error || "Tạo DT-CP mới độc lập, giống hệt bản này (không chép dữ liệu Mua vật tư)"}</div>
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="flex items-center justify-end gap-2 whitespace-nowrap text-xs">
        <span className="text-red-600">Chắc chắn xoá dự án này?</span>
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => deleteProjectAction(projectId))}
          className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {pending ? "Đang xoá..." : "Xoá"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(false)}
          className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
        >
          Huỷ
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-3 text-xs">
      <Link href={`/projects/${projectId}/info`} className="text-slate-500 hover:underline">
        Điều chỉnh
      </Link>
      <button
        type="button"
        title="Tạo DT-CP mới độc lập giống hệt bản này (VD tháp 2), rồi chỉ cần sửa khối lượng"
        onClick={() => {
          setCloneName(`${projectName} (bản sao)`);
          setCloning(true);
        }}
        className="text-blue-600 hover:underline"
      >
        Nhân bản
      </button>
      <button type="button" onClick={() => setConfirming(true)} className="text-red-500 hover:underline">
        Xoá
      </button>
    </div>
  );
}
