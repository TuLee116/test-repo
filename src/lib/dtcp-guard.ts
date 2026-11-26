import { prisma } from "@/lib/prisma";
import { getAccess, inAreas } from "@/lib/access";

// Chặn mọi thao tác GHI vào 1 DT-CP: phải có quyền "Lập / điều chỉnh DT-CP", DT-CP thuộc khu vực của mình,
// và DT-CP đang ở bước NHÁP (đang trình duyệt / đã duyệt thì khoá — muốn sửa phải rút lại / mở lại để điều chỉnh).
export async function assertProjectEditable(projectId: string) {
  const a = await getAccess();
  if (!a) throw new Error("Chưa đăng nhập");
  if (!a.isAdmin && !(a.apps.has("DTCP") && a.dtcp.has("EDIT"))) throw new Error("Bạn không có quyền lập / điều chỉnh DT-CP (chỉ được xem)");
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { area: true, dtcpStatus: true } });
  if (!p) throw new Error("Không tìm thấy DT-CP");
  if (!inAreas(a, p.area)) throw new Error("DT-CP thuộc khu vực ngoài phạm vi làm việc của bạn");
  if (p.dtcpStatus === "APPROVED" || p.dtcpStatus === "TPOK") throw new Error('DT-CP đã được duyệt (có hiệu lực) nên đang KHOÁ — QSĐT bấm "Mở lại để điều chỉnh" trước khi sửa');
  if (p.dtcpStatus !== "DRAFT") throw new Error("DT-CP đang trình duyệt nên đang KHOÁ — rút lại hoặc chờ trả về rồi mới sửa");
}

// Xem 1 DT-CP: có quyền DT-CP + thuộc khu vực của mình
export async function canViewProject(projectId: string) {
  const a = await getAccess();
  if (!a) return false;
  if (a.isAdmin) return true;
  if (!a.apps.has("DTCP") || !a.dtcp.size) return false;
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { area: true } });
  return !!p && inAreas(a, p.area);
}
