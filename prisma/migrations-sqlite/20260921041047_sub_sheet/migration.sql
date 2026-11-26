-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SubcontractorItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contractorName" TEXT NOT NULL DEFAULT '',
    "boqItemId" TEXT,
    "unitPrice" REAL NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT '',
    "quantity" REAL NOT NULL DEFAULT 0,
    "groupId" TEXT,
    "amount" REAL NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubcontractorItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubcontractorItem_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SubcontractorItem" ("amount", "boqItemId", "contractorName", "createdAt", "id", "name", "note", "orderIndex", "projectId", "unitPrice") SELECT "amount", "boqItemId", "contractorName", "createdAt", "id", "name", "note", "orderIndex", "projectId", "unitPrice" FROM "SubcontractorItem";
DROP TABLE "SubcontractorItem";
ALTER TABLE "new_SubcontractorItem" RENAME TO "SubcontractorItem";
CREATE UNIQUE INDEX "SubcontractorItem_boqItemId_key" ON "SubcontractorItem"("boqItemId");
CREATE INDEX "SubcontractorItem_projectId_idx" ON "SubcontractorItem"("projectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
