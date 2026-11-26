import fs from "fs";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { imagePath, thumbnailOf } from "@/lib/uploads";

// Xem ảnh BOQ (chỉ người đã đăng nhập). ?thumb=1 → ảnh thu nhỏ cho cột ảnh trên bảng.
export async function GET(req: Request, { params }: RouteContext<"/api/boq-images/[id]">) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  const { id } = await params;
  const img = await prisma.boqImage.findUnique({ where: { id } });
  const p = img ? imagePath(img.fileName) : null;
  if (!img || !p || !fs.existsSync(p)) return NextResponse.json({ error: "Không tìm thấy ảnh" }, { status: 404 });

  const thumb = new URL(req.url).searchParams.get("thumb") === "1";
  const body = thumb ? await thumbnailOf(img.fileName) : fs.readFileSync(p);
  if (!body) return NextResponse.json({ error: "Không đọc được ảnh" }, { status: 500 });
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": thumb ? "image/jpeg" : img.mime,
      // tên file ảnh không bao giờ đổi nội dung (ảnh mới = file mới) nên cho trình duyệt giữ lâu
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
