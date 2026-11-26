"use client";

import { useTransition } from "react";
import NumInput from "@/app/(app)/NumInput";
import { setResourceWastageAction } from "@/lib/actions";

export default function WastageCell({
  projectId,
  resourceId,
  ratePercent,
}: {
  projectId: string;
  resourceId: string;
  ratePercent: number | null;
}) {
  const [pending, start] = useTransition();
  return (
    <NumInput
      value={ratePercent}
      decimals
      allowEmpty
      placeholder="theo ĐM"
      suffix="%"
      disabled={pending}
      onCommit={(v) => start(() => void setResourceWastageAction(projectId, resourceId, v))}
      className="w-full min-w-0 rounded-md border border-slate-300 px-1 py-0.5 text-right text-xs"
    />
  );
}
