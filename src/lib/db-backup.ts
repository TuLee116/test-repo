import fs from "node:fs";
import path from "node:path";
import { dumpPg, pgClient } from "@/lib/pg-copy";

// SAO LƯU TỰ ĐỘNG HẰNG NGÀY cơ sở dữ liệu (21/11/2026; từ 23/11 là PostgreSQL).
// - Chụp nhất quán toàn bộ bảng (giao dịch chỉ đọc), ghi .jsonl.gz (src/lib/pg-copy.ts dumpPg), lưu ở /data/backups
//   (trên máy: ./backups — đã nằm trong .gitignore). Khôi phục: npx tsx scripts/pg-restore.ts <file> --force
// - Giữ BACKUP_KEEP bản mới nhất (mặc định 5). Ổ đĩa không đủ chỗ thì BỎ QUA.
// - Lịch: 02:00 giờ Việt Nam mỗi ngày (src/instrumentation.ts); khởi động mà bản mới nhất đã quá 26 giờ thì chụp ngay sau 5 phút.
// Bản sao lưu nằm ở ổ đĩa của web, CSDL nằm ở dịch vụ PostgreSQL riêng → mất 1 bên vẫn còn bên kia.

export const backupDir = () => process.env.BACKUP_DIR || (fs.existsSync("/data") ? "/data/backups" : path.join(process.cwd(), "backups"));
const KEEP = () => Math.max(1, Number(process.env.BACKUP_KEEP) || 5);
const NAME = /^db-\d{8}-\d{4}\.(jsonl|db)\.gz$/; // .db.gz = bản SQLite cũ (trước 23/11) — vẫn tải được

export type BackupInfo = { name: string; size: number; at: Date };
export type BackupStatus = { at: string; ok: boolean; reason: string; file?: string; size?: number; error?: string };

export function listBackups(): BackupInfo[] {
  try {
    return fs
      .readdirSync(backupDir())
      .filter((f) => NAME.test(f))
      .map((name) => {
        const st = fs.statSync(path.join(backupDir(), name));
        return { name, size: st.size, at: st.mtime };
      })
      .sort((a, b) => b.at.getTime() - a.at.getTime());
  } catch {
    return [];
  }
}

export function lastStatus(): BackupStatus | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(backupDir(), "last.json"), "utf8")) as BackupStatus;
  } catch {
    return null;
  }
}

// đường dẫn file sao lưu theo tên (chặn ../ — chỉ tên đúng mẫu)
export function backupPath(name: string): string | null {
  if (!NAME.test(name)) return null;
  const p = path.join(backupDir(), name);
  return fs.existsSync(p) ? p : null;
}

const stampVN = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-"); // 20261121-0200

let running = false;

export async function runDbBackup(reason: string): Promise<BackupStatus> {
  const dir = backupDir();
  const write = (s: BackupStatus) => {
    try {
      fs.writeFileSync(path.join(dir, "last.json"), JSON.stringify(s));
    } catch {}
    console.log(`[sao-luu] ${s.ok ? "OK" : "LỖI"} ${s.reason} ${s.file ?? ""} ${s.error ?? ""}`);
    return s;
  };
  if (running) return { at: new Date().toISOString(), ok: false, reason, error: "Đang có 1 lần sao lưu chạy" };
  running = true;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const fsInfo = fs.statfsSync(dir);
    const free = Number(fsInfo.bavail) * Number(fsInfo.bsize);
    const last = listBackups()[0]?.size ?? 0;
    if (free < last * 1.5 + 500 * 1024 * 1024) {
      return write({ at: new Date().toISOString(), ok: false, reason, error: `Ổ đĩa không đủ chỗ (còn ${(free / 1048576).toFixed(0)} MB) — bỏ qua lần này` });
    }
    const name = `db-${stampVN()}.jsonl.gz`;
    const out = path.join(dir, name);
    const c = pgClient();
    await c.connect();
    try {
      await dumpPg(c, `${out}.part`);
    } finally {
      await c.end();
    }
    fs.renameSync(`${out}.part`, out);
    // giữ KEEP bản mới nhất
    for (const old of listBackups().slice(KEEP())) {
      try {
        fs.unlinkSync(path.join(dir, old.name));
      } catch {}
    }
    return write({ at: new Date().toISOString(), ok: true, reason, file: name, size: fs.statSync(out).size });
  } catch (e) {
    return write({ at: new Date().toISOString(), ok: false, reason, error: e instanceof Error ? e.message : String(e) });
  } finally {
    running = false;
    try {
      for (const f of fs.readdirSync(dir)) if (f.endsWith(".part") || f.startsWith("_tmp-")) fs.unlinkSync(path.join(dir, f));
    } catch {}
  }
}

// Lịch chạy: 02:00 giờ VN mỗi ngày. Chỉ bật ở bản chạy thật (production) hoặc khi đặt BACKUP_DAILY=1; BACKUP_DAILY=0 để tắt.
export function scheduleDailyBackup() {
  const on = process.env.BACKUP_DAILY === "1" || (process.env.NODE_ENV === "production" && process.env.BACKUP_DAILY !== "0");
  if (!on) return;
  const g = globalThis as { __dtcpBackupTimer?: boolean };
  if (g.__dtcpBackupTimer) return;
  g.__dtcpBackupTimer = true;
  const msToNext2AM = () => {
    const nowVN = Date.now() + 7 * 3600 * 1000;
    const d = new Date(nowVN);
    let next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 2, 0, 0);
    if (next <= nowVN) next += 24 * 3600 * 1000;
    return next - nowVN;
  };
  const loop = () => {
    const t = setTimeout(async () => {
      await runDbBackup("tự động 02:00");
      loop();
    }, msToNext2AM());
    t.unref?.();
  };
  loop();
  // khởi động lại server mà bản mới nhất đã cũ (> 26 giờ) → chụp bù sau 5 phút
  const newest = listBackups().find((b) => b.name.endsWith(".jsonl.gz"));
  if (!newest || Date.now() - newest.at.getTime() > 26 * 3600 * 1000) {
    const t = setTimeout(() => void runDbBackup("bù khi khởi động"), 5 * 60 * 1000);
    t.unref?.();
  }
}
