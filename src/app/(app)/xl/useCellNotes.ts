"use client";

import { useMemo, useState } from "react";
import { addCellNoteAction, deleteCellNoteAction } from "@/lib/cell-note-actions";
import type { NoteEntity } from "@/lib/cell-notes";
import type { GridNote, GridNotesApi } from "../ExcelGrid";

// Ghi chú ô cho ExcelGrid: giữ danh sách ở client, thêm / xoá lưu ngay lên server (không chờ Lưu nháp)
export function useCellNotes(entity: NoteEntity, entityId: string, initial: GridNote[]): GridNotesApi {
  const [list, setList] = useState(initial);
  return useMemo(
    () => ({
      list,
      add: async (row, col, text) => {
        const r = await addCellNoteAction(entity, entityId, row, col, text);
        if (!r.ok) return r.error;
        setList((l) => [...l, r.note]);
        return null;
      },
      remove: async (id) => {
        const r = await deleteCellNoteAction(id);
        if (!r.ok) return r.error;
        setList((l) => l.filter((n) => n.id !== id));
        return null;
      },
    }),
    [list, entity, entityId],
  );
}
