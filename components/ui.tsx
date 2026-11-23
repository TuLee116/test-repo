import Link from "next/link";
import { STATUS } from "@/lib/format";

export function PageHeader({ title, sub, back }: { title: string; sub?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-4">
      {back && (
        <Link href={back.href} className="text-xs text-blue-700 hover:underline">
          ← {back.label}
        </Link>
      )}
      <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
      {sub && <div className="mt-0.5 text-sm text-slate-500">{sub}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-slate-200 bg-white p-4 ${className}`}>{children}</div>;
}

export function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-500 tabular-nums">{sub}</div>}
    </Card>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: "bg-slate-100 text-slate-600 ring-slate-200" };
  return <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs ring-1 ${s.tone}`}>{s.label}</span>;
}

/** Scrollable table shell with sticky header. */
export function Table({ head, children }: { head: React.ReactNode[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-slate-100 text-xs text-slate-600">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="border-b border-slate-200 px-2 py-2 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:border-b [&_td]:border-slate-100 [&_td]:px-2 [&_td]:py-1.5 [&_tr:hover]:bg-slate-50">{children}</tbody>
      </table>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</div>;
}

/** GET form for filters: keeps state in the URL. */
export function FilterBar({ children }: { children: React.ReactNode }) {
  return (
    <form className="mb-3 flex flex-wrap items-end gap-2 text-sm [&_input]:rounded [&_input]:border [&_input]:border-slate-300 [&_input]:px-2 [&_input]:py-1 [&_label]:flex [&_label]:flex-col [&_label]:text-xs [&_label]:text-slate-500 [&_select]:rounded [&_select]:border [&_select]:border-slate-300 [&_select]:px-2 [&_select]:py-1">
      {children}
      <button className="rounded bg-blue-700 px-3 py-1 text-white hover:bg-blue-800">Lọc</button>
    </form>
  );
}
