-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PriceLine" (
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
    "lineKey" TEXT NOT NULL DEFAULT '',
    "overReason" TEXT NOT NULL DEFAULT '',
    "formulas" TEXT NOT NULL DEFAULT '{}',
    CONSTRAINT "PriceLine_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "PriceSubmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PriceLine" ("baseAmount", "baseNote", "basePrice", "cdtAmount", "cdtPrice", "content", "id", "level", "lineKey", "orderIndex", "overReason", "ptAmount", "ptNote", "ptOpinion", "ptPrice", "qsNote", "qty", "siteAmount", "siteNote", "siteOpinion", "sitePrice", "sourceRow", "stt", "submissionId", "tpNote", "tpOk", "tpPrice", "unit") SELECT "baseAmount", "baseNote", "basePrice", "cdtAmount", "cdtPrice", "content", "id", "level", "lineKey", "orderIndex", "overReason", "ptAmount", "ptNote", "ptOpinion", "ptPrice", "qsNote", "qty", "siteAmount", "siteNote", "siteOpinion", "sitePrice", "sourceRow", "stt", "submissionId", "tpNote", "tpOk", "tpPrice", "unit" FROM "PriceLine";
DROP TABLE "PriceLine";
ALTER TABLE "new_PriceLine" RENAME TO "PriceLine";
CREATE INDEX "PriceLine_submissionId_idx" ON "PriceLine"("submissionId");
CREATE TABLE "new_SubLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proposalId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "sourceRow" INTEGER NOT NULL DEFAULT 0,
    "level" TEXT NOT NULL DEFAULT 'ITEM',
    "stt" TEXT NOT NULL DEFAULT '',
    "workName" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "dims" TEXT NOT NULL DEFAULT '',
    "cdtQty" REAL,
    "cdtPrice" REAL,
    "baseQty" REAL,
    "basePrice" REAL,
    "bids" TEXT NOT NULL DEFAULT '{}',
    "propQty" REAL,
    "propPrice" REAL,
    "note" TEXT NOT NULL DEFAULT '',
    "lineKey" TEXT NOT NULL DEFAULT '',
    "qsNote" TEXT NOT NULL DEFAULT '',
    "tpPrice" REAL,
    "tpOk" BOOLEAN NOT NULL DEFAULT true,
    "tpNote" TEXT NOT NULL DEFAULT '',
    "formulas" TEXT NOT NULL DEFAULT '{}',
    CONSTRAINT "SubLine_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "SubProposal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SubLine" ("basePrice", "baseQty", "bids", "cdtPrice", "cdtQty", "code", "content", "dims", "id", "level", "lineKey", "note", "orderIndex", "propPrice", "propQty", "proposalId", "qsNote", "sourceRow", "stt", "tpNote", "tpOk", "tpPrice", "unit", "workName") SELECT "basePrice", "baseQty", "bids", "cdtPrice", "cdtQty", "code", "content", "dims", "id", "level", "lineKey", "note", "orderIndex", "propPrice", "propQty", "proposalId", "qsNote", "sourceRow", "stt", "tpNote", "tpOk", "tpPrice", "unit", "workName" FROM "SubLine";
DROP TABLE "SubLine";
ALTER TABLE "new_SubLine" RENAME TO "SubLine";
CREATE INDEX "SubLine_proposalId_idx" ON "SubLine"("proposalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
