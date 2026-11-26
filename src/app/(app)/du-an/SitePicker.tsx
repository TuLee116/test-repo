"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { proposeSiteAction } from "@/lib/project-site-actions";
import { clusterLabel, searchSites, siteLabel, type SiteOpt } from "@/lib/project-site-calc";

// Ô CHỌN DỰ ÁN từ Danh mục dự án (không gõ tự do): gõ mã / vài chữ trong tên (không dấu) → chọn.
// Không có trong danh mục → "＋ Đề nghị dự án mới": phần mềm hỏi "Có phải là …?" với dự án gần giống trước khi tạo.
export default function SitePicker({
  sites,
  value,
  onChange,
  area = "",
  disabled = false,
  allowPropose = true,
  invalid = false,
  className = "",
  placeholder = "Gõ mã hoặc tên dự án để chọn trong Danh mục dự án",
  title,
}: {
  sites: SiteOpt[];
  value: string | null | undefined;
  onChange: (site: SiteOpt | null) => void;
  area?: string;
  disabled?: boolean;
  allowPropose?: boolean;
  invalid?: boolean;
  className?: string;
  placeholder?: string;
  title?: string;
}) {
  const [added, setAdded] = useState<SiteOpt[]>([]);
  const all = useMemo(() => [...sites, ...added.filter((a) => !sites.some((s) => s.id === a.id))], [sites, added]);
  const cur = all.find((s) => s.id === value) ?? null;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [similar, setSimilar] = useState<SiteOpt[] | null>(null);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) {
        setOpen(false);
        setSimilar(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  // cùng khu vực lên trước; tối đa 60 dòng
  const list = useMemo(() => {
    const found = searchSites(q, all);
    return [...found.filter((s) => !area || s.area === area), ...found.filter((s) => area && s.area !== area)].slice(0, 60);
  }, [q, all, area]);

  const pick = (s: SiteOpt | null) => {
    onChange(s);
    setOpen(false);
    setQ("");
    setSimilar(null);
    setErr("");
  };
  const propose = (force: boolean) =>
    start(async () => {
      setErr("");
      const r = await proposeSiteAction(q, area, force);
      if (!r.ok) return setErr(r.error);
      if (r.similar?.length) return setSimilar(r.similar);
      if (r.site) {
        setAdded((a) => [...a, r.site!]);
        pick(r.site);
      }
    });

  const badge = (s: SiteOpt) => (s.status === "PENDING" ? <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-normal text-amber-800">chờ xác nhận</span> : null);

  return (
    <div ref={box} className={`relative ${className}`} title={title}>
      {open ? (
        <input
          autoFocus
          className="w-full border-b border-sky-500 bg-white px-1 font-[inherit] text-[inherit] outline-none"
          value={q}
          placeholder={cur ? siteLabel(cur) : placeholder}
          onChange={(e) => {
            setQ(e.target.value);
            setHi(0);
            setSimilar(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHi((h) => Math.min(h + 1, list.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (list[hi]) pick(list[hi]);
            } else if (e.key === "Escape") {
              setOpen(false);
              setSimilar(null);
            }
          }}
        />
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className={`block w-full truncate border-b border-dotted border-slate-500 px-1 text-left ${disabled ? "cursor-default" : "bg-sky-50/70 hover:bg-sky-100"} ${invalid && !cur ? "bg-red-100 ring-1 ring-red-400" : ""}`}
        >
          {cur ? (
            <>
              {cur.code && <span className="mr-1 rounded bg-slate-200 px-1 text-[11px] font-semibold text-slate-700">{cur.code}</span>}
              {cur.name}
              {cur.clusterName && <span className="ml-1 text-[11px] font-normal text-slate-400">· cụm {cur.clusterName}</span>}
              {badge(cur)}
            </>
          ) : (
            <span className="font-normal italic text-slate-400">{placeholder}</span>
          )}
        </button>
      )}
      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-80 min-w-[22rem] overflow-auto rounded-md border border-slate-300 bg-white text-[13px] font-normal shadow-lg">
          {similar ? (
            <div className="p-2">
              <p className="mb-1 font-semibold text-amber-800">Có phải là 1 trong các dự án này không?</p>
              {similar.map((s) => (
                <button key={s.id} type="button" onClick={() => pick(s)} className="block w-full rounded px-2 py-1 text-left hover:bg-sky-50">
                  ✔ {siteLabel(s)}
                  {s.area && <span className="ml-1 text-slate-400">· KV {s.area}</span>}
                  {badge(s)}
                </button>
              ))}
              <div className="mt-2 flex gap-2 border-t pt-2">
                <button type="button" disabled={pending} onClick={() => propose(true)} className="rounded bg-amber-600 px-2 py-1 text-white hover:bg-amber-700 disabled:opacity-50">
                  Không — “{q.trim()}” là dự án mới
                </button>
                <button type="button" onClick={() => setSimilar(null)} className="rounded border px-2 py-1 hover:bg-slate-50">
                  Quay lại
                </button>
              </div>
            </div>
          ) : (
            <>
              {list.map((s, i) => (
                <Fragment key={s.id}>
                  {/* tiêu đề CỤM DỰ ÁN (Khu vực → Cụm → Dự án) */}
                  {(i === 0 || list[i - 1].area !== s.area || (list[i - 1].cluster ?? "") !== (s.cluster ?? "")) && (
                    <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                      {s.area ? `KV ${s.area}` : "Chưa có khu vực"} › {s.cluster ? clusterLabel(s) : <span className="font-normal italic">không thuộc cụm</span>}
                    </div>
                  )}
                  <button
                    type="button"
                    onMouseEnter={() => setHi(i)}
                    onClick={() => pick(s)}
                    className={`block w-full py-1 pl-4 pr-2 text-left ${i === hi ? "bg-sky-100" : ""} ${s.id === value ? "font-semibold" : ""}`}
                  >
                    {s.code && <span className="mr-1 text-slate-500">{s.code}</span>}
                    {s.name}
                    {badge(s)}
                  </button>
                </Fragment>
              ))}
              {!list.length && <p className="px-2 py-1 italic text-slate-500">Không có dự án nào khớp “{q}”</p>}
              {cur && (
                <button type="button" onClick={() => pick(null)} className="block w-full border-t px-2 py-1 text-left text-slate-500 hover:bg-slate-50">
                  ✕ Bỏ chọn dự án
                </button>
              )}
              {allowPropose && q.trim().length >= 3 && (
                <button type="button" disabled={pending} onClick={() => propose(false)} className="block w-full border-t bg-amber-50 px-2 py-1.5 text-left text-amber-900 hover:bg-amber-100 disabled:opacity-50">
                  ＋ Không có trong danh mục — đề nghị dự án mới “{q.trim()}”
                </button>
              )}
              {allowPropose && q.trim().length < 3 && <p className="border-t px-2 py-1 text-[11px] text-slate-400">Không thấy dự án? Gõ tên đầy đủ để đề nghị dự án mới.</p>}
            </>
          )}
          {err && <p className="px-2 py-1 text-red-600">{err}</p>}
        </div>
      )}
    </div>
  );
}
