"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteSheetAction, renameSheetAction } from "@/lib/actions";
import { confirmNear } from "@/app/(app)/confirm-near";

export default function SheetHeader({ projectId, sheetId, name }: { projectId: string; sheetId: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <input
        key={name}
        defaultValue={name}
        title="Đổi tên sheet"
        onBlur={(e) => e.currentTarget.value.trim() && e.currentTarget.value !== name && start(() => void renameSheetAction(projectId, sheetId, e.currentTarget.value))}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="rounded border border-transparent bg-transparent px-1 py-0.5 text-base font-medium text-slate-900 hover:border-slate-300 focus:border-blue-400 focus:bg-white"
      />
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          if (!await confirmNear(`⚠ Bạn có chắc chắn muốn XOÁ sheet "${name}" cùng toàn bộ dữ liệu trong sheet không?\n\nThao tác này không hoàn tác được.`)) return;
          start(async () => {
            await deleteSheetAction(projectId, sheetId);
            router.push(`/projects/${projectId}`);
          });
        }}
        className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
      >
        Xoá sheet
      </button>
    </div>
  );
}
