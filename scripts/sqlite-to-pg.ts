// CHÉP DỮ LIỆU từ file SQLite cũ sang PostgreSQL (DATABASE_URL) — chạy 1 lần khi chuyển CSDL (23/11/2026).
//   npx tsx scripts/sqlite-to-pg.ts <file.db> [--force]
// CSDL đích phải đã có cấu trúc bảng (npx prisma migrate deploy). Đích đã có dữ liệu thì dừng, trừ khi --force (XOÁ HẾT rồi nạp lại).
import "dotenv/config";
import { assertEmptyOrWipe, copyFromSqlite, pgClient } from "../src/lib/pg-copy";

(async () => {
  const src = process.argv[2];
  const force = process.argv.includes("--force");
  if (!src) throw new Error("Thiếu đường dẫn file SQLite");
  const c = pgClient();
  await c.connect();
  try {
    await assertEmptyOrWipe(c, force);
    console.log(`[sqlite-to-pg] Chép ${src} → PostgreSQL`);
    const rep = await copyFromSqlite(src, c);
    const bad = rep.filter((r) => r.src !== r.dst);
    const total = rep.reduce((a, r) => a + r.dst, 0);
    if (bad.length) throw new Error(`Lệch số dòng: ${bad.map((b) => `${b.table} ${b.src}→${b.dst}`).join(", ")}`);
    console.log(`[sqlite-to-pg] XONG: ${rep.length} bảng, ${total} dòng, số dòng khớp từng bảng`);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error("[sqlite-to-pg] LỖI:", e instanceof Error ? e.message : e);
  process.exit(1);
});
