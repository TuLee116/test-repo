"use client";

import { useRef, useTransition } from "react";
import NumInput from "@/app/(app)/NumInput";
import { setBoqColumnValuesAction, setBoqQuotedPriceAction, updateBoqItemQuantityAction } from "@/lib/actions";
import { parsePastedNumber } from "@/lib/parse-number";
import { toast } from "@/app/(app)/EnterDown";

// Ô số của dòng BOQ: khối lượng hoặc giá báo CĐT.
// Enter: nhảy xuống ô cùng cột. Ctrl+V nhiều dòng (VD copy 1 cột từ Excel): điền lần lượt từ ô này xuống các ô bên dưới.
export default function NumberCell({
  projectId,
  boqItemId,
  field,
  defaultValue,
  placeholder,
}: {
  projectId: string;
  boqItemId: string;
  field: "quantity" | "quoted";
  defaultValue?: number | null;
  placeholder?: string;
}) {
  const [, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  function pasteMany(lines: string[]) {
    const cells = Array.from(document.querySelectorAll<HTMLElement>(`[data-numcell="${field}"]`));
    const from = ref.current ? cells.indexOf(ref.current) : -1;
    if (from < 0) return;
    const entries: { id: string; value: number }[] = [];
    let skipped = 0;
    lines.forEach((ln, i) => {
      const cell = cells[from + i];
      if (!cell) {
        skipped++;
        return;
      }
      const v = parsePastedNumber(ln);
      if (v === null) return; // ô trống / không phải số: giữ nguyên ô đó
      entries.push({ id: cell.dataset.boqId as string, value: v });
    });
    if (entries.length === 0) {
      toast("Không có số hợp lệ trong nội dung vừa dán");
      return;
    }
    start(async () => {
      await setBoqColumnValuesAction(projectId, field, entries);
      toast(`Đã dán ${entries.length} giá trị${field === "quoted" ? " vào cột Báo giá CĐT" : " vào cột Khối lượng"}${skipped ? ` (${skipped} dòng thừa vì hết bảng)` : ""}`);
    });
  }

  return (
    <div
      ref={ref}
      className="flex justify-end"
      data-numcell={field}
      data-boq-id={boqItemId}
      // chọn nhiều ô / dán hàng loạt như Excel (xem EnterDown.tsx)
      data-enter-col={`boq-${field}`}
      data-paste-key={`boq:${boqItemId}`}
      data-paste-field={`boq-${field}`}
      data-paste-project={projectId}
      onKeyDownCapture={(e) => {
        if (e.key !== "Enter") return;
        const cells = Array.from(document.querySelectorAll<HTMLElement>(`[data-numcell="${field}"]`));
        const next = cells[cells.indexOf(e.currentTarget as HTMLElement) + 1];
        if (!next) return;
        const input = next.querySelector("input");
        // để ô hiện tại kịp lưu (blur) rồi mới chuyển
        setTimeout(() => {
          input?.focus();
          input?.select();
          next.scrollIntoView({ block: "nearest" });
        }, 0);
      }}
    >
      <NumInput
        value={defaultValue ?? null}
        decimals={field === "quantity"}
        qty={field === "quantity"}
        allowEmpty
        allowFormula={field === "quoted"}
        placeholder={placeholder ?? "0"}
        onMultiPaste={pasteMany}
        onCommit={(v) =>
          start(() =>
            void (field === "quantity"
              ? updateBoqItemQuantityAction(projectId, boqItemId, v ?? 0)
              : setBoqQuotedPriceAction(projectId, boqItemId, v))
          )
        }
        className="h-5 w-full min-w-0 rounded border border-slate-300 px-1.5 py-0 text-right text-[13px] leading-5"
      />
    </div>
  );
}
