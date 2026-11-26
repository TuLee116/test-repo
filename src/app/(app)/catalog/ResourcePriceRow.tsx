"use client";

import { useState, useTransition } from "react";
import NumInput from "@/app/(app)/NumInput";
import { updateResourcePriceAction } from "@/lib/actions";

export default function ResourcePriceRow({
  id,
  unitPrice,
  editable,
}: {
  id: string;
  unitPrice: number;
  editable: boolean;
}) {
  const [value, setValue] = useState(unitPrice);
  const [pending, startTransition] = useTransition();

  if (!editable) {
    return <span>{Math.round(unitPrice).toLocaleString("vi-VN")}</span>;
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <NumInput value={unitPrice} decimals money onLive={setValue} onCommit={() => {}} className="w-32 rounded-md border border-slate-300 px-2 py-1 text-right text-sm" />
      <button
        disabled={pending || value === unitPrice}
        onClick={() => startTransition(() => updateResourcePriceAction(id, value))}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
      >
        Lưu
      </button>
    </div>
  );
}
