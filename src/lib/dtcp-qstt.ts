import { prisma } from "@/lib/prisma";
import { parseApps } from "@/lib/apps";
import { parseAreas, parseCodes } from "@/lib/perms";

// Danh sách QSTT (tài khoản được tick quyền QSTT của DT-CP, thuộc khu vực của DT-CP) để QSĐT chọn khi trình DT-CP.
// Chỉ tính quyền được tick (không tính quản trị) — giống "Việc của tôi".
export async function qsttUsers(area: string): Promise<{ id: string; name: string }[]> {
  const us = await prisma.user.findMany({ select: { id: true, name: true, role: true, apps: true, dtcpPerms: true, areas: true }, orderBy: { name: "asc" } });
  return us
    .filter((u) => u.role !== "ADMIN" && parseApps(u.apps).has("DTCP") && parseCodes(u.dtcpPerms, "dtcp").includes("QSTT"))
    .filter((u) => {
      const areas = parseAreas(u.areas);
      return !areas.length || !area || areas.includes(area);
    })
    .map((u) => ({ id: u.id, name: u.name }));
}
