import Link from "next/link";
import { getSidebar } from "@/lib/data";

const ICON: Record<string, string> = { dtcp: "📊", vt: "🛒", qstt: "💰", qsdt: "📐", admin: "⚙️" };

export default function Sidebar() {
  const { groups } = getSidebar();
  return (
    <nav className="space-y-1 text-sm">
      {groups.map((g) => (
        <details key={g.key} open={g.key === "dtcp"} className="group rounded">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded px-2 py-1.5 font-medium text-slate-800 hover:bg-slate-100">
            <span>{ICON[g.key] ?? "•"}</span>
            <span className="flex-1">{g.label}</span>
            <span className="text-xs text-slate-400 group-open:rotate-90">▶</span>
          </summary>
          <div className="ml-3 border-l border-slate-200 pl-2">
            {"tree" in g ? (
              <>
                {g.tree.map((a) => (
                  <details key={a.area}>
                    <summary className="cursor-pointer list-none rounded px-2 py-1 text-slate-700 hover:bg-slate-100">
                      Khu vực {a.area}
                      <span className="text-xs text-slate-400">
                        {" "}· {a.projects.length} dự án · {a.projects.reduce((n, p) => n + p.packages.length, 0)} HĐ
                      </span>
                    </summary>
                    <div className="ml-2">
                      {a.projects.map((p) => (
                        <details key={p.name}>
                          <summary className="cursor-pointer list-none truncate rounded px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100">{p.name}</summary>
                          <ul className="ml-2">
                            {p.packages.map((k) => (
                              <li key={k.key}>
                                <Link href={k.href} className="block rounded px-2 py-1 text-xs text-slate-600 hover:bg-blue-50 hover:text-blue-800" title={k.sub}>
                                  {k.label}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ))}
                    </div>
                  </details>
                ))}
                {g.footer.map((f) => (
                  <Link key={f.href} href={f.href} className="block rounded px-2 py-1 text-xs text-blue-700 hover:bg-blue-50">
                    {f.label}
                  </Link>
                ))}
              </>
            ) : (
              <ul>
                {g.links.map((l) => (
                  <li key={l.href + l.label}>
                    <Link href={l.href} className="flex items-center gap-1 rounded px-2 py-1 text-slate-600 hover:bg-blue-50 hover:text-blue-800" title={l.hint}>
                      <span className="flex-1">{l.label}</span>
                      {!!l.count && <span className="rounded-full bg-rose-500 px-1.5 text-[10px] text-white">{l.count}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      ))}
    </nav>
  );
}
