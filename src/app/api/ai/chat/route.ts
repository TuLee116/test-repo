import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { aiEnabled, runAiChat } from "@/lib/ai-assistant";

export const maxDuration = 120;

// Trợ lý AI: nhận câu hỏi, trả lời (có thể lập phiếu yêu cầu). Chỉ người đã đăng nhập.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ ok: false, error: "Chưa đăng nhập" }, { status: 401 });
  if (!aiEnabled()) return Response.json({ ok: false, error: "Trợ lý AI chưa được bật (quản trị chưa cài khóa API)." });
  const body = (await req.json().catch(() => null)) as { chatId?: string; message?: string; page?: string } | null;
  const u = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, name: true, role: true, position: true, apps: true, priceRoles: true, subRoles: true, dtcpPerms: true, procRoles: true, areas: true } });
  if (!u) return Response.json({ ok: false, error: "Không tìm thấy tài khoản" }, { status: 401 });
  const r = await runAiChat(u, { chatId: body?.chatId, message: body?.message ?? "", page: body?.page ?? "" });
  return Response.json(r);
}
