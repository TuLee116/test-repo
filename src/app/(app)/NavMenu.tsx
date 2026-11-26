"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import PackageActions from "./projects/PackageActions";
import MoveDtcp from "./MoveDtcp";
import type { MoveItem } from "@/lib/dtcp-transfer-actions";

// MENU DỌC BÊN TRÁI theo CỤM CÔNG VIỆC / BỘ PHẬN: các cụm xếp từ trên xuống, bấm vào cụm → sổ xuống các mục con.
// Cụm DT-CP: cây Khu vực → Dự án → Hợp đồng (gói thầu = 1 DT-CP; gồm cả hợp đồng cũ nhập từ Excel).
export type NavLink = { href: string; label: string; count?: number; soon?: boolean; hint?: string };
export type NavPackage = { key: string; href: string | null; label: string; sub: string; projectId?: string; projectName?: string; excel?: boolean; excelId?: string };
export type NavTree = { area: string; projects: { name: string; packages: NavPackage[] }[] }[];
export type NavGroup = { key: string; label: string; links?: NavLink[]; tree?: NavTree; footer?: NavLink[] };

const KEY = "kkt-nav-open";

// màu + biểu tượng từng cụm (chuỗi class viết đủ để Tailwind giữ lại)
const THEME: Record<string, { icon: string; on: string; off: string; bar: string; sub: string; dot: string }> = {
  dtcp: { icon: "📊", on: "bg-gradient-to-r from-sky-600 to-blue-700 text-white", off: "text-sky-900 hover:bg-sky-50", bar: "border-sky-300", sub: "bg-sky-50/60", dot: "bg-sky-500" },
  vt: { icon: "🛒", on: "bg-gradient-to-r from-emerald-600 to-teal-700 text-white", off: "text-emerald-900 hover:bg-emerald-50", bar: "border-emerald-300", sub: "bg-emerald-50/60", dot: "bg-emerald-500" },
  qstt: { icon: "💰", on: "bg-gradient-to-r from-amber-500 to-orange-600 text-white", off: "text-amber-900 hover:bg-amber-50", bar: "border-amber-300", sub: "bg-amber-50/60", dot: "bg-amber-500" },
  qsdt: { icon: "📐", on: "bg-gradient-to-r from-violet-600 to-purple-700 text-white", off: "text-violet-900 hover:bg-violet-50", bar: "border-violet-300", sub: "bg-violet-50/60", dot: "bg-violet-500" },
  admin: { icon: "⚙️", on: "bg-gradient-to-r from-slate-600 to-slate-800 text-white", off: "text-slate-800 hover:bg-slate-100", bar: "border-slate-300", sub: "bg-slate-50", dot: "bg-slate-500" },
};
const DEF = THEME.admin;

export default function NavMenu({ groups, slots = {}, admin = false }: { groups: NavGroup[]; slots?: Record<string, React.ReactNode>; admin?: boolean }) {
  const path = usePathname();
  const base = (h: string) => h.split("?")[0];
  const isActive = (g: NavGroup) =>
    [...(g.links ?? []), ...(g.footer ?? [])].some((l) => l.href && (path === base(l.href) || path.startsWith(`${base(l.href)}/`))) ||
    (!!g.tree && (path.startsWith("/projects") || g.tree.some((a) => a.projects.some((p) => p.packages.some((x) => x.href && path.startsWith(x.href))))));
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups.filter(isActive).map((g) => g.key)));

  // nhớ cụm đang mở (theo trình duyệt) — đọc sau khi hiện trang để không lệch giữa server / client
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(KEY) || "[]") as string[];
        if (saved.length) setOpen((o) => new Set([...o, ...saved]));
      } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const toggle = (k: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      try {
        localStorage.setItem(KEY, JSON.stringify([...n]));
      } catch {}
      return n;
    });

  const total = (g: NavGroup) => (g.links ?? []).reduce((s, l) => s + (l.count ?? 0), 0);
  const link = (l: NavLink, dot = DEF.dot) =>
    l.soon ? (
      <span key={l.label} className="block py-1.5 pl-6 pr-2 text-[13px] text-slate-400">
        {l.label} <span className="text-[11px]">(sắp có)</span>
      </span>
    ) : (
      <Link
        key={l.href + l.label}
        href={l.href}
        className={`flex items-center gap-2 rounded py-1.5 pl-3 pr-2 text-[13px] hover:bg-white ${path === base(l.href) && !l.href.includes("?") ? "bg-white font-semibold text-slate-900 shadow-sm" : "text-slate-700"}`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="flex-1 leading-tight">
          {l.label}
          {l.hint && <span className="block text-[11px] text-slate-400">{l.hint}</span>}
        </span>
        {!!l.count && <span className="rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white">{l.count}</span>}
      </Link>
    );

  return (
    <nav className="space-y-1 text-sm">
      {groups.map((g) => {
        const n = total(g);
        const isOpen = open.has(g.key);
        const th = THEME[g.key] ?? DEF;
        return (
          <div key={g.key}>
            <button
              type="button"
              onClick={() => toggle(g.key)}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[15px] font-semibold shadow-sm ${isOpen ? th.on : `bg-white ring-1 ring-slate-200 ${th.off}`}`}
            >
              <span className="text-base">{th.icon}</span>
              <span className="flex-1">{g.label}</span>
              <span className={`text-[10px] opacity-70 transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>
              {n > 0 && <span className="rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white">{n}</span>}
            </button>
            {isOpen && (
              <div className={`mt-1 mb-2 ml-2 rounded-r-md border-l-4 py-1 pr-1 ${th.bar} ${th.sub}`}>
                {slots[g.key] && <div className="px-2 pb-1.5 pt-1">{slots[g.key]}</div>}
                {g.links?.map((l) => link(l, th.dot))}
                {g.tree && (
                  <div className="pl-2">
                    {g.tree.length === 0 && <p className="px-2 py-2 text-[13px] text-slate-400">Chưa có dự án nào.</p>}
                    {g.tree.map((a) => (
                      <details key={a.area || "none"} className="mb-1">
                        <summary className="cursor-pointer rounded bg-gradient-to-r from-sky-100 to-blue-100 px-2 py-1 text-xs font-bold text-sky-900">
                          {a.area ? `Khu vực ${a.area}` : "Chưa chọn khu vực"}
                          <span className="ml-1 font-normal text-slate-500">
                            · {a.projects.length} dự án · {a.projects.reduce((s, p) => s + p.packages.length, 0)} HĐ
                          </span>
                        </summary>
                        {a.projects.map((p) => (
                          <details key={p.name} className="mt-0.5">
                            <summary className="cursor-pointer rounded px-2 py-1 text-[13px] font-semibold leading-tight text-slate-900 hover:bg-slate-100">{p.name}</summary>
                            {admin && (
                              <div className="ml-3 pl-1">
                                <MoveDtcp
                                  merge
                                  label="⇄ Gộp cả dự án sang dự án khác"
                                  title="Quản trị: điều chuyển toàn bộ DT-CP của dự án này sang dự án khác (tên dự án này tự mất)"
                                  items={p.packages.flatMap((x): MoveItem[] => (x.projectId ? [{ kind: "project", id: x.projectId }] : x.excelId ? [{ kind: "excel", id: x.excelId }] : []))}
                                  fromName={p.name}
                                  fromArea={a.area}
                                  names={g.tree!.flatMap((t) => t.projects.map((q) => ({ area: t.area, name: q.name })))}
                                />
                              </div>
                            )}
                            <ul className="ml-3 border-l border-slate-200 pl-1">
                              {p.packages.map((x) => {
                                const here = !!x.href && path.startsWith(x.href);
                                return (
                                  <li key={x.key} className={`flex items-start gap-1 rounded px-1 py-1 ${here ? "bg-sky-100" : "hover:bg-slate-100"}`}>
                                    {x.href ? (
                                      <Link href={x.href} className="min-w-0 flex-1 leading-tight">
                                        <span className={`block text-[13px] ${here ? "font-medium text-sky-900" : "text-slate-800"}`}>{x.label}</span>
                                        <span className={`block text-[11px] ${x.excel ? "text-violet-700" : "text-slate-500"}`}>{x.sub}</span>
                                      </Link>
                                    ) : (
                                      <span className="min-w-0 flex-1 leading-tight">
                                        <span className="block text-[13px] text-slate-500">{x.label}</span>
                                        <span className="block text-[11px] text-violet-700">{x.sub}</span>
                                      </span>
                                    )}
                                    {admin && (x.projectId || x.excelId) && (
                                      <MoveDtcp
                                        label="⇄"
                                        title="Quản trị: điều chuyển DT-CP này sang dự án khác"
                                        items={[x.projectId ? { kind: "project" as const, id: x.projectId } : { kind: "excel" as const, id: x.excelId! }]}
                                        fromName={p.name}
                                        fromArea={a.area}
                                        names={g.tree!.flatMap((t) => t.projects.map((q) => ({ area: t.area, name: q.name })))}
                                      />
                                    )}
                                    {x.projectId && <PackageActions projectId={x.projectId} projectName={x.projectName ?? ""} />}
                                  </li>
                                );
                              })}
                            </ul>
                          </details>
                        ))}
                      </details>
                    ))}
                  </div>
                )}
                {g.footer?.length ? <div className="mt-1 border-t border-slate-200 pt-1">{g.footer.map((l) => link(l, th.dot))}</div> : null}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
