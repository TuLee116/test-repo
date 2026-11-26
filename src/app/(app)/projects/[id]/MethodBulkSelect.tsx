"use client";

import { useTransition } from "react";
import { setBoqMethodBulkAction } from "@/lib/actions";
import { confirmNear } from "@/app/(app)/confirm-near";

// Ở dòng đầu mục lớn: chuyển hàng loạt các công tác bên dưới sang Thầu phụ / Chiết tính.
// Không cố định: từng công tác vẫn đổi riêng được bằng ô chọn của chính nó.
export default function MethodBulkSelect({
  projectId,
  headingText,
  ids,
  subCount,
}: {
  projectId: string;
  headingText: string;
  ids: string[];
  subCount: number;
}) {
  const [pending, start] = useTransition();
  if (ids.length === 0) return <span className="text-[10px] font-normal text-slate-400">(trống)</span>;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <select
        value=""
        disabled={pending}
        title="Chuyển hàng loạt cả đầu mục (từng công tác vẫn đổi riêng được)"
        onChange={async (e) => {
          const method = e.target.value as "DETAIL" | "SUB" | "";
          if (!method) return;
          const label = method === "SUB" ? "THẦU PHỤ" : "CHIẾT TÍNH";
          if (!await confirmNear(`Chuyển ${ids.length} công tác thuộc "${headingText}" sang ${label}?\n\nSau đó vẫn đổi riêng từng công tác được.${method === "DETAIL" ? "\n\nLưu ý: dòng thầu phụ (đơn giá, nhà thầu) đã nhập của các công tác này sẽ bị xoá." : ""}`)) return;
          start(() => void setBoqMethodBulkAction(projectId, ids, method));
        }}
        className="rounded border border-slate-400 bg-white px-1 py-0.5 text-[11px] font-normal"
      >
        <option value="">Đặt cả mục ▾</option>
        <option value="SUB">→ Thầu phụ</option>
        <option value="DETAIL">→ Chiết tính</option>
      </select>
      <span className="text-[10px] font-normal text-slate-500">
        {subCount}/{ids.length} thầu phụ
      </span>
    </div>
  );
}
