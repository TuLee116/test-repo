import fs from "fs";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";

// Nơi lưu file tải lên (ảnh BOQ): UPLOAD_DIR nếu có; trên Railway dùng ổ đĩa bền /data/uploads (cùng ổ
// với prod.db, không mất khi đẩy bản mới); chạy trên máy thì ./uploads. Ảnh KHÔNG lưu trong DB.
export function uploadDir(): string {
  const dir = process.env.UPLOAD_DIR || (fs.existsSync("/data") ? "/data/uploads" : path.join(process.cwd(), "uploads"));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const MAX_IMAGE_BYTES = 1024 * 1024; // mỗi ảnh lưu tối đa 1MB (ảnh lớn hơn được tự nén lại)
export const MAX_RAW_UPLOAD_BYTES = 25 * 1024 * 1024; // ảnh gốc gửi lên tối đa 25MB (trước khi nén)

export type StoredImage = { buf: Buffer; mime: string; ext: "jpg" | "png" | "gif"; width: number; height: number };

// Chuẩn hoá ảnh để lưu: xoay đúng chiều (EXIF), đổi về JPG/PNG/GIF (định dạng Excel nhận được), nén
// dần (giảm chất lượng, rồi giảm kích thước) cho tới khi ≤ 1MB. Ảnh không đọc được (VD EMF/WMF trong
// file Excel cũ) → null.
export async function normalizeImage(input: Buffer): Promise<StoredImage | null> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(input, { failOn: "none" }).metadata();
  } catch {
    return null;
  }
  const fmt = meta.format;
  if (!fmt || !meta.width || !meta.height) return null;
  const rotated = (meta.orientation ?? 1) > 1;
  // đã đúng định dạng, đúng chiều và đủ nhẹ: giữ nguyên bản gốc (không nén lại làm giảm chất lượng)
  if (input.length <= MAX_IMAGE_BYTES && !rotated && (fmt === "jpeg" || fmt === "png" || fmt === "gif")) {
    const ext = fmt === "jpeg" ? "jpg" : fmt;
    return { buf: input, mime: fmt === "jpeg" ? "image/jpeg" : `image/${fmt}`, ext, width: meta.width, height: meta.height };
  }
  const alpha = !!meta.hasAlpha;
  for (const maxSide of [2400, 1800, 1400, 1000, 700]) {
    for (const quality of alpha ? [9] : [85, 75, 65, 55]) {
      let img = sharp(input, { failOn: "none", animated: false }).rotate().resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true });
      img = alpha ? img.png({ compressionLevel: quality, palette: maxSide <= 1400 }) : img.flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true });
      const { data, info } = await img.toBuffer({ resolveWithObject: true });
      if (data.length <= MAX_IMAGE_BYTES) return { buf: data, mime: alpha ? "image/png" : "image/jpeg", ext: alpha ? "png" : "jpg", width: info.width, height: info.height };
    }
  }
  return null;
}

// Lưu ảnh chính thức của 1 dự án → tên file tương đối (lưu vào BoqImage.fileName)
export function writeProjectImage(projectId: string, img: StoredImage): string {
  const rel = `${safeSeg(projectId)}/${crypto.randomUUID()}.${img.ext}`;
  const abs = path.join(uploadDir(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, img.buf);
  return rel;
}

export function imagePath(fileName: string): string | null {
  if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9-]+\.(jpg|png|gif)$/.test(fileName)) return null;
  return path.join(uploadDir(), fileName);
}

export function removeImageFile(fileName: string) {
  const p = imagePath(fileName);
  if (!p) return;
  for (const f of [p, thumbPath(p)]) {
    try {
      fs.unlinkSync(f);
    } catch {}
  }
}

const thumbPath = (abs: string) => abs.replace(/\.(jpg|png|gif)$/, ".thumb.jpg");

// Ảnh thu nhỏ (cạnh dài 240px) cho cột ảnh trên bảng BOQ - tạo 1 lần rồi dùng lại
export async function thumbnailOf(fileName: string): Promise<Buffer | null> {
  const p = imagePath(fileName);
  if (!p || !fs.existsSync(p)) return null;
  const t = thumbPath(p);
  if (fs.existsSync(t)) return fs.readFileSync(t);
  try {
    const buf = await sharp(p, { failOn: "none", animated: false }).resize({ width: 240, height: 240, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 78 }).toBuffer();
    fs.writeFileSync(t, buf);
    return buf;
  } catch {
    return null;
  }
}

// ---- Ảnh tạm: lấy ra từ file Excel lúc phân tích, chỉ thành ảnh chính thức khi người dùng bấm nhập ----
// Mã ảnh tạm = "<32 hex>.<đuôi>" (không chứa đường dẫn - chống ghi/đọc ra ngoài thư mục)
const TMP_RE = /^[a-f0-9]{32}\.(jpg|png|gif)$/;
const tmpDir = () => {
  const d = path.join(uploadDir(), "_tmp");
  fs.mkdirSync(d, { recursive: true });
  return d;
};

export function writeTmpImage(img: StoredImage): string {
  const token = `${crypto.randomBytes(16).toString("hex")}.${img.ext}`;
  fs.writeFileSync(path.join(tmpDir(), token), img.buf);
  return token;
}

export function tmpImagePath(token: string): string | null {
  return TMP_RE.test(token) ? path.join(tmpDir(), token) : null;
}

// Chuyển ảnh tạm thành ảnh của dự án; trả null nếu mã sai / ảnh tạm đã bị dọn
export async function promoteTmpImage(projectId: string, token: string): Promise<{ fileName: string; mime: string; width: number; height: number } | null> {
  const src = tmpImagePath(token);
  if (!src || !fs.existsSync(src)) return null;
  const ext = token.split(".")[1] as StoredImage["ext"];
  let width = 0;
  let height = 0;
  try {
    const m = await sharp(src).metadata();
    width = m.width ?? 0;
    height = m.height ?? 0;
  } catch {}
  const rel = `${safeSeg(projectId)}/${crypto.randomUUID()}.${ext}`;
  const abs = path.join(uploadDir(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.renameSync(src, abs);
  return { fileName: rel, mime: ext === "jpg" ? "image/jpeg" : `image/${ext}`, width, height };
}

// Dọn ảnh tạm quá 1 ngày (người dùng phân tích file nhưng không bấm nhập)
export function cleanupTmpImages(maxAgeMs = 24 * 3600 * 1000) {
  const d = tmpDir();
  const now = Date.now();
  for (const f of fs.readdirSync(d)) {
    try {
      const p = path.join(d, f);
      if (now - fs.statSync(p).mtimeMs > maxAgeMs) fs.unlinkSync(p);
    } catch {}
  }
}

function safeSeg(s: string) {
  const v = s.replace(/[^A-Za-z0-9_-]/g, "");
  if (!v) throw new Error("Mã dự án không hợp lệ");
  return v;
}

// Ảnh đưa vào file Excel xuất ra: thu về cạnh dài 480px để file Excel không quá nặng (ảnh gốc vẫn xem trên web)
export async function exportImageOf(fileName: string): Promise<{ buf: Buffer; ext: "jpeg" | "png"; width: number; height: number } | null> {
  const p = imagePath(fileName);
  if (!p || !fs.existsSync(p)) return null;
  try {
    const alpha = !!(await sharp(p).metadata()).hasAlpha;
    let img = sharp(p, { failOn: "none", animated: false }).resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true });
    img = alpha ? img.png({ compressionLevel: 9 }) : img.flatten({ background: "#ffffff" }).jpeg({ quality: 80 });
    const { data, info } = await img.toBuffer({ resolveWithObject: true });
    return { buf: data, ext: alpha ? "png" : "jpeg", width: info.width, height: info.height };
  } catch {
    return null;
  }
}
