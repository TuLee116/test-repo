"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { markAiTicketsSeenAction, myAiTicketsAction, rateAiMessageAction } from "@/lib/ai-actions";

type Msg = { id: string; role: "user" | "assistant"; content: string; rating?: number };
type Ticket = { code: string; title: string; status: string; adminNote: string; createdAt: string };

const TICKET_LABEL: Record<string, string> = { PENDING: "Chờ quản trị duyệt", APPROVED: "Đã duyệt — chờ chỉnh sửa", REJECTED: "Không được duyệt", DONE: "Đã xong" };
const HELLO: Msg = {
  id: "hello",
  role: "assistant",
  content: "Chào bạn, mình là Trợ lý DT-CP. Bạn cần hướng dẫn cách dùng phần mềm, hay muốn báo lỗi / đề xuất thêm tính năng? Cứ hỏi nhé.",
};

// Nút nổi "Hỏi trợ lý" ở góc phải dưới mọi trang: hỏi cách dùng (AI tự trả lời) hoặc báo lỗi / xin tính năng (AI lập phiếu gửi quản trị duyệt)
export default function AiAssistant({ enabled, unseen }: { enabled: boolean; unseen: number }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"chat" | "tickets">("chat");
  const [msgs, setMsgs] = useState<Msg[]>([HELLO]);
  const [chatId, setChatId] = useState<string | undefined>();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [dot, setDot] = useState(unseen > 0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs, busy, open, tab]);

  useEffect(() => {
    if (!open || tab !== "tickets") return;
    myAiTicketsAction().then(setTickets);
    markAiTicketsSeenAction().then(() => setDot(false));
  }, [open, tab]);

  if (!enabled) return null;

  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    setText("");
    setMsgs((m) => [...m, { id: `u${Date.now()}`, role: "user", content: message }]);
    setBusy(true);
    try {
      const res = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, message, page: path }) });
      const r = (await res.json()) as { ok: boolean; error?: string; chatId?: string; reply?: { id: string; content: string }; ticketCode?: string };
      if (!r.ok || !r.reply) {
        setMsgs((m) => [...m, { id: `e${Date.now()}`, role: "assistant", content: `⚠ ${r.error ?? "Có lỗi xảy ra"}` }]);
      } else {
        setChatId(r.chatId);
        setMsgs((m) => [...m, { id: r.reply!.id, role: "assistant", content: r.reply!.content, rating: 0 }]);
        if (r.ticketCode) setTickets(null);
      }
    } catch {
      setMsgs((m) => [...m, { id: `e${Date.now()}`, role: "assistant", content: "⚠ Không kết nối được, thử lại sau." }]);
    } finally {
      setBusy(false);
    }
  };

  const rate = async (id: string, rating: number) => {
    setMsgs((m) => m.map((x) => (x.id === id ? { ...x, rating } : x)));
    await rateAiMessageAction(id, rating);
  };

  const reset = () => {
    setMsgs([HELLO]);
    setChatId(undefined);
  };

  return (
    <div className="fixed bottom-4 right-4 z-[70] print:hidden">
      {open && (
        <div className="mb-2 flex h-[520px] max-h-[80vh] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl">
          <div className="flex items-center gap-2 bg-blue-900 px-3 py-2 text-white">
            <span className="flex-1 font-semibold">💬 Trợ lý DT-CP</span>
            <button onClick={reset} className="rounded px-2 py-0.5 text-xs hover:bg-blue-800" title="Bắt đầu cuộc trò chuyện mới">
              ↻ Mới
            </button>
            <button onClick={() => setOpen(false)} className="rounded px-2 text-lg leading-none hover:bg-blue-800" aria-label="Đóng">
              ✕
            </button>
          </div>
          <div className="flex border-b border-slate-200 text-sm">
            {(
              [
                ["chat", "Hỏi đáp"],
                ["tickets", `Yêu cầu của tôi${dot ? " •" : ""}`],
              ] as const
            ).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} className={`flex-1 px-3 py-1.5 ${tab === k ? "border-b-2 border-blue-700 font-medium text-blue-900" : "text-slate-500 hover:bg-slate-50"}`}>
                {label}
              </button>
            ))}
          </div>

          {tab === "chat" ? (
            <>
              <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-3 text-sm">
                {msgs.map((m) => (
                  <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                    <div className={`max-w-[88%] whitespace-pre-wrap rounded-lg px-3 py-2 ${m.role === "user" ? "bg-blue-700 text-white" : "bg-white text-slate-800 ring-1 ring-slate-200"}`}>
                      {m.content}
                      {m.role === "assistant" && m.rating != null && (
                        <div className="mt-1 flex gap-1 text-xs">
                          <button onClick={() => rate(m.id, m.rating === 1 ? 0 : 1)} className={`rounded px-1.5 py-0.5 ${m.rating === 1 ? "bg-emerald-100" : "opacity-50 hover:opacity-100"}`} title="Hữu ích">
                            👍
                          </button>
                          <button onClick={() => rate(m.id, m.rating === -1 ? 0 : -1)} className={`rounded px-1.5 py-0.5 ${m.rating === -1 ? "bg-red-100" : "opacity-50 hover:opacity-100"}`} title="Chưa đúng / chưa hữu ích">
                            👎
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {busy && <div className="text-xs text-slate-500">Trợ lý đang trả lời…</div>}
                <div ref={endRef} />
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
                className="flex items-end gap-2 border-t border-slate-200 p-2"
              >
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={2}
                  placeholder="Nhập câu hỏi… (Enter để gửi, Shift+Enter xuống dòng)"
                  className="flex-1 resize-none rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                />
                <button disabled={busy || !text.trim()} className="rounded-md bg-blue-800 px-3 py-2 text-sm font-medium text-white hover:bg-blue-900 disabled:opacity-40">
                  Gửi
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 overflow-y-auto bg-slate-50 p-3 text-sm">
              {tickets == null ? (
                <p className="text-slate-500">Đang tải…</p>
              ) : tickets.length === 0 ? (
                <p className="text-slate-500">Bạn chưa gửi yêu cầu nào. Báo lỗi hoặc đề xuất tính năng ở tab Hỏi đáp, trợ lý sẽ lập phiếu gửi quản trị.</p>
              ) : (
                <ul className="space-y-2">
                  {tickets.map((t) => (
                    <li key={t.code} className="rounded-lg bg-white p-2 ring-1 ring-slate-200">
                      <div className="flex items-center gap-2">
                        <b>{t.code}</b>
                        <span className="text-xs text-slate-500">{new Date(t.createdAt).toLocaleDateString("vi-VN")}</span>
                      </div>
                      <div className="text-slate-800">{t.title}</div>
                      <div className="text-xs font-medium text-blue-800">{TICKET_LABEL[t.status] ?? t.status}</div>
                      {t.adminNote && <div className="mt-1 rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">Quản trị: {t.adminNote}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      <div className="flex justify-end">
        <button onClick={() => setOpen((o) => !o)} className="relative rounded-full bg-blue-800 px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-blue-900">
          💬 Hỏi trợ lý
          {dot && !open && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-red-600 ring-2 ring-white" />}
        </button>
      </div>
    </div>
  );
}
