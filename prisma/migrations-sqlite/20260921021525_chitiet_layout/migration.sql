-- CreateTable
CREATE TABLE "ProjectResourceWastage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "rate" REAL NOT NULL,
    CONSTRAINT "ProjectResourceWastage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BoqItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "workItemId" TEXT,
    "rawDescription" TEXT NOT NULL DEFAULT '',
    "rawUnit" TEXT NOT NULL DEFAULT '',
    "quantity" REAL NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'DETAIL',
    "quotedUnitPrice" REAL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BoqItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BoqItem_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_BoqItem" ("createdAt", "id", "note", "orderIndex", "projectId", "quantity", "quotedUnitPrice", "rawDescription", "rawUnit", "workItemId") SELECT "createdAt", "id", "note", "orderIndex", "projectId", "quantity", "quotedUnitPrice", "rawDescription", "rawUnit", "workItemId" FROM "BoqItem";
DROP TABLE "BoqItem";
ALTER TABLE "new_BoqItem" RENAME TO "BoqItem";
CREATE INDEX "BoqItem_projectId_idx" ON "BoqItem"("projectId");
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "packageName" TEXT NOT NULL DEFAULT '',
    "investor" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "projectType" TEXT NOT NULL DEFAULT '',
    "preparedDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "overheadRate" REAL NOT NULL DEFAULT 0.065,
    "taxableProfitRate" REAL NOT NULL DEFAULT 0.055,
    "vatRate" REAL NOT NULL DEFAULT 0.1,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "progress" TEXT NOT NULL DEFAULT '',
    "ncKhacRate" REAL NOT NULL DEFAULT 0,
    "mmtbRate" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "Project_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("createdAt", "createdById", "id", "investor", "location", "name", "overheadRate", "packageName", "preparedDate", "progress", "projectType", "taxableProfitRate", "updatedAt", "vatRate") SELECT "createdAt", "createdById", "id", "investor", "location", "name", "overheadRate", "packageName", "preparedDate", "progress", "projectType", "taxableProfitRate", "updatedAt", "vatRate" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE TABLE "new_SubcontractorItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contractorName" TEXT NOT NULL DEFAULT '',
    "boqItemId" TEXT,
    "unitPrice" REAL NOT NULL DEFAULT 0,
    "amount" REAL NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubcontractorItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubcontractorItem_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SubcontractorItem" ("amount", "contractorName", "createdAt", "id", "name", "note", "orderIndex", "projectId") SELECT "amount", "contractorName", "createdAt", "id", "name", "note", "orderIndex", "projectId" FROM "SubcontractorItem";
DROP TABLE "SubcontractorItem";
ALTER TABLE "new_SubcontractorItem" RENAME TO "SubcontractorItem";
CREATE UNIQUE INDEX "SubcontractorItem_boqItemId_key" ON "SubcontractorItem"("boqItemId");
CREATE INDEX "SubcontractorItem_projectId_idx" ON "SubcontractorItem"("projectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ProjectResourceWastage_projectId_resourceId_key" ON "ProjectResourceWastage"("projectId", "resourceId");
