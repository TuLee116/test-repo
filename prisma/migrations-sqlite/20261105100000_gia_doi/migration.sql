-- Phân hệ Đệ trình giá đội
ALTER TABLE "User" ADD COLUMN "priceRoles" TEXT NOT NULL DEFAULT '';

CREATE TABLE "PriceSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "projectName" TEXT NOT NULL DEFAULT '',
    "contractNo" TEXT NOT NULL DEFAULT '',
    "projectCode" TEXT NOT NULL DEFAULT '',
    "itemName" TEXT NOT NULL DEFAULT '',
    "quoteStatus" TEXT NOT NULL DEFAULT '',
    "batch" TEXT NOT NULL DEFAULT '',
    "batchDate" TEXT NOT NULL DEFAULT '',
    "fileName" TEXT NOT NULL DEFAULT '',
    "fileData" BLOB,
    "sheetName" TEXT NOT NULL DEFAULT '',
    "colMap" TEXT NOT NULL DEFAULT '{}',
    "headRows" TEXT NOT NULL DEFAULT '{}',
    "category" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "qsNote" TEXT NOT NULL DEFAULT '',
    "tpNote" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "submittedAt" DATETIME,
    "reviewedByName" TEXT NOT NULL DEFAULT '',
    "reviewedAt" DATETIME,
    "mailTo" TEXT NOT NULL DEFAULT '',
    "mailSentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "PriceSubmission_code_key" ON "PriceSubmission"("code");
CREATE INDEX "PriceSubmission_status_idx" ON "PriceSubmission"("status");

CREATE TABLE "PriceLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "sourceRow" INTEGER NOT NULL DEFAULT 0,
    "level" TEXT NOT NULL DEFAULT 'ITEM',
    "stt" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "qty" REAL,
    "cdtPrice" REAL,
    "cdtAmount" REAL,
    "basePrice" REAL,
    "baseAmount" REAL,
    "baseNote" TEXT NOT NULL DEFAULT '',
    "siteOpinion" TEXT NOT NULL DEFAULT '',
    "sitePrice" REAL,
    "siteAmount" REAL,
    "siteNote" TEXT NOT NULL DEFAULT '',
    "ptOpinion" TEXT NOT NULL DEFAULT '',
    "ptPrice" REAL,
    "ptAmount" REAL,
    "ptNote" TEXT NOT NULL DEFAULT '',
    "qsNote" TEXT NOT NULL DEFAULT '',
    "tpPrice" REAL,
    "tpOk" BOOLEAN NOT NULL DEFAULT true,
    "tpNote" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "PriceLine_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "PriceSubmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PriceLine_submissionId_idx" ON "PriceLine"("submissionId");
