"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { gridSetAmountColAction, setBoqLinkAction, type BoqLinkInput } from "@/lib/actions";

type Sheet = { id: string; name: string; cols: string[]; amountCol: number | null; options: { value: string; label: string }[] };
type Mode = "" | "PCT" | "LINK";
type Side = { mode: Mode; pct: string; baseId: string; link: string };

const selectCls = "w-full rounded border border-slate-300 px-2 py-1 text-sm";

// Chọn nguồn là 1 sheet bảng tự do do người dùng thêm (các sheet mặc định DT-CP, BOQ, CHI TIẾT, TH... không có trong danh sách)
function SheetPicker({ projectId, sheets, value, onChange }: { projectId: string; sheets: Sheet[]; value: string; onChange: (v: string) => void }) {
  const [pending, start] = useTransition();
  const [sheetId, setSheetId] = useState(() => sheets.find((s) => s.options.some((o) => o.value === value))?.id ?? "");
  const sheet = sheets.find((s) => s.id === sheetId);
  const optionCount = sheet?.options.length ?? 0;

  // sheet vừa được chọn xong cột "Thành tiền": mặc định lấy tổng cả sheet
  useEffect(() => {
    if (sheet && sheet.options.length > 0 && !sheet.options.some((o) => o.value === value)) onChange(sheet.options[0].value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionCount, sheetId]);

  if (sheets.length === 0) {
    return <div className="ml-6 text-xs text-slate-400">Chưa có sheet tự do nào. Thêm bằng nút &quot;＋ Thêm sheet&quot; ở thanh tab (VD Prelim, BPTC).</div>;
  }
  return (
    <div className="ml-6 space-y-2">
      <select
        value={sheetId}
        onChange={(e) => {
          setSheetId(e.target.value);
          onChange("");
        }}
        className={selectCls}
      >
        <option value="">— chọn sheet —</option>
        {sheets.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {sheet && sheet.amountCol === null && (
        <div className="rounded border border-dashed border-slate-300 bg-slate-50 p-2 text-xs text-slate-600">
          <div>Sheet này chưa chọn cột &quot;Thành tiền&quot; — chọn cột chứa thành tiền để lấy số:</div>
          <select
            defaultValue=""
            disabled={pending}
            onChange={(e) => e.target.value !== "" && start(() => void gridSetAmountColAction(projectId, sheet.id, Number(e.target.value)))}
            className="mt-1 rounded border border-slate-300 px-1 py-0.5"
          >
            <option value="">— chọn cột Thành tiền —</option>
            {sheet.cols.map((c, i) => (
              <option key={i} value={i}>
                {c}
              </option>
            ))}
          </select>
        </div>
      )}
      {sheet && sheet.amountCol !== null && (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={selectCls}>
          {sheet.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function SideEditor({
  title,
  defaultLabel,
  baseHint,
  side,
  setSide,
  headings,
  sheets,
  projectId,
}: {
  title: string;
  defaultLabel: string;
  baseHint: string;
  side: Side;
  setSide: (s: Side) => void;
  headings: { id: string; label: string }[];
  sheets: Sheet[];
  projectId: string;
}) {
  const set = (patch: Partial<Side>) => setSide({ ...side, ...patch });
  return (
    <div className="mt-5 first:mt-4">
      <div className="text-base font-bold text-slate-900">{title}</div>
      <div className="mt-2 space-y-2">
        <label className="flex items-center gap-2">
          <input type="radio" checked={side.mode === ""} onChange={() => set({ mode: "" })} /> {defaultLabel}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={side.mode === "PCT"} onChange={() => set({ mode: "PCT" })} /> Tính theo % của một đầu mục
        </label>
        {side.mode === "PCT" && (
          <>
            <div className="ml-6 flex items-center gap-2">
              <input value={side.pct} onChange={(e) => set({ pct: e.target.value })} placeholder="3" inputMode="decimal" className="w-16 rounded border border-slate-300 px-2 py-1 text-right text-sm" />
              <span>% của</span>
              <select value={side.baseId} onChange={(e) => set({ baseId: e.target.value })} className={selectCls}>
                <option value="">— chọn đầu mục —</option>
                {headings.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="ml-6 text-xs text-slate-400">{baseHint}</div>
          </>
        )}
        <label className="flex items-center gap-2">
          <input type="radio" checked={side.mode === "LINK"} onChange={() => set({ mode: "LINK" })} /> Lấy từ sheet tự do
        </label>
        {side.mode === "LINK" && <SheetPicker projectId={projectId} sheets={sheets} value={side.link} onChange={(v) => set({ link: v })} />}
      </div>
    </div>
  );
}

// Nút "Liên kết giá" ở đầu mục lớn không có công tác con (VD Chi phí Prelim, BPTC): Trực tiếp phí và Báo giá CĐT
// mỗi bên chọn tính theo định mức/nhập đơn giá (mặc định), theo % của 1 đầu mục, hoặc lấy từ sheet tự do.
export default function BoqLinkButton({
  projectId,
  boqItemId,
  description,
  current,
  headings,
  sheets,
}: {
  projectId: string;
  boqItemId: string;
  description: string;
  current: BoqLinkInput;
  headings: { id: string; label: string }[];
  sheets: Sheet[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [direct, setDirect] = useState<Side>({
    mode: current.directMode ?? "",
    pct: current.directPct != null ? String(current.directPct).replace(".", ",") : "",
    baseId: current.directBaseId ?? "",
    link: current.directLink ?? "",
  });
  const [quoted, setQuoted] = useState<Side>({
    mode: current.quotedMode ?? "",
    pct: current.quotedPct != null ? String(current.quotedPct).replace(".", ",") : "",
    baseId: current.quotedBaseId ?? "",
    link: current.quotedLink ?? "",
  });

  const linked = !!current.directMode || !!current.quotedMode;
  const num = (s: string) => Number(s.replace(",", "."));

  function check(side: Side, label: string): string | null {
    if (side.mode === "PCT" && (!side.baseId || !side.pct.trim() || !Number.isFinite(num(side.pct)))) return `${label}: chọn đầu mục cơ sở và nhập tỷ lệ %`;
    if (side.mode === "LINK" && !side.link) return `${label}: chọn sheet và nguồn liên kết`;
    return null;
  }

  function save() {
    const err = check(direct, "Trực tiếp phí") ?? check(quoted, "Giá báo CĐT");
    if (err) return setError(err);
    setError("");
    start(async () => {
      try {
        await setBoqLinkAction(projectId, boqItemId, {
          directMode: direct.mode || null,
          directPct: direct.mode === "PCT" ? num(direct.pct) : null,
          directBaseId: direct.mode === "PCT" ? direct.baseId : null,
          directLink: direct.mode === "LINK" ? direct.link : null,
          quotedMode: quoted.mode || null,
          quotedPct: quoted.mode === "PCT" ? num(quoted.pct) : null,
          quotedBaseId: quoted.mode === "PCT" ? quoted.baseId : null,
          quotedLink: quoted.mode === "LINK" ? quoted.link : null,
        });
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không lưu được");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        title="Liên kết giá: tính Trực tiếp phí / Giá báo CĐT theo % của đầu mục khác, hoặc lấy từ sheet tự do"
        onClick={() => setOpen(true)}
        className={`rounded px-1 text-[13px] leading-5 ${linked ? "bg-violet-100 text-violet-700 hover:bg-violet-200" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"}`}
      >
        🔗
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
            <div className="my-8 w-full max-w-lg rounded-lg bg-white p-5 text-left text-sm font-normal text-slate-800 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Liên kết giá</h2>
                  <div className="mt-0.5 line-clamp-2 text-xs text-slate-500">{description}</div>
                </div>
                <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                  ✕
                </button>
              </div>

              <SideEditor
                title="1. Trực tiếp phí"
                defaultLabel="Tính theo định mức / thầu phụ (mặc định)"
                baseHint="Cơ sở = tổng Trực tiếp phí các công tác thuộc đầu mục (không tính các dòng cũng đang theo %)."
                side={direct}
                setSide={setDirect}
                headings={headings}
                sheets={sheets}
                projectId={projectId}
              />
              <SideEditor
                title="2. Giá báo Chủ Đầu Tư"
                defaultLabel="Nhập đơn giá (mặc định)"
                baseHint="Cơ sở = tổng Báo giá CĐT các công tác thuộc đầu mục (không tính các dòng cũng đang theo %)."
                side={quoted}
                setSide={setQuoted}
                headings={headings}
                sheets={sheets}
                projectId={projectId}
              />

              {error && <div className="mt-3 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</div>}
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
                  Huỷ
                </button>
                <button type="button" disabled={pending} onClick={save} className="rounded-md bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-800 disabled:opacity-50">
                  {pending ? "Đang lưu..." : "Lưu"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
