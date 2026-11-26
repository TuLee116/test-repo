import { type Instrumentation } from "next";
import { rememberError } from "@/lib/error-store";

// Bản chạy thật (production) Next ẩn nội dung lỗi gửi về trình duyệt → ghi lại lỗi cuối cùng của từng phiên đăng nhập,
// hộp báo lỗi phía trình duyệt hỏi lại /api/last-error để hiện đúng lý do (VD "Bạn không có quyền...").
// Đồng thời ghi mọi lỗi vào file logs/loi-he-thong.log (kèm mã lỗi) để tra cứu khi người dùng gửi ảnh chụp.
// Lỗi NGOÀI request (promise bị từ chối không ai bắt, lỗi trong thư viện đọc Excel chạy nền...) — mặc định Node TẮT HẲN server.
// Ghi lỗi vào logs/loi-he-thong.log và GIỮ server chạy tiếp (anh báo 11/11/2026: nhập Excel thầu phụ bị tắt server, không có log).
// Riêng lỗi HẾT BỘ NHỚ (heap out of memory) không bắt được → file .bat chạy node với --max-old-space-size.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { appendFileSync, mkdirSync } = await import("node:fs");
  const write = (kind: string, err: unknown) => {
    const msg = err instanceof Error ? `${err.message}\n${(err.stack ?? "").split("\n").slice(1, 10).join("\n")}` : String(err);
    const line = `[${new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}] [${kind}] ${msg}`;
    console.error(line);
    try {
      mkdirSync("logs", { recursive: true });
      appendFileSync("logs/loi-he-thong.log", `${line}\n`, "utf8");
    } catch {
      /* bỏ qua */
    }
  };
  process.on("unhandledRejection", (e) => write("unhandledRejection", e));
  process.on("uncaughtException", (e) => write("uncaughtException", e));
  // SAO LƯU CSDL TỰ ĐỘNG 02:00 mỗi ngày (src/lib/db-backup.ts) — lỗi không chặn khởi động
  try {
    const { scheduleDailyBackup } = await import("@/lib/db-backup");
    scheduleDailyBackup();
  } catch (e) {
    write("backup-schedule", e);
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const message = err instanceof Error ? err.message : String(err);
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : "";
  const cookie = request.headers["cookie"];
  rememberError(Array.isArray(cookie) ? cookie.join("; ") : cookie ?? "", { message, digest, path: request.path, kind: context.routeType });
  const line = `[${new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}] [${context.routeType}] ${request.method} ${request.path}${digest ? ` (mã ${digest})` : ""}: ${message}`;
  console.error(line);
  if (process.env.NEXT_RUNTIME !== "nodejs") return; // file log chỉ ghi được ở máy chủ Node (không phải Edge)
  try {
    const { appendFile, mkdir } = await import("node:fs/promises");
    await mkdir("logs", { recursive: true });
    const stack = err instanceof Error && err.stack ? `\n${err.stack.split("\n").slice(1, 8).join("\n")}` : "";
    await appendFile("logs/loi-he-thong.log", `${line}${stack}\n`, "utf8");
  } catch {
    /* không ghi được file log thì bỏ qua */
  }
};
