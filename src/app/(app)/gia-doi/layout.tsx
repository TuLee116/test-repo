import { prisma } from "@/lib/prisma";
import { asSub, canSeePrice, canSeeSub, contractAreaWhere, getPriceUser, PRICE_ROLES } from "@/lib/gia-doi";
import { priceTaskWhere, subTaskCounts } from "@/lib/my-tasks";
import { SubNav } from "./SubNav";
import FindBar from "./FindBar";
import { Suspense } from "react";

// Phân hệ Đệ trình giá đội (nội bộ phòng ĐT-KS-TT)
export default async function GiaDoiLayout({ children }: { children: React.ReactNode }) {
  const u = await getPriceUser();
  if (!u) return null;
  const seePrice = canSeePrice(u);
  const seeSub = canSeeSub(u);
  if (!seePrice && !seeSub)
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        Bạn chưa được phân quyền Trình giá tổ đội / thầu phụ. Nhờ quản trị vào <b>Quản trị → Người dùng → Sửa quyền</b> để tick các việc được làm.
      </div>
    );
  // số việc đang chờ mình (theo vai trò được gán, giống chuông "Việc của tôi")
  const { qs: isQs, myCats } = priceTaskWhere(u);
  const subCount = [...(await subTaskCounts(asSub(u))).values()].reduce((s, n) => s + n, 0);
  const [qs, tp] = await Promise.all([
    isQs ? prisma.priceSubmission.count({ where: { AND: [{ createdById: u.id }, { OR: [{ status: "DRAFT" }, { status: "SUBMITTED" }, { status: { in: ["APPROVED", "REJECTED"] }, mailSentAt: null }, { status: "APPROVED", dtcpLater: true, contractId: null }] }, contractAreaWhere(u)] } }) : 0,
    myCats.length ? prisma.priceSubmission.count({ where: { status: "SUBMITTED", category: { in: myCats }, ...contractAreaWhere(u) } }) : 0,
  ]);
  const roleNames = [
    ...PRICE_ROLES.filter((r) => u.roles.has(r.value)).map((r) => `Tổ đội: ${r.short}`),
    ...PRICE_ROLES.filter((r) => u.sub.has(r.value)).map((r) => `Thầu phụ: ${r.short}`),
    ...(u.areas ? [`KV ${u.areas.join(", ")}`] : []),
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-xl font-semibold text-slate-900">Triển Khai Kiểm Soát DT-CP Giai Đoạn Thi Công</h1>
        <p className="text-xs text-slate-500">
          Vai trò của bạn: <b>{[...(u.isAdmin ? ["Quản trị"] : []), ...roleNames].join(", ")}</b>
        </p>
      </div>
      <SubNav
        tabs={[
          ...(seePrice ? [{ href: "/gia-doi", label: "Trình giá đội", count: qs + tp, exact: true }] : []),
          ...(seeSub ? [{ href: "/gia-doi/thau-phu", label: "Trình giá thầu phụ", count: subCount }] : []),
          { href: "/gia-doi/quan-ly", label: "Quản lý hợp đồng" },
          { href: "/gia-doi/hop-dong", label: "Hợp Đồng & DT-CP" },
          ...(seePrice ? [{ href: "/gia-doi/kiem-tra-bill", label: "Kiểm tra Bill đội" }] : []),
          ...(u.isAdmin ? [{ href: "/gia-doi/phan-quyen", label: "Phân quyền" }] : []),
        ]}
      />
      <Suspense>
        <FindBar scopeId="gd-find-scope" />
      </Suspense>
      <div id="gd-find-scope">{children}</div>
    </div>
  );
}
