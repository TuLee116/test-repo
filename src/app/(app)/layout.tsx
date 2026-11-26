import Link from "next/link";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { areaWhere, getAccess } from "@/lib/access";
import { canSeePrice, canSeeSub, getPriceUser } from "@/lib/gia-doi";
import { canManageContracts } from "@/lib/hop-dong";
import { DTCP_STATUS } from "@/lib/dtcp-approval";
import { getMyTasks } from "@/lib/my-tasks";
import TaskBell from "./TaskBell";
import ChangePasswordButton from "./ChangePasswordButton";
import NavMenu, { type NavGroup, type NavTree } from "./NavMenu";
import { PACKAGE_TYPES, normalizePackageType } from "@/lib/package-types";
import StaleVersionGuard from "./StaleVersionGuard";
import { TaskDoneToast } from "./TaskWorkspace";
import CreateDtcpMenu from "./projects/CreateDtcpMenu";
import AiAssistant from "./AiAssistant";
import { aiEnabled } from "@/lib/ai-assistant";
import { canManageSites } from "@/lib/project-site";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  // Admin: báo có định mức mới do người dùng tự thêm cần kiểm tra mã
  const isAdmin = session?.user.role === "ADMIN";
  // menu chỉ hiện chương trình tài khoản được dùng (tick ở Người dùng → Sửa quyền)
  const access = await getAccess();
  const can = (c: "DTCP" | "PROC" | "PRICE") => !!access && (access.isAdmin || access.apps.has(c));
  const tasks = await getMyTasks();
  // Trợ lý AI: số phiếu yêu cầu chờ quản trị duyệt (chỉ quản trị) + phiếu của tôi vừa được xử lý mà chưa xem
  const [aiPending, unseenTickets] = await Promise.all([
    isAdmin ? prisma.aiTicket.count({ where: { status: "PENDING" } }) : Promise.resolve(0),
    session?.user.id ? prisma.aiTicket.count({ where: { userId: session.user.id, seenByUser: false } }) : Promise.resolve(0),
  ]);
  if (aiPending) tasks.push({ app: "Trợ lý AI", label: "Yêu cầu của người dùng chờ bạn duyệt", count: aiPending, href: "/admin/yeu-cau" });
  // trình giá: tổ đội / thầu phụ tick riêng
  const pu = can("PRICE") ? await getPriceUser() : null;
  const seePrice = !!pu && canSeePrice(pu);
  const seeSub = !!pu && canSeeSub(pu);
  // DANH MỤC DỰ ÁN: quản trị / QSTT xác nhận dự án người dùng đề nghị mới
  const siteMgr = isAdmin || canManageSites(pu);
  const sitePending = siteMgr ? await prisma.projectSite.count({ where: { status: "PENDING" } }) : 0;
  if (sitePending) tasks.push({ app: "Danh mục dự án", label: "Dự án mới người dùng đề nghị, chờ xác nhận / gộp", count: sitePending, href: "/du-an" });
  const normReviewer = !!access && (access.isAdmin || (access.apps.has("DTCP") && access.dtcp.has("NORM_REVIEW")));
  const pending = normReviewer ? await prisma.catalogChange.findMany({ where: { reviewed: false }, select: { userName: true, resourceIds: true } }) : [];
  const byUser = new Map<string, { n: number; r: number }>();
  for (const c of pending) {
    const cur = byUser.get(c.userName) ?? { n: 0, r: 0 };
    cur.n++;
    cur.r += c.resourceIds.split(",").filter(Boolean).length;
    byUser.set(c.userName, cur);
  }

  // ---- thanh menu theo cụm công việc (sổ dọc) ----
  const count = (href: string) => tasks.filter((t) => t.href === href).reduce((s, t) => s + t.count, 0);
  const groups: NavGroup[] = [];
  if (can("DTCP") || can("PRICE")) {
    // cây Khu vực → Dự án → Hợp đồng (gói thầu DT-CP trên phần mềm + hợp đồng cũ nhập từ DT-CP Excel)
    const [projects, excel] = await Promise.all([
      can("DTCP") ? prisma.project.findMany({ where: areaWhere(access), select: { id: true, name: true, packageName: true, packageType: true, area: true, dtcpStatus: true, contractNo: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
      prisma.costContract.findMany({ where: { source: "EXCEL", ...areaWhere(access) }, orderBy: [{ contractNo: "asc" }, { appendixNo: "asc" }], select: { id: true, name: true, packageName: true, contractNo: true, appendixNo: true, appendixOfId: true, area: true } }),
    ]);
    const excelById = new Map(excel.map((c) => [c.id, c]));
    const rootOf = (c: (typeof excel)[number]) => (c.appendixOfId ? excelById.get(c.appendixOfId) : undefined) ?? c;
    const excelSorted = [...excel].sort((a, b) => {
      const ra = rootOf(a);
      const rb = rootOf(b);
      return `${ra.contractNo}|${ra.id}|${a.appendixOfId ? 1 : 0}|${a.appendixNo}`.localeCompare(`${rb.contractNo}|${rb.id}|${b.appendixOfId ? 1 : 0}|${b.appendixNo}`, "vi", { numeric: true });
    });
    const typeLabel = new Map<string, string>(PACKAGE_TYPES.map((t) => [t.value, t.label]));
    const norm = (x: string) => x.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
    const items = [
      ...projects.map((p) => ({ area: p.area || "", name: p.name, pkg: { key: p.id, href: `/projects/${p.id}`, label: p.packageName || "(chưa đặt tên gói thầu)", sub: [typeLabel.get(normalizePackageType(p.packageType)) ?? "", p.contractNo ? `HĐ ${p.contractNo}` : "", p.dtcpStatus !== "DRAFT" ? DTCP_STATUS[p.dtcpStatus]?.label ?? "" : ""].filter(Boolean).join(" · "), projectId: p.id, projectName: p.name } })),
      // PHỤ LỤC gom về HỢP ĐỒNG GỐC đã chọn (cùng khu vực + dự án với hợp đồng gốc), xếp ngay dưới hợp đồng gốc
      ...excelSorted.map((c) => {
        const par = c.appendixOfId ? excelById.get(c.appendixOfId) : undefined;
        const isPl = !!(c.appendixOfId || c.appendixNo);
        return { area: (par?.area ?? c.area) || "", name: par?.name ?? c.name, pkg: { key: `x${c.id}`, excelId: c.id, href: can("PRICE") ? `/gia-doi/hop-dong/${c.id}` : null, label: `${isPl ? `↳ ${c.appendixNo || "Phụ lục"} · ` : ""}${c.packageName || c.contractNo || "(hợp đồng)"}`, sub: `${isPl ? "Phụ lục · " : ""}DT-CP Excel (HĐ cũ)${c.contractNo ? ` · ${c.contractNo}` : ""}`, excel: true } };
      }),
    ];
    const tree: NavTree = [...new Set(items.map((i) => i.area))]
      .sort((x, y) => (x || "9").localeCompare(y || "9"))
      .map((area) => {
        const byName = new Map<string, { name: string; packages: NavTree[number]["projects"][number]["packages"] }>();
        for (const i of items.filter((i) => i.area === area)) {
          const k = norm(i.name);
          if (!byName.has(k)) byName.set(k, { name: i.name, packages: [] });
          byName.get(k)!.packages.push(i.pkg);
        }
        return { area, projects: [...byName.values()].sort((x, y) => x.name.localeCompare(y.name, "vi")) };
      });
    groups.push({ key: "dtcp", label: "DT-CP", tree, footer: can("DTCP") ? [{ href: "/projects", label: "📊 Tổng quan dự án (biểu đồ doanh thu - chi phí)" }] : [] });
  }
  if (can("PROC"))
    groups.push({
      key: "vt",
      label: "Kế toán vật tư",
      links: [
        { href: "/mua-vat-tu", label: "Tổng quan mua hàng" },
        { href: "/mua-vat-tu/de-nghi", label: "Đề nghị vật tư (BCH)", count: count("/mua-vat-tu/de-nghi") },
        { href: "/mua-vat-tu/don-hang", label: "Đơn hàng & so sánh giá", count: count("/mua-vat-tu/don-hang") },
        { href: "/mua-vat-tu/nhan-hang", label: "Nhận hàng", count: count("/mua-vat-tu/nhan-hang") },
        { href: "/mua-vat-tu/cong-no", label: "Công nợ nhà cung cấp", count: count("/mua-vat-tu/cong-no") },
        { href: "/mua-vat-tu/nha-cung-cap", label: "Nhà cung cấp" },
        { href: "/cong-cu/lam-nhe-excel", label: "🗜 Làm nhẹ file Excel" },
      ],
    });
  if (seePrice || seeSub)
    groups.push({
      key: "qstt",
      label: "QS Thanh toán",
      links: [
        ...(seePrice ? [{ href: "/gia-doi", label: "Trình giá đội", count: count("/gia-doi") }] : []),
        { href: "/gia-doi/hop-dong", label: "Hợp đồng & sổ giá (đội, thầu phụ)" },
        ...(pu && canManageContracts(pu) ? [{ href: "/gia-doi/hop-dong?import=1", label: "Nhập DT-CP Excel (hợp đồng cũ)" }] : []),
        ...(seePrice ? [{ href: "/gia-doi/kiem-tra-bill", label: "Kiểm tra Bill đội" }] : []),
        ...(siteMgr ? [{ href: "/du-an", label: "Danh mục dự án (mã dự án)", count: sitePending }] : []),
        { href: "/cong-cu/lam-nhe-excel", label: "🗜 Làm nhẹ file Excel" },
      ],
    });
  if (can("DTCP") || seeSub)
    groups.push({
      key: "qsdt",
      label: "QS Đấu thầu",
      links: [
        ...(can("DTCP") ? [{ href: "/projects", label: "Tổng quan dự án" }] : []),
        ...(seeSub ? [{ href: "/gia-doi/thau-phu", label: "Trình giá thầu phụ", count: count("/gia-doi/thau-phu") }] : []),
        ...(can("DTCP") ? [{ href: "/catalog", label: "Định mức" }] : []),
        ...(normReviewer ? [{ href: "/admin/catalog-changes", label: "Duyệt định mức", count: pending.length }] : []),
        { href: "/cong-cu/lam-nhe-excel", label: "🗜 Làm nhẹ file Excel" },
      ],
    });
  if (isAdmin)
    groups.push({
      key: "admin",
      label: "Quản trị",
      links: [
        { href: "/admin/users", label: "Người dùng & chương trình được dùng", hint: "Kèm sao lưu dữ liệu" },
        { href: "/du-an", label: "Danh mục dự án", count: sitePending, hint: "Mã dự án, tên gọi khác, gộp dự án trùng tên" },
        { href: "/admin/catalog-changes", label: "Duyệt định mức DT-CP", count: pending.length, hint: "Định mức người dùng tự thêm chờ thống nhất mã" },
        { href: "/admin/yeu-cau", label: "Yêu cầu từ người dùng (Trợ lý AI)", count: aiPending, hint: "Lỗi / tính năng người dùng đề xuất, chờ anh duyệt" },
        { href: "/mua-vat-tu/phan-quyen", label: "Phân quyền Mua vật tư (BCH từng dự án)" },
        { href: "/gia-doi/phan-quyen", label: "Phân quyền trình giá (QSTT, Trưởng phòng, Phó Tổng)" },
      ],
    });

  return (
    <div className="flex min-h-screen flex-col">
      <StaleVersionGuard />
      <TaskDoneToast />
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        {/* điện thoại: tiêu đề nhỏ lại, các nút xuống dòng riêng (không chồng lên nhau) */}
        <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
          <div className="flex min-w-0 items-center gap-6">
            <Link href="/" className="flex min-w-0 items-center gap-2 text-slate-900 sm:gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/tmn-logo.png" alt="Tân Minh Nhân" className="h-9 w-auto shrink-0 sm:h-14" />
              {/* font hệ thống đủ dấu tiếng Việt cho chữ hoa (Ố, Ế...); không dùng chữ cắt nền chuyển màu vì làm mất / lệch dấu */}
              <span className="min-w-0" style={{ fontFamily: "Arial, \"Segoe UI\", Tahoma, sans-serif" }}>
                <span className="block pt-1 text-base font-bold uppercase leading-tight tracking-wide text-blue-900 sm:text-2xl sm:leading-normal">Khối Kinh Tế Kế Hoạch</span>
                <span className="block text-[9px] font-semibold uppercase leading-tight tracking-normal text-red-700 sm:text-xs sm:leading-normal sm:tracking-[0.15em]">Công ty CP XD Kiến trúc Tân Minh Nhân</span>
              </span>
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 sm:text-sm">
            {session?.user.id && <TaskBell tasks={tasks} userId={session.user.id} />}
            <span>
              {session?.user.name} <span className="text-slate-400">({session?.user.role})</span>
            </span>
            <ChangePasswordButton />
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
                Đăng xuất
              </button>
            </form>
          </div>
        </div>
      </header>
      {pending.length > 0 && (
        <div className="border-b border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          ⚠ Có <b>{pending.length}</b> định mức mới do người dùng tự thêm chờ kiểm tra mã (
          {[...byUser.entries()].map(([u, v]) => `${u}: ${v.n} định mức, ${v.r} vật tư/nhân công/máy mới`).join(" · ")}
          ).{" "}
          <Link href="/admin/catalog-changes" className="font-semibold underline">
            Xem và thống nhất mã →
          </Link>
        </div>
      )}
      {/* menu dọc bên trái theo cụm công việc + nội dung bên phải */}
      <div className="flex flex-1 flex-col lg:flex-row">
        <aside className="shrink-0 border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white p-2.5 lg:sticky lg:top-[77px] lg:h-[calc(100vh-77px)] lg:w-72 lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <NavMenu groups={groups} admin={!!access?.isAdmin} slots={{ dtcp: access && (access.isAdmin || (access.apps.has("DTCP") && access.dtcp.has("EDIT"))) ? <CreateDtcpMenu /> : null }} />
        </aside>
        <main className="min-w-0 flex-1 px-3 py-6">{children}</main>
      </div>
      {session?.user.id && <AiAssistant enabled={aiEnabled()} unseen={unseenTickets} />}
    </div>
  );
}
