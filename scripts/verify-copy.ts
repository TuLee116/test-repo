// ĐỐI CHIẾU SÂU dữ liệu SQLite (nguồn) với PostgreSQL (DATABASE_URL) sau khi chép — từng cột của từng bảng:
// số: tổng · đúng/sai: số dòng đúng · ngày giờ: nhỏ nhất / lớn nhất (UTC, mili giây) · chữ: tổng độ dài · file (bytea): tổng dung lượng.
//   npx tsx scripts/verify-copy.ts <file.db>
import "dotenv/config";
import Database from "better-sqlite3";
import { pgClient, pgTables } from "../src/lib/pg-copy";

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const ms = (v: unknown) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const s = String(v);
  if (/^\d+$/.test(s)) return Number(s);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(" ", "T")}Z`).getTime();
};

(async () => {
  const src = process.argv[2];
  if (!src) throw new Error("Thiếu đường dẫn file SQLite");
  const db = new Database(src, { readonly: true, fileMustExist: true });
  const c = pgClient();
  await c.connect();
  const srcTables = new Set((db.prepare(`select name from sqlite_master where type='table'`).all() as { name: string }[]).map((x) => x.name));
  let bad = 0;
  let checked = 0;
  for (const t of await pgTables(c)) {
    if (!srcTables.has(t.name)) continue;
    const have = new Set((db.prepare(`pragma table_info(${q(t.name)})`).all() as { name: string }[]).map((x) => x.name));
    for (const col of t.cols.filter((x) => have.has(x.name))) {
      const n = q(col.name);
      let a: unknown;
      let b: unknown;
      if (col.type === "boolean") {
        a = (db.prepare(`select count(*) v from ${q(t.name)} where ${n} in (1,'1','true')`).get() as { v: number }).v;
        b = Number((await c.query(`select count(*) v from ${q(t.name)} where ${n}`)).rows[0].v);
      } else if (["double precision", "integer", "bigint", "real", "numeric", "smallint"].includes(col.type)) {
        a = Number((db.prepare(`select total(${n}) v from ${q(t.name)}`).get() as { v: number }).v);
        b = Number((await c.query(`select coalesce(sum(${n}),0)::float8 v from ${q(t.name)}`)).rows[0].v);
      } else if (col.type.startsWith("timestamp")) {
        const vals = (db.prepare(`select ${n} v from ${q(t.name)} where ${n} is not null`).all() as { v: unknown }[]).map((x) => ms(x.v)!);
        a = vals.length ? `${Math.min(...vals)}|${Math.max(...vals)}|${vals.length}` : "-";
        const r = (await c.query(`select min(${n})::text mn, max(${n})::text mx, count(${n})::int k from ${q(t.name)}`)).rows[0];
        b = r.k ? `${ms(r.mn)}|${ms(r.mx)}|${r.k}` : "-";
      } else if (col.type === "bytea") {
        a = (db.prepare(`select coalesce(sum(length(${n})),0) v from ${q(t.name)}`).get() as { v: number }).v;
        b = Number((await c.query(`select coalesce(sum(octet_length(${n})),0)::bigint v from ${q(t.name)}`)).rows[0].v);
      } else {
        // chữ: tổng số ký tự (SQLite length() đếm ký tự UTF-8 như PostgreSQL char_length)
        a = (db.prepare(`select coalesce(sum(length(${n})),0) v, count(${n}) k from ${q(t.name)}`).get() as { v: number; k: number }) as unknown;
        const r = (await c.query(`select coalesce(sum(char_length(${n}::text)),0)::bigint v, count(${n})::int k from ${q(t.name)}`)).rows[0];
        a = `${(a as { v: number; k: number }).v}|${(a as { v: number; k: number }).k}`;
        b = `${Number(r.v)}|${r.k}`;
      }
      checked++;
      // số thực: tổng cộng theo thứ tự khác nhau lệch ở chữ số cuối (sai số làm tròn của máy) → so với dung sai tương đối 1e-9
      const numeric = typeof a === "number" && typeof b === "number";
      const same = numeric ? Math.abs((a as number) - (b as number)) <= 1e-9 * Math.max(1, Math.abs(a as number), Math.abs(b as number)) : String(a) === String(b);
      if (!same) {
        bad++;
        console.log(`  ✗ ${t.name}.${col.name} (${col.type}): SQLite ${a} ≠ PostgreSQL ${b}`);
      }
    }
  }
  await c.end();
  db.close();
  console.log(bad ? `[verify] ${bad}/${checked} cột LỆCH` : `[verify] KHỚP toàn bộ ${checked} cột`);
  if (bad) process.exit(1);
})().catch((e) => {
  console.error("[verify] LỖI:", e instanceof Error ? e.message : e);
  process.exit(1);
});
