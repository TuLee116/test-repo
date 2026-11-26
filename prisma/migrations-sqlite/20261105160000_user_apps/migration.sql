-- Chương trình người dùng được dùng (người dùng cũ giữ nguyên quyền: DT-CP + các phân hệ đã có vai trò)
ALTER TABLE "User" ADD COLUMN "apps" TEXT NOT NULL DEFAULT 'DTCP';
UPDATE "User" SET "apps" = "apps" || ',PROC' WHERE "procRoles" <> '';
UPDATE "User" SET "apps" = "apps" || ',PRICE' WHERE "priceRoles" <> '';
