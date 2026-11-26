"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { rejectCatalogChangeAction, reviewCatalogChangeAction } from "@/lib/actions";

type Res = { id: string; code: string; name: string; unit: string; sourceType: string };
const CAT: Record<string, string> = { VT: "Vật tư", NC: "Nhân công", TB: "Máy thi công" };

export default function ChangeReview({
  change,
  resources,
  usedInBoq = 0,
  kind = "NORM",
  addedLines = [],
  requestReason = "",
}: {
  usedInBoq?: number;
  // LINES = người dùng thêm dòng hao phí vào định mức CÓ SẴN (không duyệt = chỉ gỡ các dòng này)
  // REMOVE = người dùng đề nghị XOÁ dòng hao phí (duyệt = xoá, không duyệt = giữ)
  kind?: "NORM" | "LINES" | "REMOVE";
  requestReason?: string;
  addedLines?: { category: string; code: string; name: string; unit: string; quantity: number }[];
  change: { id: string; userName: string; createdAt: string; workItemName: string; workItemUnit: string; workItemCode: string };
  resources: Res[];
}) {
  const router = useRouter();
  const [wCode, setWCode] = useState(change.workItemCode);
  const [codes, setCodes] = useState<Record<string, string>>(Object.fromEntries(resources.map((r) => [r.id, r.code])));
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const input = "w-full rounded border border-slate-300 px-2 py-1 text-sm";

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          Thêm bởi <b className="text-slate-700">{change.userName}</b> · {change.createdAt}
        </span>
        <span>
          {kind === "LINES" && <b className="mr-2 rounded bg-sky-100 px-1.5 py-0.5 text-sky-700">Thêm dòng hao phí vào định mức có sẵn</b>}
          {kind === "REMOVE" && <b className="mr-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">Đề nghị XOÁ dòng hao phí</b>}
          {resources.length} vật tư/nhân công/máy mới
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[200px_1fr_80px]">
        <div>
          <label className="block text-xs font-medium text-slate-700">Mã định mức</label>
          <input value={wCode} onChange={(e) => setWCode(e.target.value)} disabled={kind !== "NORM"} title={kind === "LINES" ? "Định mức có sẵn - giữ nguyên mã" : undefined} className={`${input} disabled:bg-slate-50 disabled:text-slate-500`} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700">Tên công tác</label>
          <div className="rounded border border-slate-100 bg-slate-50 px-2 py-1 text-sm text-slate-700">{change.workItemName}</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700">ĐVT</label>
          <div className="rounded border border-slate-100 bg-slate-50 px-2 py-1 text-sm text-slate-700">{change.workItemUnit}</div>
        </div>
      </div>

      {kind === "REMOVE" && requestReason && <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">Lý do người đề nghị: {requestReason}</p>}
      {kind !== "NORM" && addedLines.length > 0 && (
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="w-28 py-1 font-medium">Loại</th>
              <th className="w-40 py-1 font-medium">Mã hao phí</th>
              <th className="py-1 font-medium">{kind === "REMOVE" ? "Dòng hao phí đề nghị xoá" : "Dòng hao phí đã thêm"}</th>
              <th className="w-24 py-1 text-right font-medium">Định mức</th>
              <th className="w-16 py-1 pl-2 font-medium">ĐVT</th>
            </tr>
          </thead>
          <tbody>
            {addedLines.map((l, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="py-1 text-slate-500">{CAT[l.category] ?? l.category}</td>
                <td className="py-1 font-mono text-xs text-slate-600">{l.code}</td>
                <td className="py-1 text-slate-700">{l.name}</td>
                <td className="py-1 text-right text-slate-700">{l.quantity.toLocaleString("vi-VN", { maximumFractionDigits: 6 })}</td>
                <td className="py-1 pl-2 text-slate-500">{l.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {resources.length > 0 && (
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="w-28 py-1 font-medium">Loại</th>
              <th className="w-56 py-1 font-medium">Mã</th>
              <th className="py-1 font-medium">Tên</th>
              <th className="w-16 py-1 font-medium">ĐVT</th>
            </tr>
          </thead>
          <tbody>
            {resources.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="py-1 text-slate-500">{CAT[r.sourceType] ?? r.sourceType}</td>
                <td className="py-1 pr-2">
                  <input value={codes[r.id] ?? ""} onChange={(e) => setCodes((p) => ({ ...p, [r.id]: e.target.value }))} className={input} />
                </td>
                <td className="py-1 text-slate-700">{r.name}</td>
                <td className="py-1 text-slate-500">{r.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {error && <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="mt-3 flex items-center gap-3">
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError("");
              const res = await reviewCatalogChangeAction(change.id, wCode, codes);
              if (!res.ok) setError(res.error ?? "Lỗi");
              else router.refresh();
            })
          }
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? "Đang lưu..." : kind === "REMOVE" ? "Đồng ý xoá" : "Lưu & xác nhận"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setRejecting((r) => !r)}
          className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          Không duyệt
        </button>
        <span className="text-xs text-slate-400">Sửa mã (nếu cần) rồi xác nhận; hoặc bấm &quot;Không duyệt&quot; để loại định mức này.</span>
      </div>
      {rejecting && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm">
          {kind === "REMOVE" ? (
            <p className="text-red-800">Không duyệt sẽ <b>giữ nguyên dòng hao phí</b> trong định mức (không xoá).</p>
          ) : kind === "LINES" ? (
            <p className="text-red-800">
              Không duyệt sẽ <b>gỡ {addedLines.length} dòng hao phí</b> người dùng đã thêm khỏi định mức này (định mức giữ nguyên)
              {resources.length > 0 ? `, xoá ${resources.length} vật tư/nhân công/máy mới tạo kèm nếu không nơi nào khác dùng` : ""}.
            </p>
          ) : (
          <p className="text-red-800">
            Không duyệt sẽ <b>xoá định mức này khỏi danh mục</b>
            {resources.length > 0 ? ` cùng ${resources.length} vật tư/nhân công/máy mới tạo kèm (nếu không nơi nào khác dùng)` : ""}.
            {usedInBoq > 0 ? ` Đang có ${usedInBoq} dòng BOQ dùng định mức này — các dòng đó sẽ trở về "chưa có định mức".` : " Hiện chưa có dòng BOQ nào dùng."}
          </p>
          )}
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lý do không duyệt (VD: trùng mã SAN-01 đã có, sai định mức...)" className="mt-2 w-full rounded border border-red-200 bg-white px-2 py-1 text-sm" />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError("");
                  const res = await rejectCatalogChangeAction(change.id, reason);
                  if (!res.ok) setError(res.error ?? "Lỗi");
                  else router.refresh();
                })
              }
              className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {pending ? "Đang xử lý..." : "Xác nhận không duyệt"}
            </button>
            <button type="button" onClick={() => setRejecting(false)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600">
              Huỷ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
