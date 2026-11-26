"use client";

import { useTransition } from "react";
import NumInput from "@/app/(app)/NumInput";
import { setPortionMgmtPctAction } from "@/lib/actions";

// Ô % chi phí quản lý vật tư / thiết bị TMN cấp của 1 phần giao thầu phụ (dòng "Quản lý VT / TB" ở CHI TIẾT).
// own = false: đang theo tỷ lệ mặc định của nhà thầu (chữ xám); gõ số = % riêng cho công tác này; xoá trắng = về mặc định.
export default function MgmtPctInput({ projectId, subId, kind, pct, own }: { projectId: string; subId: string; kind: "vt" | "tb"; pct: number; own: boolean }) {
  const [pending, start] = useTransition();
  return (
    <NumInput
      value={own ? pct : null}
      placeholder={`${+pct.toFixed(2)}`}
      allowEmpty
      decimals
      suffix="%"
      disabled={pending}
      title={own ? "% riêng cho công tác này — xoá trắng để quay về tỷ lệ mặc định của nhà thầu" : `Đang theo tỷ lệ mặc định của nhà thầu (${+pct.toFixed(2)}%) — gõ số để đặt riêng cho công tác này`}
      onCommit={(v) =>
        (own ? v !== pct : v !== null) &&
        start(async () => {
          const r = await setPortionMgmtPctAction(projectId, subId, kind, v);
          if (!r.ok) window.alert(r.error);
        })
      }
      className={`w-full min-w-0 rounded border px-0.5 text-right text-[10px] not-italic ${own ? "border-violet-400 bg-violet-50 text-violet-800" : "border-slate-300 placeholder:text-slate-500"}`}
    />
  );
}
