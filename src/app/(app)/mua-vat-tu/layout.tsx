import { getProcUser, PROC_ROLES } from "@/lib/proc";
import { getTaskCounts } from "@/lib/proc-tasks";
import { SubNav } from "./ClientBits";
import { NoAccess } from "./ui";

export default async function ProcLayout({ children }: { children: React.ReactNode }) {
  const u = await getProcUser();
  if (!u) return null;
  if (!u.isAdmin && u.roles.size === 0) return <NoAccess />;
  const t = await getTaskCounts(u);
  const tabs = [
    { href: "/mua-vat-tu", label: "Tổng quan" },
    { href: "/mua-vat-tu/de-nghi", label: "Đề nghị (BCH)", count: t.reqToApprove },
    { href: "/mua-vat-tu/don-hang", label: "Đơn hàng & So sánh giá", count: t.toOrder + t.poQuoting + t.poPending + t.poApproved },
    { href: "/mua-vat-tu/nhan-hang", label: "Nhận hàng", count: t.poOrdered },
    { href: "/mua-vat-tu/cong-no", label: "Công nợ NCC", count: t.paySent },
    { href: "/mua-vat-tu/nha-cung-cap", label: "Nhà cung cấp" },
    ...(u.isAdmin ? [{ href: "/mua-vat-tu/phan-quyen", label: "Phân quyền" }] : []),
  ];
  const roleNames = PROC_ROLES.filter((r) => u.roles.has(r.value)).map((r) => r.short);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2 print:hidden">
        <h1 className="text-xl font-semibold text-slate-900">Mua vật tư</h1>
        <p className="text-xs text-slate-500">
          Vai trò của bạn: <b>{[...(u.isAdmin ? ["Quản trị"] : []), ...roleNames].join(", ")}</b>
          {u.projectIds && ` · ${u.projectIds.length} dự án (BCH)`}
        </p>
      </div>
      <SubNav tabs={tabs} />
      {children}
    </div>
  );
}
