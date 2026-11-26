-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProjectResourcePrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "unitPrice" REAL NOT NULL,
    "vatRate" REAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectResourcePrice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectResourcePrice_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ProjectResourcePrice" ("id", "projectId", "resourceId", "unitPrice", "updatedAt") SELECT "id", "projectId", "resourceId", "unitPrice", "updatedAt" FROM "ProjectResourcePrice";
DROP TABLE "ProjectResourcePrice";
ALTER TABLE "new_ProjectResourcePrice" RENAME TO "ProjectResourcePrice";
CREATE UNIQUE INDEX "ProjectResourcePrice_projectId_resourceId_key" ON "ProjectResourcePrice"("projectId", "resourceId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
