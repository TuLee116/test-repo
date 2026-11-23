import Link from "next/link";

const TABS = [
  { href: "/gia-doi", label: "Hồ sơ giá đội" },
  { href: "/gia-doi/thau-phu", label: "Trình giá thầu phụ" },
  { href: "/gia-doi/hop-dong", label: "Hợp Đồng & DT-CP" },
];

export default function GiaDoiNav({ active }: { active: string }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200 text-sm">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`-mb-px border-b-2 px-3 py-1.5 ${active === t.href ? "border-blue-700 font-medium text-blue-800" : "border-transparent text-slate-600 hover:text-slate-900"}`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
