"use client";

import { updateProgressAction } from "@/lib/actions";

export default function ProgressField({ projectId, value }: { projectId: string; value: string }) {
  return (
    <input
      defaultValue={value}
      placeholder="(nhập tiến độ)"
      onBlur={(e) => e.currentTarget.value !== value && updateProgressAction(projectId, e.currentTarget.value)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className="w-96 max-w-full border-b border-dashed border-slate-300 bg-transparent px-1 focus:border-blue-400 focus:outline-none"
    />
  );
}
