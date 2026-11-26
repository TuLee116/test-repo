// Lỗi gần nhất của từng phiên đăng nhập (giữ trong bộ nhớ máy chủ 2 phút) — xem src/instrumentation.ts
type Saved = { message: string; digest: string; path: string; kind: string; at: number };
const g = globalThis as unknown as { __tmnErrors?: Map<string, Saved> };
const store = (g.__tmnErrors ??= new Map());
const TTL = 2 * 60 * 1000;

// khoá phiên = giá trị cookie đăng nhập (Auth.js), không có thì bỏ qua
export function sessionKey(cookieHeader: string): string {
  const m = cookieHeader.match(/(?:__Secure-)?authjs\.session-token(?:\.\d+)?=([^;]+)/);
  return m ? m[1].slice(-64) : "";
}

export function rememberError(cookieHeader: string, e: Omit<Saved, "at">) {
  const k = sessionKey(cookieHeader);
  if (!k) return;
  const now = Date.now();
  for (const [key, v] of store) if (now - v.at > TTL) store.delete(key);
  store.set(k, { ...e, at: now });
}

export function takeError(cookieHeader: string): Saved | null {
  const k = sessionKey(cookieHeader);
  const v = k ? store.get(k) : undefined;
  if (!v || Date.now() - v.at > TTL) return null;
  store.delete(k);
  return v;
}
