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
    "showInDtcp" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "VtGroup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_VtGroup" ("id", "kind", "name", "orderIndex", "projectId", "section") SELECT "id", "kind", "name", "orderIndex", "projectId", "section" FROM "VtGroup";
DROP TABLE "VtGroup";
ALTER TABLE "new_VtGroup" RENAME TO "VtGroup";
CREATE INDEX "VtGroup_projectId_idx" ON "VtGroup"("projectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
