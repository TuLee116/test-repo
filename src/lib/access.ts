import { cache } from "react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { APPS, parseApps, type AppCode } from "@/lib/apps";
import { parseAreas, parseCodes } from "@/lib/perms";

// Quyền của người đang đăng nhập (đọc lại từ DB mỗi lần để quản trị đổi quyền là có hiệu lực ngay):
// chương trình được dùng, checklist quyền DT-CP, khu vực được làm việc (null = tất cả). Quản trị: mọi quyền, mọi khu vực.
export type Access = { id: string; name: string; isAdmin: boolean; apps: Set<AppCode>; dtcp: Set<string>; areas: string[] | null };

export const getAccess = cache(async (): Promise<Access | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;
  const u = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, name: true, role: true, apps: true, dtcpPerms: true, areas: true } });
  if (!u) return null;
  const isAdmin = u.role === "ADMIN";
  const areas = parseAreas(u.areas);
  return {
    id: u.id,
    name: u.name,
    isAdmin,
    apps: isAdmin ? new Set(APPS.filter((a) => !("soon" in a)).map((a) => a.code)) : parseApps(u.apps),
    dtcp: new Set(parseCodes(u.dtcpPerms, "dtcp")),
    areas: isAdmin || !areas.length ? null : areas,
  };
});

export async function hasApp(code: AppCode): Promise<boolean> {
  const a = await getAccess();
  return !!a && (a.isAdmin || a.apps.has(code));
}

// có quyền DT-CP nào trong danh sách (quản trị: luôn có)
export async function canDtcp(...codes: string[]): Promise<boolean> {
  const a = await getAccess();
  return !!a && (a.isAdmin || (a.apps.has("DTCP") && codes.some((c) => a.dtcp.has(c))));
}

// khu vực có nằm trong phạm vi làm việc không (khu vực trống của dự án chưa phân khu: ai có quyền cũng thấy)
export const inAreas = (a: Pick<Access, "areas"> | null, area: string | null | undefined) => !a || !a.areas || !area || a.areas.includes(area);
// điều kiện where theo khu vực cho Project / CostContract
export const areaWhere = (a: Pick<Access, "areas"> | null) => (a?.areas ? { area: { in: [...a.areas, ""] } } : {});

// Trang đầu tiên người dùng được vào (sau khi đăng nhập)
export async function homeHref(): Promise<string> {
  const a = await getAccess();
  if (!a) return "/login";
  return APPS.find((x) => x.href && (a.isAdmin || a.apps.has(x.code)))?.href ?? "/khong-co-quyen";
}
