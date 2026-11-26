import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { MAX_RAW_UPLOAD_BYTES, normalizeImage, writeProjectImage } from "@/lib/uploads";

// Thêm ảnh cho 1 dòng BOQ (chọn file hoặc dán Ctrl+V trên bảng BOQ). Ảnh được tự nén về tối đa 1MB.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });

  const form = await req.formData();
  const projectId = String(form.get("projectId") || "");
  const boqItemId = String(form.get("boqItemId") || "");
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  const boq = await prisma.boqItem.findFirst({ where: { id: boqItemId, projectId }, select: { id: true } });
  if (!boq) return NextResponse.json({ error: "Không tìm thấy dòng BOQ" }, { status: 404 });
  if (!files.length) return NextResponse.json({ error: "Chưa có ảnh" }, { status: 400 });

  let order = ((await prisma.boqImage.aggregate({ where: { boqItemId }, _max: { orderIndex: true } }))._max.orderIndex ?? -1) + 1;
  const errors: string[] = [];
  let added = 0;
  for (const f of files) {
    if (!f.type.startsWith("image/")) {
      errors.push(`${f.name}: không phải file ảnh`);
      continue;
    }
    if (f.size > MAX_RAW_UPLOAD_BYTES) {
      errors.push(`${f.name}: ảnh gốc quá lớn (tối đa ${MAX_RAW_UPLOAD_BYTES / 1024 / 1024}MB)`);
      continue;
    }
    const img = await normalizeImage(Buffer.from(await f.arrayBuffer()));
    if (!img) {
      errors.push(`${f.name}: không đọc được ảnh hoặc không nén được về 1MB`);
      continue;
    }
    const fileName = writeProjectImage(projectId, img);
    await prisma.boqImage.create({ data: { projectId, boqItemId, fileName, mime: img.mime, width: img.width, height: img.height, orderIndex: order++ } });
    added++;
  }
  if (added) revalidatePath(`/projects/${projectId}`);
  return NextResponse.json({ added, error: errors.join("\n") || undefined }, { status: added || !errors.length ? 200 : 400 });
}
