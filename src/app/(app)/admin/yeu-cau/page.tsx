import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { fmtDateTime } from "@/lib/proc";
import { Section, Empty } from "../../mua-vat-tu/ui";
import TicketActions from "./TicketActions";

const AI_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Chờ duyệt", cls: "bg-amber-100 text-amber-800" },
  APPROVED: { label: "Đã duyệt — chờ làm", cls: "bg-sky-100 text-sky-800" },
  REJECTED: { label: "Từ chối", cls: "bg-red-100 text-red-800" },
  DONE: { label: "Đã xong", cls: "bg-emerald-100 text-emerald-800" },
};

// QUẢN TRỊ: duyệt phiếu yêu cầu (lỗi / bổ sung tính năng) do Trợ lý AI lập. Duyệt xong mới chỉnh sửa phần mềm.
export default async function AiTicketsPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/projects");
  const { s } = await searchParams;
  const filter = s && AI_STATUS[s] ? s : "";
  const [tickets, counts, bad] = await Promise.all([
    prisma.aiTicket.findMany({ where: filter ? { status: filter } : {}, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.aiTicket.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.aiMessage.findMany({ where: { rating: -1 }, orderBy: { createdAt: "desc" }, take: 20, include: { chat: { select: { userName: true, page: true } } } }),
  ]);
  const cnt = (k: string) => counts.find((c) => c.status === k)?._count._all ?? 0;
  const tabs: [string, string][] = [["", "Tất cả"], ...Object.entries(AI_STATUS).map(([k, v]): [string, string] => [k, v.label])];
  return (
    <div className="space-y-4">
      <Section title="Yêu cầu từ người dùng (do Trợ lý AI lập)">
        <div className="flex flex-wrap gap-2 p-3">
          {tabs.map(([k, label]) => (
            <a key={k} href={k ? `/admin/yeu-cau?s=${k}` : "/admin/yeu-cau"} className={`rounded-full px-3 py-1 text-sm ${filter === k ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
              {label} {k ? `(${cnt(k)})` : ""}
            </a>
          ))}
        </div>
        {!tickets.length ? (
          <Empty>Chưa có phiếu nào.</Empty>
        ) : (
          <ul className="divide-y divide-slate-200">
            {tickets.map((t) => (
              <li key={t.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{t.code}</b>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${AI_STATUS[t.status]?.cls}`}>{AI_STATUS[t.status]?.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${t.kind === "BUG" ? "bg-red-50 text-red-700" : "bg-violet-50 text-violet-700"}`}>{t.kind === "BUG" ? "Lỗi" : "Tính năng"}</span>
                  <span className="text-sm text-slate-500">
                    {t.userName} · {fmtDateTime(t.createdAt)}
                    {t.page ? ` · trang ${t.page}` : ""}
                  </span>
                </div>
                <p className="mt-1 font-medium text-slate-900">{t.title}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{t.detail}</p>
                {t.proposal && (
                  <p className="mt-2 whitespace-pre-wrap rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900">
                    <b>Hướng xử lý đề xuất (người dùng đã đồng ý):</b> {t.proposal}
                  </p>
                )}
                <TicketActions key={`${t.id}-${t.status}`} id={t.id} status={t.status} note={t.adminNote} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Câu trả lời bị đánh giá 👎 gần đây (sổ tay còn thiếu hoặc sai)">
        {!bad.length ? (
          <Empty>Chưa có.</Empty>
        ) : (
          <ul className="divide-y divide-slate-200">
            {bad.map((m) => (
              <li key={m.id} className="p-3 text-sm">
                <span className="text-slate-500">
                  {m.chat.userName} · {fmtDateTime(m.createdAt)}
                  {m.chat.page ? ` · ${m.chat.page}` : ""}
                </span>
                <p className="mt-1 whitespace-pre-wrap text-slate-800">{m.content}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
