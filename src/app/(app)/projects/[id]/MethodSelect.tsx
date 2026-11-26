"use client";

import { useTransition } from "react";
import { setBoqMethodAction } from "@/lib/actions";
import { confirmNear } from "@/app/(app)/confirm-near";

export default function MethodSelect({
  projectId,
  boqItemId,
  method,
  hasSubPrice,
}: {
  projectId: string;
  boqItemId: string;
  method: string;
  hasSubPrice: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <select
      value={method}
      disabled={pending}
      onChange={async (e) => {
        const next = e.target.value as "DETAIL" | "SUB";
        if (next === "DETAIL" && hasSubPrice && !await confirmNear("Chuyển về chiết tính sẽ xoá dòng thầu phụ (đơn giá, nhà thầu) đã nhập ở sheet TH Thầu Phụ. Tiếp tục?")) return;
        start(() => void setBoqMethodAction(projectId, boqItemId, next));
      }}
      className={`rounded border px-1 py-0.5 text-xs ${method === "SUB" ? "border-orange-400 bg-orange-100 text-orange-800" : "border-slate-300 bg-white"}`}
    >
      <option value="DETAIL">Chiết tính</option>
      <option value="SUB">Thầu phụ</option>
    </select>
  );
}
