"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import AddSheetModal from "./AddSheetModal";
import { useTaskWorkspace } from "../../TaskWorkspace";

const TABS = [
  { key: "", href: "", label: "DT-CP" },
  { key: "boq", href: "/boq", label: "BOQ" },
  { key: "chi-tiet", href: "/chi-tiet", label: "CHI TIẾT" },
  { key: "vat-tu", href: "/vat-tu", label: "TH Vật Tư" },
  { key: "nhan-cong", href: "/nhan-cong", label: "TH Nhân Công" },
  { key: "thiet-bi", href: "/thiet-bi", label: "TH Thiết Bị" },
  { key: "thau-phu", href: "/thau-phu", label: "TH Thầu Phụ" },
  { key: "info", href: "/info", label: "Thông tin dự án" },
];

// Thứ tự tab do từng người dùng tự sắp xếp (kéo thả), lưu ở trình duyệt theo từng dự án
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
};
const storageKey = (projectId: string) => `dtcp-tab-order:${projectId}`;

export default function TabNav({ projectId, sheets = [], extra }: { projectId: string; sheets?: { id: string; name: string; kind: string }[]; extra?: React.ReactNode }) {
  const inWs = useTaskWorkspace() !== null; // cửa sổ làm việc toàn màn hình: trang không cuộn nên nút nổi luôn hiện
  const pathname = usePathname();
  const base = `/projects/${projectId}`;
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  // nút nổi ở góc phải (đi theo khi cuộn trang): chuyển sheet nhanh mà không phải kéo ngược lên thanh tab
  const [scrolled, setScrolled] = useState(false);
  const [quick, setQuick] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 160);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(storageKey(projectId)) ?? "";
      } catch {
        return "";
      }
    },
    () => ""
  );

  const defaults = useMemo(
    () => [
      ...TABS.map((t) => ({ key: t.key, href: `${base}${t.href}`, label: t.label, custom: false })),
      ...sheets.map((s) => ({ key: `s/${s.id}`, href: `${base}/s/${s.id}`, label: s.name, custom: true })),
    ],
    [base, sheets]
  );

  // áp thứ tự đã lưu; tab chưa có trong thứ tự (sheet mới tạo) xếp cuối
  const ordered = useMemo(() => {
    let saved: string[] = [];
    try {
      saved = raw ? JSON.parse(raw) : [];
    } catch {}
    const byKey = new Map(defaults.map((d) => [d.key, d]));
    const out = saved.filter((k) => byKey.has(k)).map((k) => byKey.get(k)!);
    for (const d of defaults) if (!saved.includes(d.key)) out.push(d);
    return out;
  }, [raw, defaults]);

  function drop(targetKey: string) {
    if (!dragKey || dragKey === targetKey) return;
    const keys = ordered.map((t) => t.key).filter((k) => k !== dragKey);
    keys.splice(keys.indexOf(targetKey), 0, dragKey);
    try {
      localStorage.setItem(storageKey(projectId), JSON.stringify(keys));
    } catch {}
    listeners.forEach((l) => l());
  }

  return (
    <>
    <div className="flex items-center gap-1 overflow-x-auto rounded-t-lg border border-b-0 border-slate-200 bg-white px-2">
      {ordered.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.key}
            href={t.href}
            draggable
            title="Kéo để sắp xếp lại vị trí sheet"
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", t.key);
              setDragKey(t.key);
            }}
            onDragOver={(e) => {
              if (!dragKey) return;
              e.preventDefault();
              if (overKey !== t.key) setOverKey(t.key);
            }}
            onDragLeave={() => setOverKey((k) => (k === t.key ? null : k))}
            onDrop={(e) => {
              e.preventDefault();
              drop(t.key);
              setDragKey(null);
              setOverKey(null);
            }}
            onDragEnd={() => {
              setDragKey(null);
              setOverKey(null);
            }}
            className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${
              active ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"
            } ${t.custom ? "italic" : ""} ${dragKey === t.key ? "opacity-40" : ""} ${overKey === t.key && dragKey !== t.key ? "bg-blue-100" : ""}`}
          >
            {t.label}
          </Link>
        );
      })}
      <AddSheetModal projectId={projectId} />
      {extra && <div className="ml-auto shrink-0 py-1">{extra}</div>}
    </div>
    {(scrolled || quick || inWs) && (
      <div className={`fixed right-5 print:hidden ${inWs ? "bottom-24 z-[48]" : "bottom-5 z-40"}`}>
        {quick && (
          <div className="mb-2 max-h-[70vh] w-56 overflow-y-auto rounded-lg border border-slate-300 bg-white py-1 text-sm shadow-xl">
            <div className="px-3 py-1 text-[11px] font-semibold uppercase text-slate-400">Chuyển sheet</div>
            {ordered.map((t) => (
              <Link key={t.key} href={t.href} onClick={() => setQuick(false)} className={`block px-3 py-1.5 ${pathname === t.href ? "bg-slate-900 font-semibold text-white" : "text-slate-700 hover:bg-slate-100"} ${t.custom ? "italic" : ""}`}>
                {t.label}
              </Link>
            ))}
            <button type="button" onClick={() => { setQuick(false); if (inWs) document.querySelector(".task-ws .overflow-auto")?.scrollTo({ top: 0, behavior: "smooth" }); else window.scrollTo({ top: 0, behavior: "smooth" }); }} className="mt-1 block w-full border-t border-slate-200 px-3 py-1.5 text-left text-slate-600 hover:bg-slate-100">
              ↑ Lên đầu trang
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setQuick((q) => !q)}
          title="Chuyển sheet nhanh (không cần kéo lên đầu trang)"
          className="ml-auto flex h-[60px] w-[60px] items-center justify-center rounded-full border border-slate-300 bg-white text-lg text-slate-700 shadow-lg hover:bg-slate-100"
        >
          {quick ? "×" : <img src="/tmn-logo.png" alt="TMN" className="h-12 w-12 object-contain" />}
        </button>
      </div>
    )}
    </>
  );
}
