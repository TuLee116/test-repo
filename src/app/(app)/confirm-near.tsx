"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

// Hộp xác nhận hiện NGAY CẠNH chỗ người dùng vừa bấm (thay window.confirm luôn bật ở giữa trên cùng màn
// hình, phải đưa chuột đi xa). Dùng: if (!(await confirmNear("Xoá dòng này?"))) return;
// Enter = đồng ý, Esc / bấm ra ngoài = huỷ. Nội dung có chữ "xoá" → nút đồng ý màu đỏ.

let lastPoint: { x: number; y: number } | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", (e) => (lastPoint = { x: e.clientX, y: e.clientY }), true);
  // mở bằng bàn phím (Enter / Space trên nút đang focus) → lấy vị trí ô đang focus
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return;
      const r = el.getBoundingClientRect();
      lastPoint = { x: r.left + r.width / 2, y: r.bottom };
    },
    true
  );
}

export function confirmNear(message: string, opts: { okLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (ok: boolean) => {
      root.unmount();
      host.remove();
      resolve(ok);
    };
    const danger = opts.danger ?? /xo[aá]|bỏ|huỷ|hủy/i.test(message);
    const text = message.replace(/^⚠\s*/, "");
    // nhãn nút: câu hỏi "Xoá ...?" → "Xoá"; "... Tiếp tục?" → "Tiếp tục"; còn lại "Đồng ý"
    const okLabel = opts.okLabel ?? (/tiếp tục\?\s*$/i.test(text) ? "Tiếp tục" : /^(bạn có chắc chắn muốn )?xo[aá](?=\s|$)/i.test(text) ? "Xoá" : "Đồng ý");
    root.render(<ConfirmPopover text={text} danger={danger} okLabel={okLabel} at={lastPoint} onDone={done} />);
  });
}

function ConfirmPopover({ text, danger, okLabel, at, onDone }: { text: string; danger: boolean; okLabel: string; at: { x: number; y: number } | null; onDone: (ok: boolean) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // đặt hộp ngay dưới-phải chỗ bấm; thiếu chỗ thì lật lên trên / dịch sang trái, luôn nằm trong màn hình
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const p = at ?? { x: vw / 2, y: vh / 3 };
    const left = Math.min(Math.max(8, p.x - 24), vw - w - 8);
    const top = p.y + 12 + h <= vh - 8 ? p.y + 12 : Math.max(8, p.y - 12 - h);
    setPos({ left, top });
  }, [at]);

  useEffect(() => {
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onDone(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDone]);

  return (
    <div className="fixed inset-0 z-[1000]" onMouseDown={() => onDone(false)}>
      <div
        ref={boxRef}
        role="alertdialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}
        className="fixed w-[340px] max-w-[calc(100vw-16px)] rounded-lg border border-slate-300 bg-white p-3 text-sm shadow-xl"
      >
        <div className="flex gap-2">
          <span className={danger ? "text-red-600" : "text-amber-600"}>⚠</span>
          <div className="whitespace-pre-line text-slate-800">{text}</div>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={() => onDone(false)} className="rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50">
            Huỷ (Esc)
          </button>
          <button
            ref={okRef}
            type="button"
            onClick={() => onDone(true)}
            className={`rounded-md px-3 py-1 text-xs font-medium text-white ${danger ? "bg-red-600 hover:bg-red-700" : "bg-slate-900 hover:bg-slate-800"}`}
          >
            {okLabel} (Enter)
          </button>
        </div>
      </div>
    </div>
  );
}
