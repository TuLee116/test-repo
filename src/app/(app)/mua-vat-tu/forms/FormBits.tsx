// Không import "@/lib/proc" (có prisma/auth) để dùng được cả trong component client (màn hình lập phiếu)
const fmtDate = (d: Date | null | undefined) => (d ? d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "");

// Khung chung hiển thị biểu mẫu của phân hệ Mua vật tư theo mẫu Excel thật (xem & duyệt trên app, không in ký tay):
// chữ Times New Roman, kẻ bảng đen; phần "ký" thay bằng trạng thái duyệt trên phần mềm.

export function FormSheet({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <style>{`
        .tmn-form { font-family: "Times New Roman", Times, serif; color: #000; }
        .tmn-form table.tmn-grid { border-collapse: collapse; width: 100%; }
        .tmn-form table.tmn-grid th, .tmn-form table.tmn-grid td { border: 1px solid #000; padding: 2px 4px; }
        .tmn-form .num { text-align: right; white-space: nowrap; }
      `}</style>
      <div className="tmn-form min-w-[1000px] p-5">{children}</div>
    </div>
  );
}

export function FormLetterhead() {
  return (
    <div className="relative border-b-2 border-black pb-1 text-center leading-tight">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/tmn-logo.png" alt="TMN" className="absolute left-2 top-1 h-16 w-auto" />
      <p className="text-[15px] font-bold">CÔNG TY CỔ PHẦN XÂY DỰNG KIẾN TRÚC TÂN MINH NHÂN</p>
      <p className="text-[13px] font-bold">Trụ sở chính: Tổ 3, Khối Ngân Giang, Phường Điện Bàn Đông, TP. Đà Nẵng</p>
      <p className="text-[13px] font-bold">VPĐD: 246-248-250 Lê Văn Hiến, P. Ngũ Hành Sơn, TP Đà Nẵng</p>
      <p className="text-[13px] font-bold">MST: 4000833337 - ĐT: (0236) 3958718 - Fax: (0236) 3868718</p>
      <p className="text-[13px] font-bold">Website: www.tanminhnhan.com.vn</p>
    </div>
  );
}

export type ApprovalCol = {
  title: string;
  state: "done" | "wait" | "none"; // done = đã xác nhận trên app; wait = đang chờ bước này; none = chưa tới
  name?: string;
  at?: Date | null;
  label?: string; // chữ thay cho "Đã duyệt" (VD "Đã lập", "Đã trình")
};

// Khối xác nhận điện tử thay cho chữ ký tay
export function FormApprovals({ cols }: { cols: ApprovalCol[] }) {
  return (
    <div className="mt-5 grid gap-3 text-center text-[13px]" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
      {cols.map((c) => (
        <div key={c.title} className="rounded border border-slate-300 px-2 py-2">
          <p className="font-bold">{c.title}</p>
          {c.state === "done" ? (
            <>
              <p className="mt-1 font-sans text-xs font-semibold text-emerald-700">✓ {c.label ?? "Đã duyệt"} trên phần mềm</p>
              <p className="mt-1 font-bold">{c.name}</p>
              {c.at && <p className="text-[12px] italic">{fmtDate(c.at)}</p>}
            </>
          ) : c.state === "wait" ? (
            <p className="mt-2 font-sans text-xs font-semibold text-amber-700">⏳ Đang chờ</p>
          ) : (
            <p className="mt-2 font-sans text-xs text-slate-400">—</p>
          )}
        </div>
      ))}
    </div>
  );
}
