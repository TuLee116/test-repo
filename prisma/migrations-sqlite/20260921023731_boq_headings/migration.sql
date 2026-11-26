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
    "stt" TEXT NOT NULL DEFAULT '',
    "method" TEXT NOT NULL DEFAULT 'DETAIL',
    "quotedUnitPrice" REAL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BoqItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BoqItem_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_BoqItem" ("createdAt", "id", "method", "note", "orderIndex", "projectId", "quantity", "quotedUnitPrice", "rawDescription", "rawUnit", "workItemId") SELECT "createdAt", "id", "method", "note", "orderIndex", "projectId", "quantity", "quotedUnitPrice", "rawDescription", "rawUnit", "workItemId" FROM "BoqItem";
DROP TABLE "BoqItem";
ALTER TABLE "new_BoqItem" RENAME TO "BoqItem";
CREATE INDEX "BoqItem_projectId_idx" ON "BoqItem"("projectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
