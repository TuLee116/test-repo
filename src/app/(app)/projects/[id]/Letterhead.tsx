import fs from "node:fs";
import path from "node:path";

// Logo thật đặt tại public/tmn-logo.png; nếu chưa có thì hiện khung chữ TMN tạm.
const hasLogo = fs.existsSync(path.join(process.cwd(), "public", "tmn-logo.png"));

export default function Letterhead() {
  return (
    <div className="ws-hide flex items-start gap-4 border-b border-slate-200 pb-4">
      {hasLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/tmn-logo.png" alt="TMN" className="h-14 w-auto shrink-0" />
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-slate-900 text-lg font-bold text-white">
          TMN
        </div>
      )}
      <div className="text-xs leading-relaxed text-slate-600">
        <p className="text-sm font-semibold text-slate-900">CÔNG TY CỔ PHẦN XÂY DỰNG KIẾN TRÚC TÂN MINH NHÂN</p>
        <p>250 Lê Văn Hiến, phường Khuê Mỹ, quận Ngũ Hành Sơn, TP. Đà Nẵng</p>
        <p>Điện thoại: (0236) 3958718 · Website: www.tanminhnhan.com.vn</p>
      </div>
    </div>
  );
}
