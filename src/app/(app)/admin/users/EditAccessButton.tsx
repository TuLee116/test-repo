"use client";

import { useState } from "react";
import UserAccessForm, { type AccessValue } from "./UserAccessForm";

// Nút "Sửa quyền" mở checklist quyền của 1 tài khoản
export default function EditAccessButton({ userId, initial }: { userId: string; initial: AccessValue }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-blue-700 hover:underline">
        Sửa quyền
      </button>
    );
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-6" onClick={() => setOpen(false)}>
      <div className="w-full max-w-6xl rounded-lg bg-white p-5 text-left shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 font-medium text-slate-900">Checklist quyền — {initial.name}</h3>
        <UserAccessForm userId={userId} initial={initial} onDone={() => setOpen(false)} />
      </div>
    </div>
  );
}
