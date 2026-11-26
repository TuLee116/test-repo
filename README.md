# DT-CP Online — Tân Minh Nhân

Web app nội bộ lập **Dự toán – Chi phí (DT-CP)** cho các gói thầu xây dựng: nhập BOQ của chủ đầu tư từ Excel, tự gợi ý định mức, chiết tính đơn giá, tổng hợp vật tư / nhân công / thiết bị / thầu phụ, lập bảng DT-CP và xuất Excel có công thức.

**Tài liệu đầy đủ cho IT: [docs/BAN-GIAO.md](docs/BAN-GIAO.md)** (kiến trúc, nghiệp vụ, công thức, cài đặt, khôi phục dữ liệu, triển khai, hướng tích hợp).

## Chạy nhanh trên máy

```bash
npm ci
cp .env.example .env                                   # điền AUTH_SECRET, SEED_ADMIN_PASSWORD
npx prisma generate --config prisma7.config.ts
# Dữ liệu: chép database.db (bản sao lưu bàn giao) thành dev.db và thư mục uploads/ vào đây
#          — hoặc tạo DB trống: npx prisma migrate deploy --config prisma7.config.ts && npm run db:refresh
npx prisma migrate deploy --config prisma7.config.ts
npm run dev                                            # http://localhost:3000
```

## Công nghệ

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Prisma 7 + SQLite (better-sqlite3) · NextAuth v5 · ExcelJS · sharp.

## Thư mục chính

- `src/app` — trang & API · `src/lib` — logic nghiệp vụ (`actions.ts` = mọi thao tác ghi)
- `prisma/schema.prisma` — mô hình dữ liệu (có chú thích) · `prisma/migrations` — migration
- `scripts/` — script vận hành · `data/source/` — Excel danh mục định mức gốc
- `Dockerfile`, `scripts/railway-start.sh` — đóng gói & khởi động bản chạy thật · `docs/` — tài liệu
