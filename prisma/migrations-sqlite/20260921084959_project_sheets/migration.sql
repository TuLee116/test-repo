-- CreateTable
CREATE TABLE "ProjectSheet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BOQ',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "colTitles" TEXT NOT NULL DEFAULT '[]',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "amountCol" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectSheet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GridCell" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sheetId" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "col" INTEGER NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "GridCell_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "ProjectSheet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "isHeading" BOOLEAN NOT NULL DEFAULT false,
    "level" INTEGER,
    "stt" TEXT NOT NULL DEFAULT '',
    "sheetId" TEXT,
    "method" TEXT NOT NULL DEFAULT 'DETAIL',
    "quotedUnitPrice" REAL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BoqItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BoqItem_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BoqItem_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "ProjectSheet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_BoqItem" ("createdAt", "id", "isHeading", "level", "method", "note", "orderIndex", "projectId", "quantity", "quotedUnitPrice", "rawDescription", "rawUnit", "stt", "workItemId") SELECT "createdAt", "id", "isHeading", "level", "method", "note", "orderIndex", "projectId", "quantity", "quotedUnitPrice", "rawDescription", "rawUnit", "stt", "workItemId" FROM "BoqItem";
DROP TABLE "BoqItem";
ALTER TABLE "new_BoqItem" RENAME TO "BoqItem";
CREATE INDEX "BoqItem_projectId_idx" ON "BoqItem"("projectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ProjectSheet_projectId_idx" ON "ProjectSheet"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "GridCell_sheetId_row_col_key" ON "GridCell"("sheetId", "row", "col");
