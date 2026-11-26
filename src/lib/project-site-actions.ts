"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getPriceUser, type PriceUser } from "@/lib/gia-doi";
import { AREAS } from "@/lib/perms";
import { canManageSites, importSites, linkLooseGroup, mergeAliases, mergeSites, parseSiteExcel, siteByName, similarSites, syncSite, toSiteOpt, type SiteOpt } from "@/lib/project-site";

// DANH MỤC DỰ ÁN — thao tác: đề nghị dự án mới (mọi người dùng), xác nhận / sửa / gộp / xoá / nhập Excel (quản trị, QSTT)

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
class SiteError extends Error {}
const fail = (m: string): never => {
  throw new SiteError(m);
};
async function run<T extends object>(fn: () => Promise<T>): Promise<R<T>> {
  try {
    const r = await fn();
    revalidatePath("/", "layout");
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof SiteError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Lỗi hệ thống, thử lại hoặc báo quản trị." };
  }
}
async function user(): Promise<PriceUser> {
  const u = await getPriceUser();
  if (!u) fail("Chưa đăng nhập");
  return u!;
}
async function manager(): Promise<PriceUser> {
  const u = await user();
  if (!canManageSites(u)) fail("Chỉ quản trị hoặc QSTT được sửa Danh mục dự án");
  return u;
}
const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const areaOk = (a: unknown) => (AREAS.includes(String(a)) ? String(a) : "");

// ĐỀ NGHỊ DỰ ÁN MỚI: tên đã có (tên chuẩn / tên gọi khác) → trả dự án có sẵn; force = người dùng đã xem gợi ý "Có phải là…?" và xác nhận là dự án khác.
// Quản trị / QSTT tạo thì có hiệu lực ngay; người khác tạo ở trạng thái CHỜ XÁC NHẬN (vẫn dùng được, quản trị / QSTT xác nhận hoặc gộp sau)
export async function proposeSiteAction(name: string, area: string, force = false): Promise<R<{ site?: SiteOpt; similar?: SiteOpt[] }>> {
  return run(async () => {
    const u = await user();
    const n = clean(name);
    if (n.length < 3) fail("Nhập tên dự án (ít nhất 3 ký tự)");
    const sites = (await prisma.projectSite.findMany()).map(toSiteOpt);
    const same = siteByName(n, sites);
    if (same) return { site: same };
    if (!force) {
      const similar = similarSites(n, sites, areaOk(area), 5, 0.5).map((x) => x.site);
      if (similar.length) return { similar };
    }
    const mgr = canManageSites(u);
    const s = await prisma.projectSite.create({ data: { name: n, area: areaOk(area), status: mgr ? "ACTIVE" : "PENDING", createdByName: u.name, confirmedByName: mgr ? u.name : "" } });
    return { site: toSiteOpt(s) };
  });
}

export async function saveSiteAction(id: string, data: { code: string; name: string; area: string; aliases: string[]; cluster?: string; clusterName?: string }): Promise<R> {
  return run(async () => {
    const u = await manager();
    const s = await prisma.projectSite.findUnique({ where: { id } });
    if (!s) fail("Không tìm thấy dự án");
    const name = clean(data.name);
    if (!name) fail("Tên dự án không được để trống");
    const code = clean(data.code);
    if (code && (await prisma.projectSite.findFirst({ where: { code, id: { not: id } } }))) fail(`Mã ${code} đã dùng cho dự án khác — gộp 2 dự án nếu là 1`);
    const others = (await prisma.projectSite.findMany({ where: { id: { not: id } } })).map(toSiteOpt);
    const dup = siteByName(name, others);
    if (dup) fail(`Tên này đã là tên (hoặc tên gọi khác) của dự án "${dup.name}" — gộp 2 dự án nếu là 1`);
    // đổi tên: tên cũ giữ làm tên gọi khác (file Excel cũ ghi tên cũ vẫn tự nhận đúng)
    const aliases = mergeAliases(name, (data.aliases ?? []).map(clean), s!.name !== name ? [s!.name] : []);
    // CỤM DỰ ÁN: chọn cụm có sẵn thì lấy tên cụm đó; sửa tên cụm thì đổi cho mọi dự án cùng cụm
    const cluster = data.cluster === undefined ? s!.cluster : clean(data.cluster).toUpperCase();
    let clusterName = !cluster ? "" : data.clusterName === undefined ? s!.clusterName : clean(data.clusterName);
    if (cluster && !clusterName) clusterName = (await prisma.projectSite.findFirst({ where: { cluster, clusterName: { not: "" } }, select: { clusterName: true } }))?.clusterName ?? "";
    await prisma.projectSite.update({ where: { id }, data: { name, code, area: areaOk(data.area), cluster, clusterName, aliases: JSON.stringify(aliases), ...(s!.status === "PENDING" ? { status: "ACTIVE", confirmedByName: u.name } : {}) } });
    if (cluster && clusterName) await prisma.projectSite.updateMany({ where: { cluster, clusterName: { not: clusterName } }, data: { clusterName } });
    await syncSite(id);
    return {};
  });
}

export async function confirmSiteAction(id: string): Promise<R> {
  return run(async () => {
    const u = await manager();
    await prisma.projectSite.update({ where: { id }, data: { status: "ACTIVE", confirmedByName: u.name } });
    return {};
  });
}

export async function mergeSitesAction(targetId: string, sourceIds: string[]): Promise<R> {
  return run(async () => {
    await manager();
    if (!sourceIds.filter((x) => x !== targetId).length) fail("Chọn dự án cần gộp");
    await mergeSites(targetId, sourceIds);
    return {};
  });
}

export async function deleteSiteAction(id: string): Promise<R> {
  return run(async () => {
    await manager();
    const used = await prisma.projectSite.findUnique({ where: { id }, select: { _count: { select: { projects: true, contracts: true, submissions: true, subProposals: true } } } });
    if (!used) fail("Không tìm thấy dự án");
    const n = Object.values(used!._count).reduce((a, b) => a + b, 0);
    if (n) fail(`Dự án đang có ${n} DT-CP / hợp đồng / hồ sơ — gộp vào dự án khác thay vì xoá`);
    await prisma.projectSite.delete({ where: { id } });
    return {};
  });
}

// gắn nhóm tên dự án cũ (chưa có trong danh mục) vào 1 dự án; siteId = "@new" → tạo dự án mới từ tên đó
// ids: chỉ gắn các hồ sơ được tick (trống = cả nhóm tên)
export async function linkLooseAction(key: string, siteId: string, name = "", area = "", ids: string[] = []): Promise<R<{ n: number }>> {
  return run(async () => {
    const u = await manager();
    let id = siteId;
    if (id === "@new") {
      const n = clean(name);
      if (!n) fail("Thiếu tên dự án");
      const s = await prisma.projectSite.create({ data: { name: n, area: areaOk(area), status: "ACTIVE", createdByName: u.name, confirmedByName: u.name } });
      id = s.id;
    }
    if (!(await prisma.projectSite.findUnique({ where: { id } }))) fail("Không tìm thấy dự án");
    return { n: await linkLooseGroup(key, id, ids) };
  });
}

// nhập / cập nhật danh mục từ file Excel "BẢNG TT DỰ ÁN" (nhập lại bản mới thì chỉ cập nhật, không tạo trùng)
export async function importSitesAction(form: FormData): Promise<R<{ created: number; updated: number; total: number; contracts: number }>> {
  return run(async () => {
    const u = await manager();
    const f = form.get("file");
    if (!(f instanceof File) || !f.size) fail("Chọn file Excel");
    const rows = await parseSiteExcel(await (f as File).arrayBuffer());
    if (!rows.length) fail('Không đọc được dự án nào — file cần có cột "STT", "KÝ HIỆU DT - CP MỚI", "TÊN CÔNG TRÌNH" và dòng "KHU VỰC I. ..."');
    return importSites(rows, u.name);
  });
}
