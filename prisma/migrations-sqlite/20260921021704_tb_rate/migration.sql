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
    "ncKhacRate" REAL NOT NULL DEFAULT 0,
    "tbRate" REAL NOT NULL DEFAULT 0,
    "mmtbRate" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "Project_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("createdAt", "createdById", "id", "investor", "location", "mmtbRate", "name", "ncKhacRate", "overheadRate", "packageName", "preparedDate", "progress", "projectType", "taxableProfitRate", "updatedAt", "vatRate") SELECT "createdAt", "createdById", "id", "investor", "location", "mmtbRate", "name", "ncKhacRate", "overheadRate", "packageName", "preparedDate", "progress", "projectType", "taxableProfitRate", "updatedAt", "vatRate" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
