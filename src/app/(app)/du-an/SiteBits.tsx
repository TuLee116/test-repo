import Link from "next/link";

// Nhãn MÃ DỰ ÁN trên danh sách hồ sơ: đã gắn → mã (xám); dự án chờ xác nhận → vàng; chưa gắn → đỏ "chưa gắn mã dự án"
export type SiteLite = { code: string; name: string; status: string } | null | undefined;

export function SiteTag({ site, className = "" }: { site: SiteLite; className?: string }) {
  if (!site) return <span className={`ml-1.5 inline-block rounded bg-red-100 px-1.5 py-px align-middle text-[11px] font-semibold text-red-700 ${className}`}>chưa gắn mã dự án</span>;
  return (
    <span className={`ml-1.5 inline-block rounded px-1.5 py-px align-middle text-[11px] font-semibold ${site.status === "PENDING" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700"} ${className}`} title={site.status === "PENDING" ? "Dự án mới đề nghị, chờ quản trị / QSTT xác nhận" : site.name}>
      {site.code || "dự án chưa có mã"}
      {site.status === "PENDING" && " · chờ xác nhận"}
    </span>
  );
}

// Nhãn MÃ HỢP ĐỒNG theo BẢNG TT DỰ ÁN (VD KV4-SB-02.04) — tìm theo số HĐ; không có trong bảng thì không hiện
export function ContractCode({ code, className = "" }: { code: string | null | undefined; className?: string }) {
  if (!code) return null;
  return (
    <span className={`ml-1.5 inline-block rounded bg-violet-100 px-1.5 py-px align-middle font-mono text-[11px] font-semibold text-violet-800 ${className}`} title="Mã hợp đồng theo BẢNG TT DỰ ÁN">
      {code}
    </span>
  );
}

// Thanh lọc "Chỉ hồ sơ chưa gắn mã dự án" đặt trên cây Khu vực → Dự án → Hợp đồng
export function NoSiteFilter({ href, on, total, approved, manage, noun = "hồ sơ", hint }: { href: string; on: boolean; total: number; approved: number; manage: boolean; noun?: string; hint?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2.5 text-sm ${total ? "border-red-200 bg-red-50/60" : "border-emerald-200 bg-emerald-50/60"}`}>
      <span className="font-medium text-slate-800">Mã dự án:</span>
      {total ? (
        <span className="text-red-800">
          <b>{total}</b> {noun} chưa gắn mã dự án{approved > 0 && <> (trong đó <b>{approved}</b> {noun} đã duyệt)</>}
        </span>
      ) : (
        <span className="text-emerald-800">✓ Mọi {noun} đều đã gắn mã dự án</span>
      )}
      {(total > 0 || on) && (
        <Link href={on ? href : `${href}?nosite=1`} className={`rounded-md px-3 py-1 text-xs font-medium ${on ? "bg-red-700 text-white hover:bg-red-800" : "border border-red-300 bg-white text-red-800 hover:bg-red-100"}`}>
          {on ? `✕ Bỏ lọc — xem tất cả ${noun}` : `Chỉ hiện ${noun} chưa gắn mã`}
        </Link>
      )}
      {manage && total > 0 && (
        <Link href="/du-an" className="text-xs text-sky-700 hover:underline">
          Gắn mã ở trang Danh mục dự án →
        </Link>
      )}
      <span className="w-full text-xs text-slate-500">{hint ?? "Hồ sơ chưa gắn mã: mở hồ sơ chọn DỰ ÁN (khi còn sửa được), hoặc gắn theo tên ở trang Danh mục dự án (cả hồ sơ đã duyệt)."}</span>
    </div>
  );
}
