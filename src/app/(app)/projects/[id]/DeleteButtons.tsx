"use client";

import { useTransition } from "react";
import { deleteBoqItemAction, deleteWorkItemResourceLineAction } from "@/lib/actions";
import { confirmNear } from "@/app/(app)/confirm-near";

export function BoqDeleteButton({ projectId, boqItemId, message }: { projectId: string; boqItemId: string; message: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      className="text-xs leading-5 text-red-500 hover:underline"
      onClick={async () => (await confirmNear(message)) && start(() => void deleteBoqItemAction(projectId, boqItemId))}
    >
      Xoá
    </button>
  );
}

export function LineDeleteButton({ lineId, message }: { lineId: string; message: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      className="text-red-500 hover:underline"
      onClick={async () => (await confirmNear(message)) && start(() => void deleteWorkItemResourceLineAction(lineId))}
    >
      Xoá
    </button>
  );
}
