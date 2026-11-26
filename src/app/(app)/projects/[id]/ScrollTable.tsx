"use client";

import { useEffect, useRef, useState } from "react";

// Bảng rộng: thanh cuộn ngang đặt phía TRÊN (đồng bộ với thanh dưới) và vùng cuộn có chiều cao
// giới hạn để các dòng tiêu đề sticky luôn hiện khi kéo xuống.
export default function ScrollTable({ children }: { children: React.ReactNode }) {
  const topRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const measure = () => setWidth(main.scrollWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(main);
    if (main.firstElementChild) ro.observe(main.firstElementChild);
    return () => ro.disconnect();
  }, []);

  // Khung bảng cao vừa hết phần còn lại của màn hình → chỉ cuộn trong bảng, dòng tiêu đề luôn nằm sát phía trên
  useEffect(() => {
    let raf = 0;
    let lastHeight = -1;
    const fit = () => {
      const main = mainRef.current;
      if (!main) return;
      const top = main.getBoundingClientRect().top;
      // trong cửa sổ làm việc toàn màn hình: chừa chỗ cho thanh Trình / Duyệt dính đáy
      const reserve = main.closest(".task-ws") ? 76 : 20;
      const next = Math.max(320, Math.round(window.innerHeight - top - reserve));
      if (next !== lastHeight) {
        lastHeight = next;
        setHeight(next);
      }
    };
    // Cuộn trang ngoài bắn hàng chục-hàng trăm sự kiện/giây - gộp lại chỉ tính 1 lần mỗi khung hình
    // (requestAnimationFrame) thay vì tính lại (forced layout + re-render bảng lớn) trên từng sự kiện,
    // tránh giật khi kéo thanh cuộn ngoài.
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    };
    fit();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { passive: true, capture: true }); // capture: bắt cả cuộn trong cửa sổ làm việc
    const ro = new ResizeObserver(schedule);
    ro.observe(document.body);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      ro.disconnect();
    };
  }, []);

  return (
    <div>
      <div
        ref={topRef}
        onScroll={(e) => mainRef.current && (mainRef.current.scrollLeft = e.currentTarget.scrollLeft)}
        className="overflow-x-auto overflow-y-hidden"
        style={{ height: 16 }}
      >
        <div style={{ width, height: 1 }} />
      </div>
      <div
        ref={mainRef}
        onScroll={(e) => topRef.current && (topRef.current.scrollLeft = e.currentTarget.scrollLeft)}
        className="min-h-[320px] overflow-auto"
        style={{ height: height ?? undefined, maxHeight: height ?? "calc(100vh - 230px)" }}
      >
        {children}
      </div>
    </div>
  );
}
