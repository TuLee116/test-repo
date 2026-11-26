import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { dumpPg, pgClient } from "@/lib/pg-copy";
import JSZip from "jszip";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { uploadDir } from "@/lib/uploads";
import { Readable } from "stream";
import { backupPath } from "@/lib/db-backup";
import { listFiles } from "@/lib/file-store";

export const dynamic = "force-dynamic";

// Tải bản sao lưu TOÀN BỘ dữ liệu (chỉ quản trị viên): 1 file .zip gồm cơ sở dữ liệu PostgreSQL (chụp
// nhất quán, src/lib/pg-copy.ts dumpPg) + thư mục ảnh BOQ (uploads/).
// Khôi phục: xem tài liệu bàn giao (BAN-GIAO.md, mục "Sao lưu & khôi phục").
export async function GET(req: Request) {
  const session = await auth();
  if (session?.user.role !== "ADMIN") return NextResponse.json({ error: "Chỉ quản trị viên mới tải được bản sao lưu" }, { status: 403 });

  // ?file=db-YYYYMMDD-HHmm.db.gz → tải 1 bản sao lưu tự động hằng ngày (src/lib/db-backup.ts)
  const file = new URL(req.url).searchParams.get("file");
  if (file) {
    const p = backupPath(file);
    if (!p) return NextResponse.json({ error: "Không có bản sao lưu này" }, { status: 404 });
    const body = Readable.toWeb(fs.createReadStream(p)) as unknown as ReadableStream;
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Length": String(fs.statSync(p).size),
        "Content-Disposition": `attachment; filename="${file}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const snap = path.join(os.tmpdir(), `dtcp-backup-${crypto.randomBytes(6).toString("hex")}.jsonl.gz`);
  try {
    const c = pgClient();
    await c.connect();
    try {
      await dumpPg(c, snap);
    } finally {
      await c.end();
    }

    const zip = new JSZip();
    zip.file("database.jsonl.gz", fs.readFileSync(snap), { compression: "STORE" });
    const root = uploadDir();
    let images = 0;
    for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
      if (!dir.isDirectory() || dir.name === "_tmp") continue;
      for (const f of fs.readdirSync(path.join(root, dir.name))) {
        if (f.includes(".thumb.")) continue; // ảnh thu nhỏ tự tạo lại khi cần
        zip.file(`uploads/${dir.name}/${f}`, fs.readFileSync(path.join(root, dir.name, f)), { compression: "STORE" });
        images++;
      }
    }
    // KHO FILE (file gốc Excel các hồ sơ, src/lib/file-store.ts)
    const stored = listFiles();
    for (const f of stored) zip.file(`files/${f.key.slice(0, 2)}/${f.key}`, fs.readFileSync(f.path), { compression: "DEFLATE" });
    const stamp = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})/, "$1-");
    zip.file(
      "DOC-TRUOC.txt",
      [
        `Bản sao lưu Khối Kinh Tế Kế Hoạch (DT-CP Online) — ${stamp} (giờ VN)`,
        `- database.jsonl.gz: toàn bộ cơ sở dữ liệu PostgreSQL (dự án, BOQ, định mức, hồ sơ giá, người dùng...)`,
        `- uploads/: ${images} ảnh BOQ (tên thư mục = mã dự án)`,
        `- files/: ${stored.length} file gốc Excel của hồ sơ (kho file) — chép vào FILE_DIR (Railway: /data/files; trên máy: ./files)`,
        `Khôi phục CSDL: npx tsx scripts/pg-restore.ts database.jsonl.gz --force (DATABASE_URL trỏ tới PostgreSQL đã chạy prisma migrate deploy);`,
        `ảnh: chép thư mục uploads vào UPLOAD_DIR (Railway: /data/uploads; trên máy: ./uploads).`,
        `File này có dữ liệu kinh doanh thật và mật khẩu (đã mã hoá bcrypt) của người dùng — bảo quản cẩn thận.`,
      ].join("\r\n")
    );
    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="DTCP-saoluu-${stamp}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[admin/backup]", e);
    return NextResponse.json({ error: "Không tạo được bản sao lưu" }, { status: 500 });
  } finally {
    try {
      fs.unlinkSync(snap);
    } catch {}
  }
}
