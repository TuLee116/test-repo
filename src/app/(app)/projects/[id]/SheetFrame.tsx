"use client";

import { usePathname } from "next/navigation";
import { useMemo, useSyncExternalStore } from "react";
import { useTaskWorkspace } from "../../TaskWorkspace";

// Khung nhìn của từng sheet: mỗi người dùng chọn độ rộng riêng cho từng sheet (lưu trên trình duyệt),
// để sheet nhiều cột thì rộng, sheet ít cột không bị kéo giãn quá mức.
const KEY = "dtcp-sheet-width-v1";
type Width = number | "full";

const OPTIONS: { value: string; label: string }[] = [
  { value: "1000", label: "Hẹp (1000)" },
  { value: "1200", label: "Vừa (1200)" },
  { value: "1400", label: "1400" },
  { value: "1600", label: "Rộng (1600)" },
  { value: "1800", label: "1800" },
  { value: "full", label: "Toàn màn hình" },
];

const DEFAULTS: Record<string, Width> = {
  dtcp: 1400,
  boq: 1800,
  "chi-tiet": "full",
  "vat-tu": 1600,
  "nhan-cong": 1600,
  "thiet-bi": 1600,
  "thau-phu": 1800,
  info: 1000,
};

// Đọc localStorage qua useSyncExternalStore (an toàn khi render trên server)
const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function getSnapshot(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}
const getServerSnapshot = () => "";
const noopSubscribe = () => () => {};

function sheetKey(pathname: string, projectId: string): string {
  const rest = pathname.replace(`/projects/${projectId}`, "").replace(/^\/+|\/+$/g, "");
  if (rest.startsWith("s/")) return rest; // sheet bổ sung: mỗi sheet 1 khóa riêng
  return rest.split("/")[0] || "dtcp";
}

export default function SheetFrame({ projectId, children }: { projectId: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const inWs = useTaskWorkspace() !== null; // cửa sổ làm việc toàn màn hình: mặc định dùng hết bề ngang
  const key = sheetKey(pathname, projectId);
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const ready = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const saved = useMemo<Record<string, Width>>(() => {
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, [raw]);

  const width: Width = saved[key] ?? (inWs ? "full" : DEFAULTS[key]) ?? "full";

  function choose(v: string) {
    const next = { ...saved, [key]: v === "full" ? "full" : Number(v) } as Record<string, Width>;
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
    listeners.forEach((l) => l());
  }

  return (
    <div style={{ visibility: ready ? "visible" : "hidden" }}>
      <div className="mb-1 flex items-center justify-end gap-2 text-xs text-slate-500">
        <label htmlFor="sheet-width">Độ rộng khung nhìn của sheet này:</label>
        <select
          id="sheet-width"
          value={String(width)}
          onChange={(e) => choose(e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
        >
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="mx-auto w-full" style={{ maxWidth: width === "full" ? "none" : width }}>
        {children}
      </div>
    </div>
  );
}
