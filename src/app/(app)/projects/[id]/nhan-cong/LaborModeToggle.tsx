"use client";

import { useTransition } from "react";
import { setLaborByWorkAction } from "@/lib/actions";
import { confirmNear } from "@/app/(app)/confirm-near";

// Bật: dòng nhân công chính của mỗi công tác đặt tên theo công việc BOQ (VD "Đổ bê tông lót móng, giằng
// móng..."), quản lý theo tên. Tắt: về lại nhân công theo mã của định mức.
export default function LaborModeToggle({ projectId, on }: { projectId: string; on: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
      <span className="font-medium">Nhân công đặt tên theo:</span>
      <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
        {[
          { v: true, label: "Công việc BOQ" },
          { v: false, label: "Mã định mức" },
        ].map((o) => (
          <button
            key={o.label}
            type="button"
            disabled={pending || on === o.v}
            onClick={async () => {
              const msg = o.v
                ? "Đặt tên nhân công theo công việc BOQ?\n\nMỗi công tác sẽ có dòng nhân công mang tên công việc (VD \"Đổ bê tông lót móng, giằng móng...\"), các công tác cùng tên gộp 1 dòng. Đơn giá ban đầu lấy theo nhân công của định mức (hoặc giá đã nhập ở dự án khác cùng tên)."
                : "Quay về nhân công theo mã định mức?\n\nCác tên nhân công theo công việc (và đơn giá đã nhập cho chúng) vẫn được giữ lại, bật lại là dùng tiếp.";
              if (await confirmNear(msg)) start(() => void setLaborByWorkAction(projectId, o.v));
            }}
            className={`px-2.5 py-1 ${on === o.v ? "bg-blue-600 font-medium text-white" : "bg-white hover:bg-slate-100"} disabled:cursor-default`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {pending && <span className="text-slate-400">Đang cập nhật...</span>}
      {on && !pending && <span className="text-slate-500">Bấm vào tên để sửa — đặt trùng tên với dòng khác (cùng ĐVT) để gộp. Đổi riêng 1 dòng BOQ: nút ⇄ ở CHI TIẾT.</span>}
    </div>
  );
}
