"use client";

import { useTransition } from "react";
import { insertBoqRowAction, insertBoqRowBeforeAction, setBoqHeadingAction, setBoqHeadingLevelAction, updateBoqItemTextAction } from "@/lib/actions";
import { confirmNear } from "@/app/(app)/confirm-near";

type TextField = "rawDescription" | "rawUnit" | "stt" | "note";

// Ô sửa trực tiếp nội dung BOQ (mô tả / ĐVT / STT). Bấm ra ngoài hoặc Enter để lưu.
export function BoqTextField({
  projectId,
  boqItemId,
  field,
  value,
  placeholder,
  multiline,
  className,
}: {
  projectId: string;
  boqItemId: string;
  field: TextField;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
}) {
  const [, start] = useTransition();
  const save = (v: string) => {
    if (v !== value) start(() => void updateBoqItemTextAction(projectId, boqItemId, { [field]: v }));
  };
  const base = "block w-full rounded-none border-0 bg-transparent px-1 py-0 leading-5 hover:ring-1 hover:ring-slate-300 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 " + (className ?? "");
  if (multiline) {
    return (
      <textarea
        key={value}
        defaultValue={value}
        placeholder={placeholder}
        rows={1}
        onBlur={(e) => save(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        className={base + " resize-none [field-sizing:content]"}
      />
    );
  }
  return (
    <input
      key={value}
      defaultValue={value}
      placeholder={placeholder}
      onBlur={(e) => save(e.currentTarget.value)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className={base}
    />
  );
}

// Menu "＋" ở mỗi dòng: thêm công tác / đầu mục mới ngay bên dưới (hoặc bên trên) dòng này
export function BoqAddRow({ projectId, afterId, isHeading, depth = 0 }: { projectId: string; afterId: string; isHeading: boolean; depth?: number }) {
  const [pending, start] = useTransition();
  return (
    <select
      value=""
      disabled={pending}
      title="Thêm dòng mới ngay bên dưới / bên trên (VD: CĐT bổ sung công tác)"
      onChange={async (e) => {
        const v = e.target.value;
        if (!v) return;
        if (v === "indent" || v === "outdent" || v === "auto") {
          start(() => void setBoqHeadingLevelAction(projectId, [afterId], v === "auto" ? null : v === "indent" ? depth + 1 : Math.max(0, depth - 1)));
          return;
        }
        if (v === "toggle") {
          if (!isHeading || (await confirmNear("Chuyển đầu mục này thành công tác?"))) start(() => void setBoqHeadingAction(projectId, afterId, !isHeading));
          else if (isHeading) return;
          return;
        }
        if (v === "itemAbove" || v === "headingAbove") {
          start(() => void insertBoqRowBeforeAction(projectId, afterId, v === "headingAbove"));
          return;
        }
        start(() => void insertBoqRowAction(projectId, afterId, v === "heading"));
      }}
      className="h-5 w-14 cursor-pointer rounded border border-slate-300 bg-white px-1 py-0 text-[11px] leading-none text-slate-600"
    >
      <option value="">＋</option>
      <option value="item">Thêm công tác bên dưới</option>
      <option value="heading">Thêm đầu mục bên dưới</option>
      <option value="itemAbove">Thêm công tác bên trên</option>
      <option value="headingAbove">{isHeading ? "Thêm đầu mục bên trên (cùng cấp)" : "Thêm đầu mục bên trên"}</option>
      {isHeading && <option value="indent">▶ Thụt vào 1 cấp (thành mục con)</option>}
      {isHeading && <option value="outdent">◀ Ra 1 cấp (lên mục cha)</option>}
      {isHeading && <option value="auto">↺ Cấp tự động theo STT</option>}
      <option value="toggle">{isHeading ? "↳ Chuyển thành công tác" : "↳ Chuyển thành đầu mục"}</option>
    </select>
  );
}

// Nút thêm ở cuối bảng
export function BoqAppendButtons({ projectId, sheetId = null }: { projectId: string; sheetId?: string | null }) {
  const [pending, start] = useTransition();
  const cls = "rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50";
  return (
    <>
      <button disabled={pending} className={cls} onClick={() => start(() => void insertBoqRowAction(projectId, null, false, sheetId))}>
        + Thêm công tác
      </button>
      <button disabled={pending} className={cls} onClick={() => start(() => void insertBoqRowAction(projectId, null, true, sheetId))}>
        + Thêm đầu mục
      </button>
    </>
  );
}
