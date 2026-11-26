# DT-CP Online — đóng gói để chạy trên Railway (hoặc Fly.io / Render / VPS có Docker)
FROM node:22-bookworm-slim

# công cụ biên dịch dự phòng cho better-sqlite3 (vẫn cần để đọc file SQLite cũ / chuyển dữ liệu)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate --config prisma7.config.ts
# lúc build chưa kết nối được CSDL → địa chỉ giả (không trang nào đọc CSDL khi build)
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build NODE_ENV=production npm run build

ENV NODE_ENV=production
# DATABASE_URL: biến của dịch vụ trên Railway = ${{Postgres.DATABASE_URL}} (PostgreSQL, từ 23/11/2026)
ENV AUTH_TRUST_HOST=true
EXPOSE 3000
CMD ["sh", "scripts/railway-start.sh"]
