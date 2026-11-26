-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GridRowMeta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sheetId" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "showInDtcp" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "GridRowMeta_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "ProjectSheet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GridRowMeta" ("id", "row", "sheetId", "title") SELECT "id", "row", "sheetId", "title" FROM "GridRowMeta";
DROP TABLE "GridRowMeta";
ALTER TABLE "new_GridRowMeta" RENAME TO "GridRowMeta";
CREATE UNIQUE INDEX "GridRowMeta_sheetId_row_key" ON "GridRowMeta"("sheetId", "row");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
