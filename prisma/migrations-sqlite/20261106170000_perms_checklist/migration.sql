-- Checklist quyền theo từng phân hệ + khu vực; luồng duyệt DT-CP
ALTER TABLE "User" ADD COLUMN "dtcpPerms" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "subRoles" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "areas" TEXT NOT NULL DEFAULT '';

-- chuyển quyền cũ sang (không ai mất quyền): đang dùng DT-CP → Xem + Lập/điều chỉnh + Định mức
UPDATE "User" SET "dtcpPerms" = 'VIEW,EDIT,NORM' WHERE "apps" LIKE '%DTCP%';
-- vai trò trình giá cũ dùng chung cho tổ đội + thầu phụ → thầu phụ giữ y như cũ
UPDATE "User" SET "subRoles" = "priceRoles";
-- QSTT / Trưởng phòng / Phó Tổng cũ cũng nhận bước duyệt DT-CP tương ứng
UPDATE "User" SET "dtcpPerms" = CASE WHEN "dtcpPerms" = '' THEN 'VIEW,QSTT' ELSE "dtcpPerms" || ',QSTT' END WHERE "priceRoles" LIKE '%QSTT%';
UPDATE "User" SET "dtcpPerms" = CASE WHEN "dtcpPerms" = '' THEN 'VIEW,TP_KC' ELSE "dtcpPerms" || ',TP_KC' END WHERE "priceRoles" LIKE '%TP_KC%';
UPDATE "User" SET "dtcpPerms" = CASE WHEN "dtcpPerms" = '' THEN 'VIEW,TP_HTPQ' ELSE "dtcpPerms" || ',TP_HTPQ' END WHERE "priceRoles" LIKE '%TP_HTPQ%';
UPDATE "User" SET "dtcpPerms" = CASE WHEN "dtcpPerms" = '' THEN 'VIEW,TP_HTKV' ELSE "dtcpPerms" || ',TP_HTKV' END WHERE "priceRoles" LIKE '%TP_HTKV%';
UPDATE "User" SET "dtcpPerms" = CASE WHEN "dtcpPerms" = '' THEN 'VIEW,PTG' ELSE "dtcpPerms" || ',PTG' END WHERE "priceRoles" LIKE '%PTG%';
UPDATE "User" SET "apps" = CASE WHEN "apps" = '' THEN 'DTCP' ELSE "apps" || ',DTCP' END WHERE "dtcpPerms" <> '' AND "apps" NOT LIKE '%DTCP%';

ALTER TABLE "Project" ADD COLUMN "dtcpStatus" TEXT NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "Project" ADD COLUMN "dtcpTp" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "Project" ADD COLUMN "dtcpNote" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Project" ADD COLUMN "dtcpSubmittedBy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Project" ADD COLUMN "dtcpSubmittedAt" DATETIME;
ALTER TABLE "Project" ADD COLUMN "dtcpApprovedBy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Project" ADD COLUMN "dtcpApprovedAt" DATETIME;
