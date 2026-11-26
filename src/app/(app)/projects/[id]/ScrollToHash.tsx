"use client";

import { useEffect } from "react";

// Vào trang có #neo (VD từ link đơn giá ở tab BOQ): chờ dòng đích xuất hiện (trang có thể tải chậm), cuộn tới đó,
// tô đậm dòng + ô đích và bôi chọn chữ trong ô. Hiệu ứng giữ nguyên cho tới khi người dùng bấm chuột / gõ phím.
export default function ScrollToHash() {
  useEffect(() => {
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let clearFn: (() => void) | null = null;
    let tries = 0;

    function highlight(el: HTMLElement) {
      const row = el.closest("tr");
      // sau khi bố cục ổn định (độ rộng cột, ô nhập...) mới cuộn và đánh dấu
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
          timers.push(
            setTimeout(() => {
              if (cancelled) return;
              el.scrollIntoView({ block: "center", inline: "center" }); // chốt lại vị trí nếu bố cục còn dịch chuyển
              row?.classList.add("link-hit-row");
              if (el !== row) {
                el.classList.add("link-hit-cell");
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.selectAllChildren(el);
              }
              const clear = () => {
                row?.classList.remove("link-hit-row");
                el.classList.remove("link-hit-cell");
                window.getSelection()?.removeAllRanges();
                document.removeEventListener("pointerdown", clear, true);
                document.removeEventListener("keydown", clear, true);
                clearFn = null;
                history.replaceState(null, "", window.location.pathname + window.location.search);
              };
              document.addEventListener("pointerdown", clear, true);
              document.addEventListener("keydown", clear, true);
              clearFn = clear;
            }, 700)
          );
        }, 500)
      );
    }

    // Kiểm tra định kỳ tối đa ~20 giây cho tới khi thấy dòng đích
    poll = setInterval(() => {
      tries++;
      const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
      const el = id ? document.getElementById(id) : null;
      if (el) {
        if (poll) clearInterval(poll);
        poll = null;
        highlight(el);
      } else if (tries > 130 || (!id && tries > 20)) {
        if (poll) clearInterval(poll);
        poll = null;
      }
    }, 150);

    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
      timers.forEach(clearTimeout);
      clearFn?.();
    };
  }, []);
  return null;
}
