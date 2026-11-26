import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import bcrypt from "bcryptjs";
import resourcesData from "./seed-data/resources.json";
import workItemsData from "./seed-data/work-items.json";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./dev.db" });
const prisma = new PrismaClient({ adapter });

type ResourceSeed = {
  code: string;
  name: string;
  unit: string;
  unitPrice: number;
  sourceType: "VT" | "TB" | "NC";
  groupLabel: string;
};

type WorkItemSeed = {
  code: string;
  name: string;
  unit: string;
  section: string;
  subsection: string;
  note: string;
  lines: { resourceCode: string; quantity: number; wastageRate: number; category: "VT" | "TB" | "NC" }[];
  fixedVT?: number;
  fixedTB?: number;
  fixedNC?: number;
};

async function main() {
  const resources = resourcesData as ResourceSeed[];
  const workItems = workItemsData as WorkItemSeed[];

  console.log(`Seeding ${resources.length} resources...`);
  const resourceIdByCode = new Map<string, string>();
  for (const r of resources) {
    const rec = await prisma.resource.upsert({
      where: { code: r.code },
      update: { name: r.name, unit: r.unit, unitPrice: r.unitPrice, sourceType: r.sourceType, groupLabel: r.groupLabel },
      create: { code: r.code, name: r.name, unit: r.unit, unitPrice: r.unitPrice, sourceType: r.sourceType, groupLabel: r.groupLabel },
    });
    resourceIdByCode.set(r.code, rec.id);
  }

  console.log(`Seeding ${workItems.length} work items...`);
  // Xoá danh mục cũ (và các dòng hao phí liên quan, cascade) trước khi nạp lại từ Excel,
  // để lần import sau phản ánh đúng dữ liệu mới nhất (không cộng dồn/trùng lặp).
  await prisma.workItem.deleteMany({});

  for (const item of workItems) {
    const created = await prisma.workItem.create({
      data: {
        code: item.code,
        name: item.name,
        unit: item.unit,
        section: item.section,
        subsection: item.subsection,
        note: item.note,
        fixedVT: item.fixedVT ?? null,
        fixedTB: item.fixedTB ?? null,
        fixedNC: item.fixedNC ?? null,
        resources: {
          create: item.lines.map((l) => ({
            category: l.category,
            quantity: l.quantity,
            wastageRate: l.wastageRate,
            resource: { connect: { id: resourceIdByCode.get(l.resourceCode)! } },
          })),
        },
      },
    });
    void created;
  }

  const adminUsername = process.env.SEED_ADMIN_USERNAME || "admin";
  // Không có mật khẩu mặc định trong mã nguồn: phải đặt SEED_ADMIN_PASSWORD (từ 8 ký tự) trong .env
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "";
  const existingAdmin = await prisma.user.findUnique({ where: { username: adminUsername } });
  if (!existingAdmin && adminPassword.length < 8) {
    console.warn("Chưa tạo tài khoản admin: đặt SEED_ADMIN_PASSWORD (từ 8 ký tự) trong .env rồi chạy lại npm run db:seed");
  } else if (!existingAdmin) {
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    await prisma.user.create({
      data: { name: "Quản trị viên", username: adminUsername, passwordHash, role: "ADMIN" },
    });
    console.log(`Tạo tài khoản admin: ${adminUsername} (mật khẩu theo SEED_ADMIN_PASSWORD - đổi sau khi đăng nhập lần đầu)`);
  }

  console.log("Seed xong.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
