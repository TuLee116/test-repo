#!/bin/sh
# Khởi động trên Railway: cập nhật cấu trúc CSDL PostgreSQL, chuyển dữ liệu SQLite cũ (1 lần), rồi chạy server
set -e
mkdir -p /data

# CSDL là PostgreSQL (từ 23/11/2026) — DATABASE_URL lấy từ dịch vụ Postgres trên Railway
case "$DATABASE_URL" in
  postgres*) ;;
  *) echo "[start] LỖI: DATABASE_URL phải là địa chỉ PostgreSQL"; exit 1 ;;
esac
npx prisma migrate deploy --config prisma7.config.ts

# CHUYỂN DỮ LIỆU SQLite → PostgreSQL (đúng 1 lần, đánh dấu /data/.pg-copied-v1):
# nguồn = /data/prod.db (dữ liệu đang chạy trên web); ổ đĩa trống thì nạp dữ liệu mẫu deploy/seed-data.dat.
# Chép trong 1 giao dịch + đối chiếu từng cột; lỗi thì DỪNG (không chạy web với CSDL trống). File prod.db giữ nguyên để lùi lại khi cần.
if [ ! -f /data/.pg-copied-v1 ]; then
  SRC=""
  [ -f /data/prod.db ] && SRC=/data/prod.db
  [ -z "$SRC" ] && [ -f deploy/seed-data.dat ] && SRC=deploy/seed-data.dat
  if [ -n "$SRC" ]; then
    echo "[start] Chép dữ liệu $SRC sang PostgreSQL"
    # --force: chưa có cờ = lần chép trước chưa đối chiếu xong (web chưa chạy trên PostgreSQL) → xoá hết, chép lại từ đầu
    npx tsx scripts/sqlite-to-pg.ts "$SRC" --force
    npx tsx scripts/verify-copy.ts "$SRC"
  else
    echo "[start] Không có dữ liệu cũ -> nạp danh mục"
    npm run db:refresh
  fi
  touch /data/.pg-copied-v1
  for f in .rough-norms-v2 .labor-all-v1 .labor-dims-v1 .tmn-codes-v1 .grid-amount-v1; do touch "/data/$f"; done
fi

# FILE GỐC Excel: chuyển từ CSDL ra KHO FILE /data/files (1 lần, 23/11/2026) — lỗi thì giữ nguyên trong CSDL, web vẫn đọc được
if [ ! -f /data/.files-out-v1 ]; then
  echo "[start] Chuyển file gốc Excel ra kho file"
  npx tsx scripts/move-files-out.ts && touch /data/.files-out-v1 || echo "[start] Chưa chuyển được file — để lần khởi động sau"
fi

# Bộ định mức chuẩn phần thô (src/lib/rough-norms.ts): tạo 1 lần trên ổ đĩa này, đánh dấu bằng file để
# lần khởi động sau không ẩn lại những mã người dùng đã tự bật
# v2 (12/10/2026): mã hiệu theo định mức nhà nước TT38/2026 thay bộ mã TMN.* của v1; chuyển các dự án
# đang bật "nhân công theo công việc" sang mã mới
if [ ! -f /data/.rough-norms-v2 ]; then
  echo "[start] Tạo bộ định mức chuẩn phần thô (mã theo TT38/2026)"
  mkdir -p data
  [ -f /data/rough-norms-deactivated.json ] && cp /data/rough-norms-deactivated.json data/rough-norms-deactivated.json
  npx tsx scripts/seed-rough-norms.ts && cp data/rough-norms-deactivated.json /data/rough-norms-deactivated.json \
    && npx tsx scripts/apply-rough-norms.ts --all-labor && touch /data/.rough-norms-v2
fi

# Nhân công đặt tên theo công việc BOQ cho MỌI dự án (1 lần; sau đó dự án mới mặc định bật)
if [ ! -f /data/.labor-all-v1 ]; then
  echo "[start] Bật nhân công theo công việc BOQ cho mọi dự án"
  npx tsx scripts/enable-labor-all.ts && touch /data/.labor-all-v1
fi

# Tên nhân công giữ kích thước + đường kính công việc (dày / cao, D14, Fi<10...) - 27/10/2026: tách các nhân công đang gộp nhầm (1 lần)
if [ ! -f /data/.labor-dims-v1 ]; then
  echo "[start] Tách nhân công theo kích thước công việc"
  npx tsx scripts/resync-labor.ts && touch /data/.labor-dims-v1
fi

# Mã nhân công / vật liệu riêng của dự án: đổi dạng PJ-... sang TMN + 5 chữ số - 1 lần
if [ ! -f /data/.tmn-codes-v1 ]; then
  echo "[start] Đổi mã tài nguyên riêng của dự án sang TMN00000"
  npx tsx scripts/rename-project-codes.ts && touch /data/.tmn-codes-v1
fi

# Bảng tự do chưa chọn cột "Thành tiền" → tự nhận theo tên cột (để có tổng đầu mục + dòng TỔNG CỘNG) - 1 lần
if [ ! -f /data/.grid-amount-v1 ]; then
  echo "[start] Tự nhận cột Thành tiền của bảng tự do"
  npx tsx scripts/detect-grid-amount.ts && touch /data/.grid-amount-v1
fi

# Dọn file ảnh BOQ không còn dùng (ảnh lưu ở /data/uploads, xem src/lib/uploads.ts) - lỗi không chặn khởi động
npx tsx scripts/sweep-orphan-images.ts || true

node scripts/reset-admin.mjs
# Nâng giới hạn bộ nhớ của Node (mặc định ~2GB, file Excel lớn làm máy chủ hết bộ nhớ và tự sập)
export NODE_OPTIONS="--max-old-space-size=3072"
exec npx next start -H 0.0.0.0 -p "${PORT:-3000}"
