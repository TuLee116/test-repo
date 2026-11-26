"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAccess } from "@/lib/access";
import { loadSites, siteByName } from "@/lib/project-site";

// QUẢN TRỊ: ĐIỀU CHUYỂN DT-CP sang dự án / khu vực khác (VD gộp 2 dự án trùng tên "Khu đô thị hỗn hợp Nha Trang" và
// "Khu đô thị hỗn hợp thành phố Nha Trang"). Cây menu Khu vực → Dự án → Hợp đồng được dựng từ TÊN DỰ ÁN + KHU VỰC của từng DT-CP
// (DT-CP trên phần mềm và hợp đồng cũ nhập từ Excel) — không có bản ghi "dự án" riêng. Vì vậy điều chuyển hết DT-CP đi thì
// tên dự án cũ TỰ BIẾN MẤT khỏi menu (= đã xoá tên dự án cũ), không cần xoá riêng.
type R = { ok: boolean; error?: string; info?: string };
export type MoveItem = { kind: "project" | "excel"; id: string };

export async function moveDtcpAction(items: MoveItem[], to: { name: string; area: string }): Promise<R> {
  try {
    const a = await getAccess();
    if (!a?.isAdmin) return { ok: false, error: "Chỉ quản trị mới điều chuyển DT-CP được" };
    let name = to.name.trim().replace(/\s+/g, " ");
    if (!name) return { ok: false, error: "Nhập tên dự án đích" };
    // tên đích trùng tên / tên gọi khác của 1 dự án trong Danh mục dự án → gắn luôn dự án đó (tên theo tên chuẩn); không trùng → bỏ gắn
    const site = siteByName(name, await loadSites());
    if (site) name = site.name;
    const siteId = site?.id ?? null;
    const area = ["1", "2", "3", "4", "5"].includes(to.area) ? to.area : "";
    const projectIds = items.filter((i) => i.kind === "project").map((i) => i.id);
    const excelIds = items.filter((i) => i.kind === "excel").map((i) => i.id);
    if (!projectIds.length && !excelIds.length) return { ok: false, error: "Không có DT-CP nào để điều chuyển" };
    await prisma.$transaction([
      prisma.project.updateMany({ where: { id: { in: projectIds } }, data: { name, area, siteId } }),
      // hợp đồng trong Trình giá đội: hợp đồng Excel được chọn + hợp đồng lấy từ DT-CP phần mềm vừa chuyển (cùng tên / khu vực)
      prisma.costContract.updateMany({ where: { OR: [{ id: { in: excelIds } }, { projectId: { in: projectIds }, source: "APP" }] }, data: { name, area, siteId } }),
      ...projectIds.map((id) => prisma.procLog.create({ data: { entity: "DTCP", entityId: id, action: `Điều chuyển sang dự án "${name}"${area ? ` (Khu vực ${area})` : ""}`, userName: a.name, note: "" } })),
    ]);
    revalidatePath("/", "layout");
    return { ok: true, info: `Đã điều chuyển ${projectIds.length + excelIds.length} DT-CP sang "${name}"` };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Không điều chuyển được, thử lại hoặc báo quản trị." };
  }
}
