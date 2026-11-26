import { NextResponse } from "next/server";
import { takeError } from "@/lib/error-store";

// Trả về lỗi máy chủ gần nhất của phiên đăng nhập này (để hộp báo lỗi hiện đúng lý do khi chạy bản production)
export async function GET(req: Request) {
  const e = takeError(req.headers.get("cookie") ?? "");
  return NextResponse.json(e ? { message: e.message, digest: e.digest } : {}, { headers: { "Cache-Control": "no-store" } });
}
