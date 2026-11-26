import type { TransitionStartFunction } from "react";
import { pasteDownTargets, toast } from "@/app/(app)/EnterDown";
import { pasteSheetNumbersAction } from "@/lib/actions";

// Ctrl+V 1 cột số từ Excel vào ô Đơn giá / Số lượng ở sheet TH Vật Tư / Nhân Công / Thiết Bị / Thầu Phụ: điền lần
// lượt từ ô đang chọn xuống các ô bên dưới (xem pasteDownTargets), lưu 1 lần.
export function pasteSheetColumn(projectId: string, field: "unitPrice" | "quantity", lines: string[], start: TransitionStartFunction) {
  const { entries, skipped } = pasteDownTargets(lines);
  if (!entries.length) {
    toast("Không có số hợp lệ để dán vào cột này");
    return;
  }
  start(async () => {
    const r = await pasteSheetNumbersAction(projectId, field, entries);
    toast(`Đã dán ${r.count} giá trị vào cột ${field === "unitPrice" ? "Đơn giá" : "Số lượng"}${skipped ? ` (bỏ qua ${skipped} ô chỉ xem / hết bảng)` : ""}`);
  });
}
