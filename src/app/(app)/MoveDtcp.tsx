"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveDtcpAction, type MoveItem } from "@/lib/dtcp-transfer-actions";

// QUẢN TRỊ: điều chuyển DT-CP (1 gói thầu) hoặc cả dự án sang dự án / khu vực khác. Dự án cũ hết DT-CP thì tự mất khỏi menu.
export default function MoveDtcp({
  items,
  fromName,
  fromArea,
  names,
  label,
  title,
  merge,
}: {
  items: MoveItem[];
  fromName: string;
  fromArea: string;
  names: { area: string; name: string }[]; // mọi dự án đang có (gợi ý chọn dự án đích)
  label: string;
  title: string;
  merge?: boolean; // gộp cả dự án
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [name, setName] = useState(fromName);
  const [area, setArea] = useState(fromArea);
  const [pending, start] = useTransition();
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setPos(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pos]);

  const same = name.trim().replace(/\s+/g, " ").toLowerCase() === fromName.trim().replace(/\s+/g, " ").toLowerCase() && area === fromArea;
  const targets = [...new Map(names.filter((n) => n.area === area).map((n) => [n.name, n])).values()];

  return (
    <div ref={root} className="shrink-0">
      <button
        type="button"
        title={title}
        onClick={(e) => {
          if (pos) return setPos(null);
          const r = e.currentTarget.getBoundingClientRect();
          setName(fromName);
          setArea(fromArea);
          setPos({ left: Math.min(r.right + 6, window.innerWidth - 400), top: Math.min(r.top - 4, window.innerHeight - 260) });
        }}
        className="rounded px-1 text-[11px] text-violet-500 hover:bg-violet-100 hover:text-violet-800"
      >
        {label}
      </button>
      {pos && (
        <div className="fixed z-50 w-96 rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-xl" style={{ left: Math.max(4, pos.left), top: pos.top }}>
          <p className="font-semibold text-slate-800">{merge ? `Gộp cả dự án (${items.length} DT-CP) sang dự án khác` : "Điều chuyển DT-CP sang dự án khác"}</p>
          <p className="mt-0.5 text-slate-500">
            Từ: <b>{fromName}</b> {fromArea ? `(Khu vực ${fromArea})` : "(chưa chọn khu vực)"}
          </p>
          <label className="mt-2 block">
            <span className="text-slate-600">Khu vực đích</span>
            <select className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1" value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="">— Chưa chọn —</option>
              {["1", "2", "3", "4", "5"].map((k) => (
                <option key={k} value={k}>
                  Khu vực {k}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-2 block">
            <span className="text-slate-600">Dự án đích (chọn dự án có sẵn hoặc gõ tên mới)</span>
            <input className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1" list={`mv-names-${fromName}-${fromArea}`} value={name} onChange={(e) => setName(e.target.value)} />
            <datalist id={`mv-names-${fromName}-${fromArea}`}>
              {targets.map((n) => (
                <option key={n.name} value={n.name} />
              ))}
            </datalist>
          </label>
          <p className="mt-2 text-slate-500">Điều chuyển hết DT-CP khỏi dự án cũ thì tên dự án cũ tự mất khỏi menu (không còn dự án trùng).</p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={pending || same || !name.trim()}
              className="rounded bg-violet-700 px-3 py-1 font-medium text-white hover:bg-violet-800 disabled:opacity-50"
              onClick={() => {
                if (!window.confirm(`${merge ? `Gộp ${items.length} DT-CP` : "Điều chuyển DT-CP"} sang dự án "${name.trim()}"${area ? ` (Khu vực ${area})` : ""}?`)) return;
                start(async () => {
                  const r = await moveDtcpAction(items, { name, area });
                  if (!r.ok) return window.alert(r.error);
                  setPos(null);
                  router.refresh();
                });
              }}
            >
              {pending ? "Đang chuyển..." : "Điều chuyển"}
            </button>
            <button type="button" disabled={pending} className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50" onClick={() => setPos(null)}>
              Huỷ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
