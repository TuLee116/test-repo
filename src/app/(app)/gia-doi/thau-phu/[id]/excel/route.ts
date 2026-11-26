import { prisma } from "@/lib/prisma";
import { canSeeSub, getPriceUser } from "@/lib/gia-doi";
import { subWorkbook } from "@/lib/thau-phu-actions";

// Tải file Excel đúng mẫu đề xuất thầu phụ, đã ghi khối "ĐƠN GIÁ DUYỆT (D)" + điều khoản DUYỆT
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await getPriceUser();
  if (!u || !canSeeSub(u)) return new Response("Không có quyền", { status: 403 });
  const p = await prisma.subProposal.findUnique({ where: { id }, select: { code: true, fileName: true } });
  if (!p) return new Response("Không tìm thấy hồ sơ", { status: 404 });
  let buf: Buffer;
  try {
    buf = await subWorkbook(id);
  } catch (e) {
    console.error("[excel thầu phụ]", id, e);
    return new Response(`Không xuất được file Excel: ${(e as Error).message}`, { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const name = `${(p.fileName || "de-xuat-thau-phu.xlsx").replace(/\.xlsx$/i, "")} - ${p.code}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` },
  });
}
