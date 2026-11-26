// KHÔI PHỤC CSDL PostgreSQL từ bản sao lưu .jsonl.gz (Quản trị → Người dùng → Sao lưu dữ liệu, hoặc /data/backups).
//   npx tsx scripts/pg-restore.ts <db-YYYYMMDD-HHmm.jsonl.gz> [--force]
// --force: XOÁ HẾT dữ liệu đang có rồi nạp bản sao lưu. CSDL phải đã có cấu trúc bảng (npx prisma migrate deploy).
import "dotenv/config";
import { assertEmptyOrWipe, pgClient, restorePg, tableCounts } from "../src/lib/pg-copy";

(async () => {
  const src = process.argv[2];
  if (!src) throw new Error("Thiếu đường dẫn file sao lưu .jsonl.gz");
  const c = pgClient();
  await c.connect();
  try {
    await assertEmptyOrWipe(c, process.argv.includes("--force"));
    await restorePg(c, src);
    const n = Object.values(await tableCounts(c)).reduce((a, b) => a + b, 0);
    console.log(`[pg-restore] XONG: ${n} dòng`);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error("[pg-restore] LỖI:", e instanceof Error ? e.message : e);
  process.exit(1);
});
