import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// CSDL PostgreSQL (từ 23/11/2026, trước đó SQLite — xem prisma/migrations-sqlite và scripts/sqlite-to-pg.ts).
// DATABASE_URL dạng postgresql://user:pass@host:port/db
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url || !/^postgres(ql)?:\/\//.test(url)) console.error("[prisma] DATABASE_URL phải là địa chỉ PostgreSQL (postgresql://...)");
  const adapter = new PrismaPg({ connectionString: url, max: Number(process.env.DB_POOL_MAX) || 10 });
  // giao dịch dài (nhập BOQ / Excel hàng nghìn dòng): CSDL qua mạng chậm hơn SQLite cục bộ → nới thời gian chờ
  return new PrismaClient({ adapter, transactionOptions: { maxWait: 15_000, timeout: 120_000 } });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
