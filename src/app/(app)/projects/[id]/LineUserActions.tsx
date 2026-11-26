"use client";

import { useTransition } from "react";
import { deleteOwnPendingLineAction } from "@/lib/actions";
import { confirmNear } from "@/app/(app)/confirm-near";

// Nút cho người dùng thường ở 1 dòng hao phí (CHI TIẾT):
// - dòng do chính họ thêm, quản trị viên chưa duyệt → xoá được ngay (✕)
// - dòng khác → không có nút (đề nghị xoá đã bỏ; chọn nhầm mã thì bỏ mã ở ô Chọn định mức)
export default function LineUserActions({ lineId, name, own, removalPending }: { lineId: string; name: string; own: boolean; removalPending: boolean }) {
  const [pending, start] = useTransition();
  const sent = removalPending;
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) alert(r.error ?? "Lỗi");
      else after?.();
    });

  if (own)
    return (
      <button
        type="button"
        disabled={pending}
        title="Xoá dòng hao phí bạn vừa thêm (chưa được quản trị viên duyệt)"
        onClick={async () => await confirmNear(`Xoá dòng hao phí "${name}" bạn đã thêm?`) && run(() => deleteOwnPendingLineAction(lineId))}
        className="rounded px-1 text-xs font-bold text-red-500 hover:bg-red-50"
      >
        ✕
      </button>
    );
  if (sent) return <span className="text-[9px] leading-tight text-amber-600" title="Đã gửi đề nghị xoá, chờ quản trị viên duyệt">chờ xoá</span>;
  return null; // đã bỏ nút "Đề nghị xoá": chọn nhầm mã thì bỏ mã ở ô Chọn định mức
}
