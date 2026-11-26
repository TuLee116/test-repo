// Đặt lại mật khẩu quản trị khi khởi động nếu có biến môi trường ADMIN_RESET_PASSWORD (đặt trong trang Variables của Railway).
// Sau khi đăng nhập được thì XOÁ biến này đi, nếu không mỗi lần khởi động lại mật khẩu sẽ bị đặt lại.
// CSDL PostgreSQL (DATABASE_URL) — từ 23/11/2026.
import pg from "pg";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const pw = process.env.ADMIN_RESET_PASSWORD;
if (!pw) process.exit(0);
if (pw.length < 8) {
  console.error("[reset-admin] ADMIN_RESET_PASSWORD phải từ 8 ký tự — bỏ qua");
  process.exit(0);
}
const username = process.env.ADMIN_RESET_USERNAME || "admin";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const hash = bcrypt.hashSync(pw, 10);
const row = (await c.query('SELECT id FROM "User" WHERE username = $1', [username])).rows[0];
if (row) {
  await c.query('UPDATE "User" SET "passwordHash" = $1, role = $2 WHERE id = $3', [hash, "ADMIN", row.id]);
  console.log(`[reset-admin] Đã đặt lại mật khẩu cho tài khoản "${username}"`);
} else {
  await c.query('INSERT INTO "User" (id, name, username, "passwordHash", role) VALUES ($1, $2, $3, $4, $5)', ["c" + randomBytes(12).toString("hex"), "Quản trị viên", username, hash, "ADMIN"]);
  console.log(`[reset-admin] Đã tạo tài khoản quản trị "${username}"`);
}
await c.end();
