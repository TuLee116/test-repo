// Dọn file ảnh BOQ không còn bản ghi trong DB (dòng BOQ / dự án đã bị xoá → bản ghi BoqImage tự xoá theo,
// còn file trên ổ đĩa thì không). Chạy lúc khởi động server (scripts/railway-start.sh); lỗi thì bỏ qua.
import fs from "fs";
import path from "path";
import { prisma } from "../src/lib/prisma";
import { cleanupTmpImages, uploadDir } from "../src/lib/uploads";

async function main() {
  const root = uploadDir();
  // khoá = "<dự án>/<uuid>" (bỏ đuôi) - ảnh thu nhỏ "<uuid>.thumb.jpg" đi theo ảnh gốc
  const stem = (f: string) => f.replace(/(\.thumb)?\.(jpg|png|gif)$/, "");
  const keep = new Set((await prisma.boqImage.findMany({ select: { fileName: true } })).map((i) => stem(i.fileName)));
  let removed = 0;
  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name === "_tmp") continue;
    for (const f of fs.readdirSync(path.join(root, dir.name))) {
      if (!keep.has(stem(`${dir.name}/${f}`))) {
        fs.unlinkSync(path.join(root, dir.name, f));
        removed++;
      }
    }
  }
  cleanupTmpImages();
  console.log(`[sweep-orphan-images] xoá ${removed} file ảnh không còn dùng`);
}
main().catch((e) => console.error("[sweep-orphan-images]", e));
