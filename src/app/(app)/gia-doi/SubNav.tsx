"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SubNav({ tabs }: { tabs: { href: string; label: string; count?: number; exact?: boolean }[] }) {
  const path = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b border-slate-200">
      {tabs.map((t) => {
        const active = t.exact ? path === t.href || (path.startsWith(`${t.href}/`) && !tabs.some((x) => x !== t && path.startsWith(x.href))) : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`-mb-px rounded-t-md border px-3 py-2 text-sm ${active ? "border-slate-200 border-b-white bg-white font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {t.label}
            {!!t.count && <span className="ml-1.5 rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white">{t.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
