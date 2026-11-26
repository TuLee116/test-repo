-- CreateTable
CREATE TABLE "SheetManualItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'NC',
    "groupId" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "quantity" REAL NOT NULL DEFAULT 0,
    "unitPrice" REAL NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SheetManualItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_VtGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL DEFAULT 'VT',
    "projectId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "VtGroup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VtGroup" ("id", "name", "orderIndex", "projectId", "section") SELECT "id", "name", "orderIndex", "projectId", "section" FROM "VtGroup";
DROP TABLE "VtGroup";
ALTER TABLE "new_VtGroup" RENAME TO "VtGroup";
CREATE INDEX "VtGroup_projectId_idx" ON "VtGroup"("projectId");
CREATE TABLE "new_VtPlacement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'VT',
    "section" TEXT NOT NULL DEFAULT 'B',
    "groupId" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 1000000,
    "note" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "VtPlacement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VtPlacement" ("groupId", "id", "note", "orderIndex", "projectId", "resourceId", "section") SELECT "groupId", "id", "note", "orderIndex", "projectId", "resourceId", "section" FROM "VtPlacement";
DROP TABLE "VtPlacement";
ALTER TABLE "new_VtPlacement" RENAME TO "VtPlacement";
CREATE UNIQUE INDEX "VtPlacement_projectId_resourceId_kind_key" ON "VtPlacement"("projectId", "resourceId", "kind");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "SheetManualItem_projectId_idx" ON "SheetManualItem"("projectId");
