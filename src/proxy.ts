import { auth } from "@/auth";
import { NextResponse } from "next/server";

export const proxy = auth((req) => {
  if (!req.auth) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
});

export const config = {
  // api/import/* bị loại ra: các route này tự kiểm tra đăng nhập riêng (trả JSON 401, phù hợp cho
  // fetch() hơn là redirect sang trang login), và quan trọng hơn là để tránh bị proxy của Next 16 đệm
  // thân request vào bộ nhớ với giới hạn mặc định 10MB (proxyClientMaxBodySize) rồi cắt cụt file Excel
  // BOQ/báo giá/định mức lớn hơn 10MB, gây lỗi "Failed to fetch" khi tải lên. api/boq-images cũng tự kiểm tra đăng nhập.
  // tmn-logo.png: logo hiện trên trang đăng nhập (chưa đăng nhập vẫn xem được)
  matcher: ["/((?!api/auth|api/import|api/boq-images|login|_next/static|_next/image|favicon.ico|tmn-logo.png).*)"],
};
