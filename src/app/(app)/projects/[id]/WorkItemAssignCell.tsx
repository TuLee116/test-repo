"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { assignBoqWorkItemAction, deleteManualNormAction, unassignBoqWorkItemAction } from "@/lib/actions";
import type { AssignmentReview } from "@/lib/boq-match";
import WorkItemInlineSearch, { type CatalogOption } from "./import/WorkItemInlineSearch";
import NewNormModal from "./NewNormModal";

// Danh mục công tác tải khi người dùng bấm chọn mã (không gắn vào từng dòng để trang nhẹ). Mỗi lần mở đều
// tải lại bản mới nhất (định mức vừa tạo ở dòng khác có ngay, không cần F5); trong lúc chờ dùng bản đã có.
let catalogCache: CatalogOption[] | null = null;
function loadCatalog(): Promise<CatalogOption[]> {
  return fetch("/api/catalog")
    .then((r) => r.json())
    .then((d) => (catalogCache = d.items as CatalogOption[]));
}

export default function WorkItemAssignCell({
  currentId,
  currentCode,
  projectId,
  boqItemId,
  compact,
  review,
  defaultName = "",
  defaultUnit = "",
}: {
  currentId: string | null;
  currentCode: string | null;
  projectId: string;
  boqItemId: string;
  compact?: boolean;
  // Kết quả rà soát dòng (createMatcher().review): chưa gán → mã gợi ý; đã gán mà lệch nội dung (khác
  // loại công tác/cấu kiện/đường kính/mác) → lý do + mã nên đổi. null = không có gì để báo.
  review?: AssignmentReview | null;
  defaultName?: string; // mô tả + ĐVT của dòng BOQ, điền sẵn khi bổ sung định mức thủ công
  defaultUnit?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [catalog, setCatalog] = useState<CatalogOption[] | null>(catalogCache);
  const [pending, startTransition] = useTransition();

  // Mọi lựa chọn ở đây đều do người dùng bấm → server ghi nhớ cách viết (xem assignBoqWorkItemAction)
  const assign = (workItemId: string) => startTransition(() => void assignBoqWorkItemAction(projectId, boqItemId, workItemId));
  const anchorRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const open = () => {
    setEditing(true);
    if (catalogCache) setCatalog(catalogCache);
    loadCatalog().then(setCatalog).catch(() => {});
  };

  // Đặt khung nổi ngay dưới ô (hoặc phía trên nếu sát đáy màn hình), bám theo khi cuộn bảng
  useEffect(() => {
    if (!editing) return;
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = 420;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      setPos(window.innerHeight - r.bottom > 380 || r.top < 380 ? { left, top: r.bottom + 4 } : { left, bottom: window.innerHeight - r.top + 4 });
    };
    place();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setEditing(false);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("keydown", onKey);
    };
  }, [editing]);
  const isManual = !!currentId && !!catalog?.find((c) => c.id === currentId)?.manual;
  const unassign = () =>
    startTransition(async () => {
      const r = await unassignBoqWorkItemAction(projectId, boqItemId);
      if (!r.ok) window.alert(r.error);
    });
  const delNorm = () => {
    if (!window.confirm(`Xoá định mức tự tạo ${currentCode}? Dòng này sẽ về trạng thái chưa có định mức. Không khôi phục được.`)) return;
    startTransition(async () => {
      const r = await deleteManualNormAction(projectId, currentId!);
      if (!r.ok) return window.alert(r.error);
      loadCatalog().then(setCatalog).catch(() => {});
      setEditing(false);
    });
  };
  const warn = currentId && review?.reason ? review : null;
  const hint = !currentId && review?.suggestion ? review.suggestion : null;

  const close = () => setEditing(false);
  const chip = compact ? "block max-w-[50px] truncate" : "";

  return (
    <div ref={anchorRef} className="flex flex-col items-start gap-0.5">
      <button type="button" onClick={open} className="text-left" disabled={pending}>
        {currentCode ? (
          <span className={`text-slate-700 hover:underline ${chip}`} title={currentCode}>
            {currentCode}
          </span>
        ) : (
          <span className="whitespace-nowrap rounded bg-red-100 px-1.5 py-0 text-xs leading-5 text-red-700 hover:bg-red-200">{compact ? "Chọn" : "Chưa có ĐM"}</span>
        )}
      </button>
      {hint && (
        <button
          type="button"
          disabled={pending}
          title={`Gợi ý: ${hint.code} — ${hint.name} (${hint.unit}). Bấm để gán mã này, hoặc bấm "${compact ? "Chọn" : "Chưa có ĐM"}" để xem thêm gợi ý khác.`}
          onClick={() => assign(hint.id)}
          className={`whitespace-nowrap rounded bg-sky-100 px-1 text-[10px] leading-4 text-sky-700 hover:bg-sky-200 ${chip}`}
        >
          💡 {hint.code}
        </button>
      )}
      {warn && (
        <button
          type="button"
          disabled={pending}
          title={`${warn.reason}${warn.suggestion ? ` — gợi ý ${warn.suggestion.code}` : ""}. Bấm để xem và chọn lại.`}
          onClick={open}
          className={`whitespace-nowrap rounded bg-orange-100 px-1 text-[10px] leading-4 text-orange-700 hover:bg-orange-200 ${chip}`}
        >
          ⚠ {warn.suggestion?.code ?? "lệch"}
        </button>
      )}
      {editing && pos &&
        createPortal(
          // Khung nổi riêng (gắn vào body, vị trí cố định theo ô) - cột mã ở CHI TIẾT rất hẹp, để trong ô
          // thì khung bung ra đè lên chữ các cột bên cạnh, không đọc được.
          <div
            style={{ position: "fixed", left: pos.left, ...(pos.top != null ? { top: pos.top } : { bottom: pos.bottom }) }}
            className="z-50 w-[26rem] rounded-lg border border-slate-300 bg-white p-2.5 text-left shadow-2xl"
            onKeyDown={(e) => e.key === "Escape" && close()}
          >
            <div className="mb-1.5 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Chọn mã định mức cho dòng</div>
                <div className="line-clamp-2 whitespace-pre-line text-xs font-medium text-slate-800" title={defaultName}>
                  {defaultName.split("\n")[0]}
                  {defaultUnit && <span className="font-normal text-slate-500"> ({defaultUnit})</span>}
                </div>
                {currentCode && (
                  <div className="text-[11px] text-slate-500">
                    Đang gán: {currentCode}
                    <button type="button" disabled={pending} onClick={unassign} className="ml-2 rounded bg-amber-50 px-1.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-300 hover:bg-amber-100" title="Chọn nhầm mã — bỏ mã này khỏi dòng này rồi chọn lại mã khác (không ảnh hưởng định mức chung, không cần quản trị duyệt)">
                      ✕ Bỏ mã này, chọn lại
                    </button>
                    {isManual && (
                      <button type="button" disabled={pending} onClick={delNorm} className="ml-2 rounded bg-red-50 px-1.5 text-[11px] font-medium text-red-700 ring-1 ring-red-200 hover:bg-red-100" title="Định mức này do người dùng tự tạo — xoá nếu tạo nhầm">
                        🗑 Xoá định mức này
                      </button>
                    )}
                  </div>
                )}
              </div>
              <button type="button" onClick={close} className="shrink-0 rounded px-1.5 text-sm leading-5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Đóng (Esc)">
                ✕
              </button>
            </div>
            {warn && (
              <div className="mb-2 flex items-start justify-between gap-2 rounded-md bg-orange-50 px-2 py-1.5 text-[11px] leading-snug text-orange-800">
                <span>⚠ {warn.reason}</span>
                <button
                  type="button"
                  onClick={() => {
                    assign(currentId!);
                    close();
                  }}
                  title="Mã hiện tại là đúng ý (VD danh mục chưa có mã riêng nên dùng tạm mã tương tự) - không cảnh báo dòng này nữa"
                  className="shrink-0 whitespace-nowrap rounded bg-white px-1.5 py-0.5 font-medium text-orange-700 ring-1 ring-orange-300 hover:bg-orange-100"
                >
                  Giữ mã {currentCode}
                </button>
              </div>
            )}
            {catalog ? (
              <WorkItemInlineSearch
                inline
                items={catalog}
                suggestions={review?.candidates}
                autoFocus
                onPick={(item) => {
                  assign(item.id);
                  close();
                }}
              />
            ) : (
              <div className="text-[11px] text-slate-400">Đang tải danh mục...</div>
            )}
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
              <NewNormModal projectId={projectId} boqItemId={boqItemId} defaultName={defaultName} defaultUnit={defaultUnit} onCreated={close} />
              <button type="button" onClick={close} className="text-[11px] text-slate-500 hover:text-slate-700">
                Huỷ
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
