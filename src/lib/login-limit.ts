// Chống dò mật khẩu: đếm số lần đăng nhập sai theo TÊN ĐĂNG NHẬP và theo IP.
// - Sai 5 lần liền với 1 tên đăng nhập → khoá tên đó 15 phút (kể cả nhập đúng mật khẩu cũng không vào được).
// - 1 IP sai tổng cộng 20 lần (thử nhiều tên khác nhau) → khoá IP đó 15 phút.
// Lưu trong bộ nhớ server (Railway chạy 1 bản duy nhất): khởi động lại server thì bộ đếm về 0 — chấp nhận được.

const MAX_USER_FAILS = 5;
const MAX_IP_FAILS = 20;
const WINDOW_MS = 15 * 60 * 1000; // các lần sai tính trong 15 phút gần nhất
const LOCK_MS = 15 * 60 * 1000;

type Entry = { fails: number; first: number; lockedUntil: number };

const g = globalThis as unknown as { __loginLimit?: Map<string, Entry> };
const store = (g.__loginLimit ??= new Map<string, Entry>());

function get(key: string, now: number): Entry {
  let e = store.get(key);
  if (!e || (e.lockedUntil <= now && now - e.first > WINDOW_MS)) {
    e = { fails: 0, first: now, lockedUntil: 0 };
    store.set(key, e);
  }
  return e;
}

function prune(now: number) {
  if (store.size < 5000) return;
  for (const [k, e] of store) if (e.lockedUntil <= now && now - e.first > WINDOW_MS) store.delete(k);
}

const userKey = (u: string) => "u:" + u.trim().toLowerCase();
const ipKey = (ip: string) => "ip:" + ip;

/** Còn bị khoá thì trả về số phút phải chờ, không thì 0. */
export function lockedMinutes(username: string, ip: string): number {
  const now = Date.now();
  const until = Math.max(get(userKey(username), now).lockedUntil, get(ipKey(ip), now).lockedUntil);
  return until > now ? Math.ceil((until - now) / 60000) : 0;
}

/** Ghi nhận 1 lần sai. Trả về số lần còn được thử với tên đăng nhập này (0 = vừa bị khoá). */
export function recordFailure(username: string, ip: string): number {
  const now = Date.now();
  prune(now);
  const u = get(userKey(username), now);
  const i = get(ipKey(ip), now);
  u.fails++;
  i.fails++;
  if (u.fails >= MAX_USER_FAILS) u.lockedUntil = now + LOCK_MS;
  if (i.fails >= MAX_IP_FAILS) i.lockedUntil = now + LOCK_MS;
  return Math.max(0, MAX_USER_FAILS - u.fails);
}

/** Đăng nhập đúng → xoá bộ đếm của tên đăng nhập đó. */
export function recordSuccess(username: string) {
  store.delete(userKey(username));
}

export function clientIp(headers: Headers | undefined): string {
  if (!headers) return "unknown";
  return headers.get("x-real-ip") || headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}
