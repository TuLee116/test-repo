"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseEmails } from "@/lib/email-list";
import { useTaskWorkspace } from "@/app/(app)/TaskWorkspace";

// QSTT soạn mail kết quả: phần mềm tạo thư nháp (.eml) có sẵn người nhận / CC / tiêu đề / nội dung và ĐÍNH KÈM PDF hồ sơ duyệt
// → trình duyệt tải về và mở bằng Outlook (cửa sổ soạn thư, chưa gửi) → QSTT kiểm tra rồi bấm Send trong Outlook.
export default function MailPanel({
  build,
  pdfHref,
  attachLabel = "file PDF hồ sơ duyệt",
  initTo,
  initCc,
  sentAt,
}: {
  build: (to: string, cc: string, note: string) => Promise<{ ok: true; file?: { name: string; base64: string } } | { ok: false; error: string }>;
  pdfHref?: string;
  attachLabel?: string;
  initTo: string;
  initCc: string;
  sentAt: string;
}) {
  const router = useRouter();
  const ws = useTaskWorkspace();
  const [pending, start] = useTransition();
  const [to, setTo] = useState(initTo);
  const [cc, setCc] = useState(initCc);
  const [note, setNote] = useState("");
  const [done, setDone] = useState("");
  const inp = "mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
  const pt = parseEmails(to);
  const pc = parseEmails(cc);
  // kết quả đọc danh sách người nhận: dán thẳng từ Outlook (Tên <địa chỉ>; ...) được, phần mềm tự lấy địa chỉ
  const hint = (p: ReturnType<typeof parseEmails>) =>
    p.ok.length || p.bad.length ? (
      <span className="mt-1 block text-xs">
        {p.ok.length > 0 && <span className="text-emerald-700">✓ {p.ok.length} địa chỉ: {p.ok.join("; ")}</span>}
        {p.bad.length > 0 && <span className="ml-2 text-red-600">⚠ không hợp lệ: {p.bad.join("; ")}</span>}
      </span>
    ) : null;
  return (
    <section className="rounded-lg border border-sky-200 bg-sky-50/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium text-slate-900">✉ Gửi mail kết quả qua Outlook</h2>
        <span className="flex-1" />
        {pdfHref && (
          <a href={pdfHref} target="_blank" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            📄 Xem PDF duyệt
          </a>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Bấm <b>Soạn mail Outlook</b>: phần mềm tạo thư nháp có sẵn người nhận, nội dung và <b>đính kèm {attachLabel}</b> → mở file thư vừa tải về, Outlook hiện cửa sổ soạn thư → kiểm tra rồi bấm <b>Send</b>.
        <b>Chữ ký:</b> thư không ghi sẵn tên người gửi — trong cửa sổ soạn thư bấm <b>Message → Signature</b> rồi chọn chữ ký công ty của mình, chữ ký tự vào cuối thư.
        Mẹo: lần đầu, ở thanh tải xuống của Chrome bấm vào file .eml → chọn <i>&quot;Luôn mở loại tệp này&quot;</i>, các lần sau Outlook tự bật lên.
        {sentAt && <span className="text-emerald-700"> Đã soạn mail lần gần nhất: {sentAt}.</span>}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-medium text-slate-700">Gửi tới *</span>
          <textarea className={inp} rows={3} value={to} onChange={(e) => setTo(e.target.value)} placeholder="Dán thẳng từ Outlook, VD: Vinh, Doan Ngoc (BQLDADN) <vinhdn@sungroup.com.vn>; Hung, Nguyen Phu (BQLDADN) <hungnp@sungroup.com.vn> — hoặc chỉ địa chỉ: a@x.vn; b@y.vn" />
          {hint(pt)}
        </label>
        <label className="text-sm">
          <span className="font-medium text-slate-700">CC</span>
          <textarea className={inp} rows={3} value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Dán danh sách CC (cùng cách nhập như ô Gửi tới)" />
          {hint(pc)}
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="font-medium text-slate-700">Ghi chú thêm (đưa vào nội dung mail)</span>
          <textarea className={inp} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          className="rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
          onClick={() =>
            start(async () => {
              const r = await build(to, cc, note);
              if (!r.ok) return window.alert(r.error);
              if (!("file" in r) || !r.file) return;
              const bytes = Uint8Array.from(atob(r.file.base64), (ch) => ch.charCodeAt(0));
              const url = URL.createObjectURL(new Blob([bytes], { type: "message/rfc822" }));
              const a = document.createElement("a");
              a.href = url;
              a.download = r.file.name;
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 10000);
              setDone(r.file.name);
              // đang ở cửa sổ làm việc (tác vụ gửi mail): soạn mail xong = hoàn thành → về màn hình chính
              if (ws) setTimeout(() => ws.done("Đã soạn mail Outlook gửi kết quả"), 800);
              else router.refresh();
            })
          }
        >
          {pending ? "Đang tạo thư..." : "📧 Soạn mail Outlook (có đính kèm)"}
        </button>
        {done && (
          <span className="text-xs text-emerald-700">
            ✓ Đã tạo thư nháp <b>{done}</b> — mở file vừa tải về để Outlook hiện cửa sổ gửi mail.
          </span>
        )}
      </div>
    </section>
  );
}
