import { prisma } from "@/lib/prisma";
import { canSeePrice, getPriceUser, pricePdfName } from "@/lib/gia-doi";
import { buildPricePdf } from "@/lib/gia-doi-pdf";

// Xem / tải file PDF hồ sơ duyệt (cũng là file đính kèm thư Outlook)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await getPriceUser();
  if (!u || !canSeePrice(u)) return new Response("Không có quyền", { status: 403 });
  const sub = await prisma.priceSubmission.findUnique({ where: { id }, include: { lines: { orderBy: { orderIndex: "asc" } } }, omit: { fileData: true } });
  if (!sub) return new Response("Không tìm thấy hồ sơ", { status: 404 });
  const pdf = await buildPricePdf(sub);
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(pricePdfName(sub))}` },
  });
}
