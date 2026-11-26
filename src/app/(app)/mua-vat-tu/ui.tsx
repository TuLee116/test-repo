import Link from "next/link";
import { fmtDateTime } from "@/lib/proc";

// Thành phần giao diện dùng chung (server) của phân hệ Mua vật tư

export function Badge({ map, status }: { map: Record<string, { label: string; cls: string }>; status: string }) {
  const s = map[status] ?? { label: status, cls: "bg-slate-100 text-slate-600" };
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

export function Section({ title, right, children }: { title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <h2 className="font-medium text-slate-900">{title}</h2>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-center text-sm text-slate-400">{children}</p>;
}

export function NoAccess() {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      Bạn chưa được phân quyền ở phân hệ Mua vật tư. Nhờ quản trị vào <b>Mua vật tư → Phân quyền</b> để gán vai trò (giám sát, CHT, cán bộ vật tư...).
    </div>
  );
}

export const th = "px-2 py-2 text-left text-xs font-medium text-slate-500";
export const td = "px-2 py-1.5 align-top";

export function LinkText({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-sky-700 hover:underline">
      {children}
    </Link>
  );
}

export function LogList({ logs }: { logs: { id: string; action: string; note: string; userName: string; createdAt: Date }[] }) {
  if (!logs.length) return <Empty>Chưa có thao tác</Empty>;
  return (
    <ol className="space-y-1.5 text-sm">
      {logs.map((l) => (
        <li key={l.id} className="flex gap-3">
          <span className="w-32 shrink-0 text-xs text-slate-400">{fmtDateTime(l.createdAt)}</span>
          <span>
            <b className="text-slate-800">{l.userName}</b> · {l.action}
            {l.note && <span className="text-slate-500"> — {l.note}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

// Khối chữ ký cuối chứng từ in
export function Signatures({ cols }: { cols: { title: string; name?: string }[] }) {
  return (
    <div className="mt-8 hidden grid-cols-4 gap-4 text-center text-sm print:grid" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
      {cols.map((c) => (
        <div key={c.title}>
          <p className="font-semibold">{c.title}</p>
          <p className="text-xs italic text-slate-500">(Ký, ghi rõ họ tên)</p>
          <p className="mt-16 font-medium">{c.name ?? ""}</p>
        </div>
      ))}
    </div>
  );
}
