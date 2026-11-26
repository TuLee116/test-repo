-- DANH MỤC DỰ ÁN: mã + tên chuẩn + tên gọi khác; DT-CP / hợp đồng / hồ sơ giá đội / hồ sơ thầu phụ gắn siteId
CREATE TABLE "ProjectSite" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "area" TEXT NOT NULL DEFAULT '',
    "aliases" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdByName" TEXT NOT NULL DEFAULT '',
    "confirmedByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectSite_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectSite_code_idx" ON "ProjectSite"("code");

ALTER TABLE "Project" ADD COLUMN "siteId" TEXT;
ALTER TABLE "CostContract" ADD COLUMN "siteId" TEXT;
ALTER TABLE "PriceSubmission" ADD COLUMN "siteId" TEXT;
ALTER TABLE "SubProposal" ADD COLUMN "siteId" TEXT;
CREATE INDEX "Project_siteId_idx" ON "Project"("siteId");

ALTER TABLE "Project" ADD CONSTRAINT "Project_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "ProjectSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CostContract" ADD CONSTRAINT "CostContract_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "ProjectSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PriceSubmission" ADD CONSTRAINT "PriceSubmission_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "ProjectSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubProposal" ADD CONSTRAINT "SubProposal_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "ProjectSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
