"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import NumInput from "@/app/(app)/NumInput";
import { addSubPortionAction, deleteSubcontractorItemAction, updateSubPortionAction } from "@/lib/actions";
import { parseCoveredLines, subCovers } from "@/lib/sub-portions";
import { confirmNear } from "@/app/(app)/confirm-near";
import { fmtQty } from "@/lib/fmt-qty";

export type PortionRow = { id: string; quantity: number; coverVT: boolean; coverTB: boolean; coverNC: boolean; coveredLines: string | null; contractorName: string; unitPrice: number; amount: number; note?: string };
export type LineRow = { id: string; name: string; category: string };

const fmt = (n: number) => Math.round(n).toLocaleString("vi-VN");
const fmtQ = fmtQty;

// Chia 1 dòng BOQ (chiết tính) thành nhiều phần giao thầu phụ. Phạm vi mỗi phần: theo nhóm (vật tư / thiết bị / nhân công),
// từng dòng hao phí, hoặc 1 PHẦN VIỆC RIÊNG ngoài định mức (không thay hao phí nào - VD quầy đá: mình lắp đá, thầu phụ làm
// khung sắt). Phần hao phí thầu phụ bao không tính vào chi phí của mình. Tên thầu phụ và đơn giá nhập ở sheet TH Thầu Phụ.
export default function SubPortionEditor({ projectId, boqItemId, boqQty, unit, portions, lines }: { projectId: string; boqItemId: string; boqQty: number; unit: string; portions: PortionRow[]; lines: LineRow[] }) {
  const [pending, start] = useTransition();
  const [openLines, setOpenLines] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const given = portions.reduce((s, p) => s + p.quantity, 0);
  // vượt khối lượng tính theo TỪNG dòng hao phí (2 phần giao khác phần việc cùng đủ 100% khối lượng là hợp lệ)
  const over = lines.some((l) => portions.filter((p) => subCovers(p, l)).reduce((s, p) => s + p.quantity, 0) > boqQty + 0.005);
  const byWork = portions.some((p) => parseCoveredLines(p.coveredLines) !== null);
  const summary = byWork
    ? "giao theo phần việc — các dòng hao phí không giao vẫn do mình tự làm đủ khối lượng"
    : `đã giao ${fmtQ(given)} / ${fmtQ(boqQty)} ${unit} (${boqQty ? +((given / boqQty) * 100).toFixed(1) : 0}%)`;
  if (portions.length === 0)
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => {
          await addSubPortionAction(projectId, boqItemId, "work");
          setExpanded(true);
        })}
        title="Giao cho thầu phụ 1 phần việc của công tác này (VD quầy đá: mình lắp đá, thầu phụ làm hệ khung sắt) hoặc 1 phần khối lượng"
        className="text-[10px] text-slate-400 hover:text-orange-700 hover:underline"
      >
        ＋ Thầu phụ làm 1 phần việc / 1 phần khối lượng
      </button>
    );
  if (!expanded)
    return (
      <div className="my-0.5 flex flex-wrap items-center gap-2 rounded border border-dashed border-orange-300 bg-orange-50/60 px-2 py-0.5 text-[11px]">
        <b className="text-orange-800">⚑ Có giao thầu phụ</b>
        <span className={over ? "font-semibold text-red-600" : "text-slate-600"}>
          {summary}
          {over && " ⚠ vượt khối lượng BOQ"}
        </span>
        <button type="button" onClick={() => setExpanded(true)} className="text-blue-700 underline">
          chi tiết / chỉnh riêng công tác này
        </button>
      </div>
    );
  const upd = (id: string, data: Parameters<typeof updateSubPortionAction>[2]) => start(() => void updateSubPortionAction(projectId, id, data));
  return (
    <div className={`my-0.5 rounded border border-dashed border-orange-300 bg-orange-50/60 px-2 py-1 text-[11px] ${pending ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-orange-800">Giao thầu phụ một phần việc / một phần khối lượng</b>
        <button type="button" onClick={() => setExpanded(false)} className="text-slate-500 underline">
          thu gọn
        </button>
        <button type="button" onClick={() => start(() => void addSubPortionAction(projectId, boqItemId, "work"))} className="rounded border border-orange-400 bg-white px-1.5 py-0.5 font-medium text-orange-700 hover:bg-orange-100">
          ＋ Thêm phần việc giao thầu
        </button>
        <button type="button" onClick={() => start(() => void addSubPortionAction(projectId, boqItemId, "qty"))} className="rounded border border-orange-300 bg-white px-1.5 py-0.5 text-orange-700 hover:bg-orange-100">
          ＋ Giao phần khối lượng còn lại
        </button>
        {portions.length > 0 && (
          <span className={over ? "font-semibold text-red-600" : "text-slate-600"}>
            {byWork ? summary : `Đã giao ${fmtQ(given)} / ${fmtQ(boqQty)} ${unit} — mình tự làm ${fmtQ(Math.max(0, boqQty - given))} ${unit}`}
            {over && " (⚠ vượt khối lượng BOQ)"}
          </span>
        )}
      </div>
      {portions.map((p, i) => {
        const customLines = parseCoveredLines(p.coveredLines);
        return (
          <div key={p.id} className="mt-1 border-t border-orange-200 pt-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold text-slate-700">Phần {i + 1}</span>
              <input
                key={p.note ?? ""}
                defaultValue={p.note ?? ""}
                placeholder="Nội dung phần việc (VD: hệ khung sắt)"
                onBlur={(e) => e.currentTarget.value.trim() !== (p.note ?? "") && upd(p.id, { note: e.currentTarget.value })}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className="w-48 rounded border border-slate-300 bg-white px-1 py-0.5"
              />
              <span className="flex items-center gap-1">
                SL giao:
                <NumInput value={p.quantity} decimals qty onCommit={(v) => upd(p.id, { quantity: v ?? 0 })} className="w-24 rounded border border-slate-300 px-1 py-0.5 text-right" />
                {unit}
                <span className="text-slate-500">hoặc</span>
                <NumInput
                  key={`${p.id}-${p.quantity}`}
                  value={boqQty ? +((p.quantity / boqQty) * 100).toFixed(6) : null}
                  decimals
                  suffix="%"
                  onCommit={(v) => v != null && upd(p.id, { percent: v })}
                  className="w-20 rounded border border-slate-300 px-1 py-0.5 text-right"
                />
                <span className="text-slate-400" title="Gõ 100% = giao đủ khối lượng công tác, không bị lỗi làm tròn như chép số khối lượng đang hiển thị">
                  của công tác
                </span>
              </span>
              {!customLines && (
                <span className="flex items-center gap-2">
                  Thầu phụ bao:
                  {(["coverVT", "coverTB", "coverNC"] as const).map((k) => (
                    <label key={k} className="flex cursor-pointer items-center gap-0.5">
                      <input type="checkbox" checked={p[k]} onChange={(e) => upd(p.id, { [k]: e.target.checked })} />
                      {k === "coverVT" ? "Vật tư" : k === "coverTB" ? "Thiết bị" : "Nhân công"}
                    </label>
                  ))}
                </span>
              )}
              {customLines && customLines.length === 0 ? (
                <span className="rounded bg-white px-1 text-emerald-700 ring-1 ring-emerald-300" title="Không thay dòng hao phí nào của định mức: mình vẫn làm đủ theo định mức, chi phí thầu phụ cộng thêm vào cột Thầu phụ">
                  Phần việc riêng ngoài định mức (chi phí thầu phụ cộng thêm)
                </span>
              ) : (
                <button type="button" onClick={() => upd(p.id, { coveredLines: [] })} className="text-emerald-700 underline" title="Thầu phụ làm phần việc không có trong định mức (VD khung sắt) - không thay dòng hao phí nào">
                  Phần việc riêng ngoài định mức
                </button>
              )}
              <button type="button" onClick={() => setOpenLines(openLines === p.id ? null : p.id)} className="text-blue-700 underline">
                {customLines && customLines.length > 0 ? `Đang chọn riêng ${customLines.length}/${lines.length} dòng hao phí` : "Chọn riêng từng dòng hao phí"}
              </button>
              {customLines && (
                <button type="button" onClick={() => upd(p.id, { coverVT: p.coverVT })} className="text-slate-500 underline">
                  ↺ về chọn theo nhóm
                </button>
              )}
              <span className="text-slate-600">
                {p.contractorName || "(chưa nhập thầu phụ)"} · đơn giá {p.unitPrice ? fmt(p.unitPrice) : "—"} · giá trị {fmt(p.amount)}{" "}
                <Link href={`/projects/${projectId}/thau-phu#sub-${p.id}`} className="text-blue-700 underline">
                  nhập ở TH Thầu Phụ
                </Link>
              </span>
              <button type="button" title="Xoá phần giao này" onClick={async () => (await confirmNear("Xoá phần giao thầu phụ này?")) && start(() => void deleteSubcontractorItemAction(projectId, p.id))} className="text-red-600">
                ×
              </button>
            </div>
            {openLines === p.id && (
              <div className="mt-1 grid gap-x-4 gap-y-0.5 pl-3 sm:grid-cols-2">
                {lines.map((l) => {
                  const covered = subCovers(p, l);
                  return (
                    <label key={l.id} className="flex cursor-pointer items-center gap-1">
                      <input
                        type="checkbox"
                        checked={covered}
                        onChange={(e) => {
                          const cur = lines.filter((x) => subCovers(p, x)).map((x) => x.id);
                          upd(p.id, { coveredLines: e.target.checked ? [...new Set([...cur, l.id])] : cur.filter((id) => id !== l.id) });
                        }}
                      />
                      <span className="text-slate-400">{l.category === "VT" ? "VT" : l.category === "NC" ? "NC" : "TB"}</span> {l.name}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
