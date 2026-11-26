import pg from "pg";
import zlib from "node:zlib";
import fs from "node:fs";
import readline from "node:readline";

// CHÉP / SAO LƯU / KHÔI PHỤC dữ liệu PostgreSQL bằng JS thuần (không cần pg_dump) — 23/11/2026.
// - copyFromSqlite: chép toàn bộ dữ liệu từ file SQLite cũ (prod.db / dev.db / bản sao lưu .db) sang PostgreSQL.
// - dumpPg: ghi toàn bộ dữ liệu ra file .jsonl.gz (mỗi bảng: 1 dòng tiêu đề + mỗi dòng dữ liệu 1 mảng JSON).
// - restorePg: nạp lại file .jsonl.gz vào CSDL trống.
// Kiểu dữ liệu đổi theo kiểu cột PostgreSQL (boolean ← 0/1, timestamp ← chuỗi ISO / số ms, bytea ← Buffer / base64).
// Ngày giờ: Prisma lưu giờ UTC trong cột "timestamp without time zone" → luôn đọc / ghi dạng chuỗi UTC (không để thư viện tự đổi múi giờ máy).

export type Col = { name: string; type: string };
export type TableInfo = { name: string; cols: Col[]; pk: string[] };

const TS_OIDS = [1114, 1184]; // timestamp, timestamptz → giữ nguyên chuỗi
export function pgClient(url = process.env.DATABASE_URL ?? "") {
  return new pg.Client({
    connectionString: url,
    types: { getTypeParser: (oid: number, format?: "text" | "binary") => (TS_OIDS.includes(oid) ? (v: string) => v : pg.types.getTypeParser(oid, format)) },
  });
}

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

export async function pgTables(c: pg.Client): Promise<TableInfo[]> {
  const cols = await c.query<{ table_name: string; column_name: string; data_type: string }>(
    `select table_name, column_name, data_type from information_schema.columns
     where table_schema = 'public' and table_name <> '_prisma_migrations' order by table_name, ordinal_position`,
  );
  const pks = await c.query<{ table_name: string; column_name: string }>(
    `select kcu.table_name, kcu.column_name from information_schema.table_constraints tc
     join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
     where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY' order by kcu.ordinal_position`,
  );
  const map = new Map<string, TableInfo>();
  for (const r of cols.rows) {
    const t = map.get(r.table_name) ?? map.set(r.table_name, { name: r.table_name, cols: [], pk: [] }).get(r.table_name)!;
    t.cols.push({ name: r.column_name, type: r.data_type });
  }
  for (const r of pks.rows) map.get(r.table_name)?.pk.push(r.column_name);
  return [...map.values()];
}

const toUtcText = (d: Date) => d.toISOString().replace("T", " ").replace("Z", "");
// giá trị nguồn → giá trị ghi vào cột PostgreSQL kiểu `type`
export function convert(v: unknown, type: string): unknown {
  if (v === null || v === undefined) return null;
  if (type === "boolean") return v === true || v === 1 || v === "1" || v === "true";
  if (type.startsWith("timestamp")) {
    if (typeof v === "number") return toUtcText(new Date(v));
    const s = String(v);
    if (/^\d+$/.test(s)) return toUtcText(new Date(Number(s)));
    if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) return toUtcText(new Date(s)); // có múi giờ → đổi về UTC
    return s; // đã là giờ UTC không múi giờ (bản sao lưu PostgreSQL)
  }
  if (type === "bytea") {
    if (Buffer.isBuffer(v)) return v;
    if (v instanceof Uint8Array) return Buffer.from(v);
    if (typeof v === "object" && v && "$b" in v) return Buffer.from(String((v as { $b: string }).$b), "base64");
    return Buffer.from(String(v));
  }
  if (type === "double precision" || type === "real" || type === "numeric") return Number(v);
  if (type === "integer" || type === "smallint") return Math.trunc(Number(v));
  if (type === "bigint") return String(v);
  if (type === "jsonb" || type === "json") return typeof v === "string" ? v : JSON.stringify(v);
  return typeof v === "string" ? v : String(v);
}

// ghi nhiều dòng 1 lần (giới hạn ~60.000 tham số / ~16MB mỗi lần)
export async function insertRows(c: pg.Client, t: TableInfo, cols: Col[], rows: unknown[][]) {
  let batch: unknown[][] = [];
  let bytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    const params: unknown[] = [];
    const values = batch.map((r) => `(${r.map((v) => (params.push(v), `$${params.length}`)).join(",")})`);
    await c.query(`insert into ${q(t.name)} (${cols.map((x) => q(x.name)).join(",")}) values ${values.join(",")}`, params);
    batch = [];
    bytes = 0;
  };
  for (const r of rows) {
    const conv = r.map((v, i) => convert(v, cols[i].type));
    batch.push(conv);
    bytes += conv.reduce<number>((a, v) => a + (Buffer.isBuffer(v) ? v.length : typeof v === "string" ? v.length : 8), 0);
    if ((batch.length + 1) * cols.length > 60_000 || bytes > 16 * 1024 * 1024) await flush();
  }
  await flush();
}

// tắt kiểm tra khoá ngoại trong lúc nạp (nạp theo bảng, không cần đúng thứ tự cha → con)
async function loadMode(c: pg.Client, on: boolean) {
  await c.query(`set session_replication_role = ${on ? "replica" : "origin"}`);
}

export async function tableCounts(c: pg.Client): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of await pgTables(c)) out[t.name] = Number((await c.query(`select count(*)::int n from ${q(t.name)}`)).rows[0].n);
  return out;
}

export async function assertEmptyOrWipe(c: pg.Client, force: boolean) {
  const counts = await tableCounts(c);
  const used = Object.entries(counts).filter(([, n]) => n > 0);
  if (!used.length) return;
  if (!force) throw new Error(`CSDL đích đã có dữ liệu (${used.map(([t, n]) => `${t}: ${n}`).slice(0, 5).join(", ")}...) — thêm --force để XOÁ HẾT rồi nạp lại`);
  await c.query(`truncate ${Object.keys(counts).map(q).join(",")} cascade`);
}

// ---- SQLite → PostgreSQL ----
export async function copyFromSqlite(sqlitePath: string, c: pg.Client, log = console.log): Promise<{ table: string; src: number; dst: number }[]> {
  const { default: Database } = await import("better-sqlite3");
  // dồn phần dữ liệu còn nằm trong file nhật ký -wal (server cũ tắt đột ngột) vào file chính trước khi đọc
  try {
    const w = new Database(sqlitePath, { fileMustExist: true });
    w.pragma("wal_checkpoint(TRUNCATE)");
    w.close();
  } catch (e) {
    log(`  ! Không dồn được nhật ký WAL: ${e instanceof Error ? e.message : e} — đọc tiếp`);
  }
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const report: { table: string; src: number; dst: number }[] = [];
  try {
    const srcTables = new Set((db.prepare(`select name from sqlite_master where type = 'table'`).all() as { name: string }[]).map((x) => x.name));
    await c.query("begin");
    await loadMode(c, true);
    for (const t of await pgTables(c)) {
      if (!srcTables.has(t.name)) {
        log(`  - ${t.name}: không có trong SQLite (bảng mới) → bỏ qua`);
        report.push({ table: t.name, src: 0, dst: 0 });
        continue;
      }
      const srcCols = new Set((db.prepare(`pragma table_info(${q(t.name)})`).all() as { name: string }[]).map((x) => x.name));
      const cols = t.cols.filter((x) => srcCols.has(x.name));
      const missing = t.cols.filter((x) => !srcCols.has(x.name)).map((x) => x.name);
      if (missing.length) log(`  ! ${t.name}: SQLite thiếu cột ${missing.join(", ")} → dùng giá trị mặc định`);
      const stmt = db.prepare(`select ${cols.map((x) => q(x.name)).join(",")} from ${q(t.name)}`).raw(true);
      let n = 0;
      let buf: unknown[][] = [];
      for (const r of stmt.iterate() as Iterable<unknown[]>) {
        buf.push(r);
        n++;
        if (buf.length >= (cols.some((x) => x.type === "bytea") ? 10 : 2000)) {
          await insertRows(c, t, cols, buf);
          buf = [];
        }
      }
      await insertRows(c, t, cols, buf);
      const dst = Number((await c.query(`select count(*)::int n from ${q(t.name)}`)).rows[0].n);
      report.push({ table: t.name, src: n, dst });
      log(`  ${dst === n ? "✓" : "✗"} ${t.name}: ${n} → ${dst}`);
    }
    await loadMode(c, false);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    db.close();
  }
  return report;
}

// ---- Sao lưu PostgreSQL → .jsonl.gz ----
export async function dumpPg(c: pg.Client, outPath: string): Promise<{ tables: number; rows: number }> {
  const gz = zlib.createGzip({ level: 6 });
  const file = fs.createWriteStream(outPath);
  gz.pipe(file);
  const write = (s: string) => new Promise<void>((res) => (gz.write(s) ? res() : gz.once("drain", () => res())));
  let rows = 0;
  const tables = await pgTables(c);
  await c.query("begin isolation level repeatable read read only"); // ảnh chụp nhất quán
  try {
    await write(JSON.stringify({ format: "dtcp-pg-dump", version: 1, at: new Date().toISOString() }) + "\n");
    for (const t of tables) {
      await write(JSON.stringify({ table: t.name, cols: t.cols }) + "\n");
      const hasBlob = t.cols.some((x) => x.type === "bytea");
      const page = hasBlob ? 20 : 2000;
      const order = (t.pk.length ? t.pk : t.cols.slice(0, 1).map((x) => x.name)).map(q).join(",");
      for (let off = 0; ; off += page) {
        const r = await c.query({ text: `select * from ${q(t.name)} order by ${order} limit ${page} offset ${off}`, rowMode: "array" });
        for (const row of r.rows as unknown[][]) {
          await write(JSON.stringify(row.map((v) => (Buffer.isBuffer(v) ? { $b: v.toString("base64") } : v))) + "\n");
          rows++;
        }
        if (r.rows.length < page) break;
      }
    }
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => {});
    gz.destroy();
    throw e;
  }
  await new Promise<void>((res, rej) => {
    file.on("finish", () => res());
    file.on("error", rej);
    gz.end();
  });
  return { tables: tables.length, rows };
}

// ---- Khôi phục .jsonl.gz → PostgreSQL (CSDL phải trống hoặc dùng force) ----
export async function restorePg(c: pg.Client, inPath: string, log = console.log) {
  const target = new Map((await pgTables(c)).map((t) => [t.name, t]));
  let cur: { t: TableInfo; cols: Col[]; idx: number[] } | null = null;
  let buf: unknown[][] = [];
  let n = 0;
  const flush = async () => {
    if (cur && buf.length) await insertRows(c, cur.t, cur.cols, buf);
    buf = [];
  };
  await c.query("begin");
  await loadMode(c, true);
  // mở luồng đọc NGAY TRƯỚC vòng đọc (mở sớm rồi await việc khác → các dòng đầu trôi mất, vòng đọc chờ mãi)
  const rl = readline.createInterface({ input: fs.createReadStream(inPath).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      const v = JSON.parse(line);
      if (!Array.isArray(v)) {
        if (v.format) continue;
        await flush();
        if (cur) log(`  ✓ ${cur.t.name}: ${n}`);
        n = 0;
        const t = target.get(v.table);
        if (!t) {
          log(`  ! ${v.table}: không còn trong CSDL → bỏ qua`);
          cur = null;
          continue;
        }
        const srcCols = (v.cols as Col[]).map((x) => x.name);
        const cols = t.cols.filter((x) => srcCols.includes(x.name));
        cur = { t, cols, idx: cols.map((x) => srcCols.indexOf(x.name)) };
        continue;
      }
      if (!cur) continue;
      buf.push(cur.idx.map((i) => v[i]));
      n++;
      if (buf.length >= (cur.cols.some((x) => x.type === "bytea") ? 10 : 2000)) await flush();
    }
    await flush();
    if (cur) log(`  ✓ ${cur.t.name}: ${n}`);
    await loadMode(c, false);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  }
}
