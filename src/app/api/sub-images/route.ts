import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { asSub, canPrice, canSeeSub, getPriceUser } from "@/lib/gia-doi";
import { MAX_RAW_UPLOAD_BYTES, normalizeImage, writeProjectImage } from "@/lib/uploads";

// Thêm ảnh cho 1 dòng trình giá thầu phụ NỘI THẤT (cột HÌNH ẢNH: chọn file hoặc bấm ô rồi dán Ctrl+V).
// QSĐT / QSTT, khi hồ sơ còn sửa được (đang lập / chờ QSTT kiểm tra / bổ sung theo yêu cầu TP). Ảnh tự nén về tối đa 1MB.
export async function POST(req: Request) {
  const pu = await getPriceUser();
  if (!pu) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  const u = asSub(pu);
  if (!canSeeSub(u) || !canPrice(u, "QSTT", "QSDT")) return NextResponse.json({ error: "Bạn không có quyền sửa hồ sơ thầu phụ" }, { status: 403 });

  const form = await req.formData();
  const lineId = String(form.get("lineId") || "");
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  const line = await prisma.subLine.findUnique({ where: { id: lineId }, select: { id: true, proposalId: true, proposal: { select: { status: true } } } });
  if (!line) return NextResponse.json({ error: "Không tìm thấy dòng — dòng mới thêm thì bấm Lưu nháp trước rồi mới thêm ảnh" }, { status: 404 });
  const st = line.proposal.status;
  if (!(st === "DRAFT" || st === "NEED_INFO" || (st === "QS_CHECK" && canPrice(u, "QSTT")))) return NextResponse.json({ error: "Hồ sơ đã trình, không sửa ảnh được (rút lại trước)" }, { status: 400 });
  if (!files.length) return NextResponse.json({ error: "Chưa có ảnh" }, { status: 400 });

  let order = ((await prisma.subLineImage.aggregate({ where: { lineId }, _max: { orderIndex: true } }))._max.orderIndex ?? -1) + 1;
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
    await prisma.subLineImage.create({ data: { proposalId: line.proposalId, lineId, fileName: writeProjectImage(line.proposalId, img), mime: img.mime, width: img.width, height: img.height, orderIndex: order++ } });
    added++;
  }
  return NextResponse.json({ added, error: errors.join("\n") || undefined }, { status: added || !errors.length ? 200 : 400 });
}
