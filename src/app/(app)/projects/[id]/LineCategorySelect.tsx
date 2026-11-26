"use client";

import { useTransition } from "react";
import { setLineCategoryAction } from "@/lib/actions";
import { confirmNear } from "@/app/(app)/confirm-near";

const LABEL = { VT: "Vật tư", NC: "Nhân công", TB: "Thiết bị" } as const;
type Cat = keyof typeof LABEL;

// Chuyển 1 dòng hao phí sang mục chi phí khác (lỡ chọn nhầm Vật tư thay vì Thiết bị...) - sheet CHI TIẾT
export default function LineCategorySelect({ lineId, category, name, sharedCount }: { lineId: string; category: Cat; name: string; sharedCount: number }) {
  const [pending, start] = useTransition();
  return (
    <select
      value={category}
      disabled={pending}
      title="Đổi mục chi phí của dòng hao phí này (Vật tư / Nhân công / Thiết bị)"
      onChange={async (e) => {
        const next = e.target.value as Cat;
        const note = sharedCount > 1 ? `\n\nĐịnh mức này đang dùng ở ${sharedCount} dòng BOQ (mọi dự án) — tất cả cùng đổi theo.` : "";
        if (!(await confirmNear(`Chuyển "${name}" từ ${LABEL[category]} sang ${LABEL[next]}?${note}`, { okLabel: "Chuyển" }))) return;
        start(async () => {
          const r = await setLineCategoryAction(lineId, next);
          if (!r.ok) window.alert(r.error ?? "Không đổi được mục chi phí");
        });
      }}
      className="ml-1 rounded border border-slate-300 bg-white px-0.5 py-0 align-middle text-[10px] not-italic text-slate-600 hover:border-blue-400"
    >
      {(Object.keys(LABEL) as Cat[]).map((c) => (
        <option key={c} value={c}>
          {LABEL[c]}
        </option>
      ))}
    </select>
  );
}
