-- CreateTable
CREATE TABLE "DtcpLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "section" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "linkSource" TEXT NOT NULL DEFAULT '',
    "manualAmount" REAL NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "DtcpLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DtcpColumn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "DtcpColumn_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DtcpCell" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lineId" TEXT NOT NULL,
    "columnId" TEXT NOT NULL,
    "value" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "DtcpCell_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "DtcpLine" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DtcpCell_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "DtcpColumn" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    CONSTRAINT "Project_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("createdAt", "createdById", "id", "investor", "location", "name", "overheadRate", "packageName", "preparedDate", "projectType", "taxableProfitRate", "updatedAt", "vatRate") SELECT "createdAt", "createdById", "id", "investor", "location", "name", "overheadRate", "packageName", "preparedDate", "projectType", "taxableProfitRate", "updatedAt", "vatRate" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DtcpLine_projectId_idx" ON "DtcpLine"("projectId");

-- CreateIndex
CREATE INDEX "DtcpColumn_projectId_idx" ON "DtcpColumn"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "DtcpCell_lineId_columnId_key" ON "DtcpCell"("lineId", "columnId");
