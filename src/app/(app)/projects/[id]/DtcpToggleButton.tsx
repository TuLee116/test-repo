"use client";

import { useTransition } from "react";
import { setVtGroupShowInDtcpAction } from "@/lib/actions";

// Nút bật/tắt dùng chung: đầu mục / nhà thầu phụ này có hiện thành 1 dòng riêng bên sheet DT-CP hay
// không (tắt = gộp chung giá trị vào dòng "chưa phân nhóm"/"chưa gán"). `onToggle` tự chọn action phù
// hợp (VtGroup, tên thầu phụ, đầu mục sheet tự do...).
export function ToggleButton({ on, onToggle, title }: { on: boolean; onToggle: (next: boolean) => void; title?: string }) {
  const [, start] = useTransition();
  return (
    <button
      type="button"
      onClick={() => start(() => onToggle(!on))}
      title={title ?? 'Bật: hiện thành 1 dòng riêng ở sheet DT-CP. Tắt: gộp chung giá trị vào dòng "chưa phân nhóm".'}
      className={`shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium normal-case ${
        on ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "bg-slate-200 text-slate-500 hover:bg-slate-300"
      }`}
    >
      Thể hiện qua DT-CP
    </button>
  );
}

// Biến thể gắn sẵn với đầu mục lớn (VtGroup) - dùng cho TH Vật Tư / Nhân Công / Thiết Bị / Thầu Phụ.
export default function DtcpToggleButton({ projectId, groupId, on }: { projectId: string; groupId: string; on: boolean }) {
  return <ToggleButton on={on} onToggle={(next) => void setVtGroupShowInDtcpAction(projectId, groupId, next)} />;
}
