import Link from "next/link";
import Letterhead from "../../../projects/[id]/Letterhead";
import { buildView } from "@/lib/sheet-view-model";
import OldSheetTable from "./OldSheetTable";
import { toSnapV2, type SheetSnap } from "@/lib/sheet-snapshot";

// Hiển thị sheet DT-CP / BOQ / CHI TIẾT của file DT-CP cũ theo GIAO DIỆN DT-CP của phần mềm (logo + đầu trang, bảng xanh lá, dòng A/B nền xanh chữ đỏ,
// nhóm I/II đậm, thụt lề theo cấp STT, số có dấu phân cách, %) — còn SỐ DÒNG / SỐ CỘT / NỘI DUNG đúng như file Excel (không bảng thô).
const PAGE = 300; // sheet lớn xem theo trang

// dữ liệu chụp bản cũ (mảng giá trị thô, chưa có ô gộp) → cùng định dạng mới để vẫn vẽ bằng giao diện này
export const toSnap = (raw: unknown): SheetSnap => toSnapV2(raw);

export default function OldSheetView({ snap, page, pageHref, letterhead, sheetName, sheetId, canEdit }: { snap: SheetSnap; page: number; pageHref: (p: number) => string; letterhead?: boolean; sheetName: string; sheetId: string; canEdit: boolean }) {
  const view = buildView(snap);
  const pages = Math.max(1, Math.ceil(view.body.length / PAGE));
  const pg = Math.min(Math.max(1, page), pages);
  const body = view.body.slice((pg - 1) * PAGE, pg * PAGE);
  const mains = view.title.filter((t) => t.main);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      {letterhead && <Letterhead />}
      {view.title.length > 0 && (
        <div className="mt-4 space-y-0.5">
          {view.title.map((t, i) => (
            <p key={i} className={t.main ? `text-center font-bold text-slate-900 ${mains.indexOf(t) === 0 && mains.length > 1 ? "text-lg" : "text-2xl"}` : "text-sm text-slate-800"}>
              {t.text}
            </p>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>
          Sheet <b className="text-slate-700">{sheetName}</b> · {view.body.length.toLocaleString("vi-VN")} dòng · {view.cols.length} cột
        </span>
        {pages > 1 && (
          <>
            {pg > 1 && (
              <Link href={pageHref(pg - 1)} className="rounded border border-slate-300 bg-white px-2 py-0.5 hover:bg-slate-50">
                ← Trang trước
              </Link>
            )}
            <span>
              Trang {pg}/{pages}
            </span>
            {pg < pages && (
              <Link href={pageHref(pg + 1)} className="rounded border border-slate-300 bg-white px-2 py-0.5 hover:bg-slate-50">
                Trang sau →
              </Link>
            )}
          </>
        )}
      </div>
      <div className="mt-2">
        <OldSheetTable view={{ ...view, body }} sheetId={sheetId} canEdit={canEdit} />
      </div>
    </div>
  );
}
