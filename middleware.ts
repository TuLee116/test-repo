import { NextResponse, type NextRequest } from "next/server";

// Password protection for the whole site (the data is internal).
// Set BASIC_AUTH_USER and BASIC_AUTH_PASSWORD in the environment (e.g. Railway variables).
// In production, if they are not set, the site refuses every request instead of exposing the data.
export function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !pass) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("Chưa cấu hình BASIC_AUTH_USER / BASIC_AUTH_PASSWORD.", { status: 503 });
    }
    return NextResponse.next();
  }
  const header = req.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const [u, ...rest] = atob(encoded).split(":");
    if (u === user && rest.join(":") === pass) return NextResponse.next();
  }
  return new NextResponse("Cần đăng nhập.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="TMN", charset="UTF-8"' },
  });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
