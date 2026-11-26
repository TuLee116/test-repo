import fs from "fs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { asSub, canSeeSub, getPriceUser } from "@/lib/gia-doi";
import { imagePath, thumbnailOf } from "@/lib/uploads";

// Xem ảnh dòng trình giá thầu phụ nội thất (người có quyền xem Trình giá thầu phụ). ?thumb=1 → ảnh thu nhỏ cho cột ảnh trên bảng.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const pu = await getPriceUser();
  if (!pu || !canSeeSub(asSub(pu))) return NextResponse.json({ error: "Không có quyền" }, { status: 403 });
  const { id } = await params;
  const img = await prisma.subLineImage.findUnique({ where: { id } });
  const p = img ? imagePath(img.fileName) : null;
  if (!img || !p || !fs.existsSync(p)) return NextResponse.json({ error: "Không tìm thấy ảnh" }, { status: 404 });

  const thumb = new URL(req.url).searchParams.get("thumb") === "1";
  const body = thumb ? await thumbnailOf(img.fileName) : fs.readFileSync(p);
  if (!body) return NextResponse.json({ error: "Không đọc được ảnh" }, { status: 500 });
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": thumb ? "image/jpeg" : img.mime,
      "Cache-Control": "private, max-age=31536000, immutable", // file ảnh không đổi nội dung (ảnh mới = file mới)
    },
  });
}
