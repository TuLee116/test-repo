"use client";

import { useTransition } from "react";
import NumInput from "@/app/(app)/NumInput";
import { setExtraRateAction } from "@/lib/actions";

export default function ExtraRateInput({
  projectId,
  kind,
  ratePercent,
}: {
  projectId: string;
  kind: "ncKhacRate" | "tbRate" | "mmtbRate";
  ratePercent: number;
}) {
  const [pending, start] = useTransition();
  return (
    <span className="block w-full min-w-0">
      <NumInput
        value={+ratePercent.toFixed(4)}
        decimals
        suffix="%"
        disabled={pending}
        title="Áp dụng cho toàn bộ các công tác bên dưới"
        onCommit={(v) => start(() => void setExtraRateAction(projectId, kind, v ?? 0))}
        className="w-full min-w-0 rounded border border-slate-400 bg-yellow-50 px-1 py-0.5 text-right text-xs"
      />
    </span>
  );
}
