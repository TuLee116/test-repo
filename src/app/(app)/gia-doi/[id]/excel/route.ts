import { prisma } from "@/lib/prisma";
import { canSeePrice, getPriceUser, priceFileOf } from "@/lib/gia-doi";
import { buildPriceWorkbookAuto } from "@/lib/gia-doi-excel";

// Tải file Excel đúng mẫu đề xuất kèm khối "TRƯỞNG PHÒNG DUYỆT" (cũng là file đính kèm khi gửi mail)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await getPriceUser();
  if (!u || !canSeePrice(u)) return new Response("Không có quyền", { status: 403 });
  const sub = await prisma.priceSubmission.findUnique({ where: { id }, include: { lines: { orderBy: { orderIndex: "asc" } } } });
  if (!sub) return new Response("Không tìm thấy hồ sơ", { status: 404 });
  const buf = await buildPriceWorkbookAuto({ ...sub, fileData: await priceFileOf(sub) });
  const name = `${(sub.fileName || "de-xuat-don-gia.xlsx").replace(/\.xlsx$/i, "")} - ${sub.code}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
