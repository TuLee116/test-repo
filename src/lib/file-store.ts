import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// KHO FILE (23/11/2026): file gốc Excel của hồ sơ giá đội / thầu phụ / DT-CP hợp đồng nằm NGOÀI cơ sở dữ liệu.
// - Khoá file = mã băm SHA-256 nội dung (cùng nội dung → 1 file; hồ sơ trình lại dùng chung file, không nhân bản).
// - File không bao giờ sửa: đổi nội dung = file mới, khoá mới.
// - Hiện lưu trên ổ đĩa: FILE_DIR, mặc định /data/files (Railway) hoặc ./files (trên máy).
//   Khi chuyển sang máy chủ Việt Nam có kho S3 (VNG vStorage, Bizfly Simple Storage...) chỉ cần thêm bản lưu S3 ở đây —
//   phần còn lại của phần mềm chỉ gọi putFile / getFile.

export const fileDir = () => process.env.FILE_DIR || (fs.existsSync("/data") ? "/data/files" : path.join(process.cwd(), "files"));

const KEY = /^[0-9a-f]{64}$/;
const pathOf = (key: string) => {
  if (!KEY.test(key)) throw new Error(`Khoá file không hợp lệ: ${key}`);
  return path.join(fileDir(), key.slice(0, 2), key);
};

export async function putFile(data: Uint8Array): Promise<string> {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const key = crypto.createHash("sha256").update(buf).digest("hex");
  const p = pathOf(key);
  if (fs.existsSync(p) && fs.statSync(p).size === buf.length) return key;
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.part`;
  await fs.promises.writeFile(tmp, buf);
  await fs.promises.rename(tmp, p); // ghi xong mới đổi tên → không bao giờ có file dở dang
  return key;
}

export async function getFile(key: string | null | undefined): Promise<Uint8Array | null> {
  if (!key) return null;
  try {
    return new Uint8Array(await fs.promises.readFile(pathOf(key)));
  } catch (e) {
    console.error(`[file-store] Không đọc được file ${key}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// tất cả file đang có (để sao lưu kèm)
export function listFiles(): { key: string; path: string; size: number }[] {
  const root = fileDir();
  const out: { key: string; path: string; size: number }[] = [];
  try {
    for (const d of fs.readdirSync(root)) {
      const sub = path.join(root, d);
      if (!fs.statSync(sub).isDirectory()) continue;
      for (const f of fs.readdirSync(sub)) if (KEY.test(f)) out.push({ key: f, path: path.join(sub, f), size: fs.statSync(path.join(sub, f)).size });
    }
  } catch {}
  return out;
}
