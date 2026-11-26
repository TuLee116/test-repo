import Link from "next/link";

// Ô tìm hồ sơ (GET ?q=) — dùng chung cho Trình giá đội và Trình giá thầu phụ
export default function SearchBox({ action, q, hint, count }: { action: string; q: string; hint: string; count?: number }) {
  return (
    <form action={action} method="get" className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
      <span className="text-sm font-medium text-slate-700">🔎 Tìm hồ sơ</span>
      <input
        name="q"
        defaultValue={q}
        placeholder={hint}
        className="min-w-[280px] flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
      />
      <button type="submit" className="rounded-md bg-sky-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-800">
        Tìm
      </button>
      {q && (
        <Link href={action} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
          ✕ Xoá tìm
        </Link>
      )}
      {q && count != null && <span className="text-sm text-slate-600">{count} hồ sơ khớp</span>}
    </form>
  );
}
