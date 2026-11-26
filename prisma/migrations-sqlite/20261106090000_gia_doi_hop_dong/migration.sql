-- Đệ trình giá đội bám DT-CP theo hợp đồng: hợp đồng, dòng sheet TH, sổ giá duyệt, nhớ khớp dòng
CREATE TABLE "CostContract" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "packageName" TEXT NOT NULL DEFAULT '',
    "contractNo" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'EXCEL',
    "projectId" TEXT,
    "fileName" TEXT NOT NULL DEFAULT '',
    "sheetMap" TEXT NOT NULL DEFAULT '{}',
    "versions" TEXT NOT NULL DEFAULT '[]',
    "approvedVersion" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE TABLE "CostLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'ITEM',
    "stt" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "qty" REAL,
    "prices" TEXT NOT NULL DEFAULT '{}',
    "amount" REAL,
    "note" TEXT NOT NULL DEFAULT '',
    "orderIndex" INTEGER NOT NULL,
    "sourceRow" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CostLine_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "CostContract" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CostLine_contractId_kind_idx" ON "CostLine"("contractId", "kind");
CREATE TABLE "ApprovedPrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "crew" TEXT NOT NULL DEFAULT '',
    "price" REAL NOT NULL,
    "qty" REAL,
    "approvedAt" DATETIME NOT NULL,
    "approvedByName" TEXT NOT NULL DEFAULT '',
    "submissionId" TEXT NOT NULL,
    "submissionCode" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "batch" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "ApprovedPrice_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "CostContract" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ApprovedPrice_contractId_lineKey_idx" ON "ApprovedPrice"("contractId", "lineKey");
CREATE TABLE "PriceMatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "srcKey" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL,
    CONSTRAINT "PriceMatch_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "CostContract" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PriceMatch_contractId_srcKey_key" ON "PriceMatch"("contractId", "srcKey");

-- Hồ sơ trình giá gắn hợp đồng, tên đội, lần trình
ALTER TABLE "PriceSubmission" ADD COLUMN "contractId" TEXT REFERENCES "CostContract" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PriceSubmission" ADD COLUMN "crewName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PriceSubmission" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PriceSubmission" ADD COLUMN "parentId" TEXT;
ALTER TABLE "PriceLine" ADD COLUMN "lineKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PriceLine" ADD COLUMN "overReason" TEXT NOT NULL DEFAULT '';
