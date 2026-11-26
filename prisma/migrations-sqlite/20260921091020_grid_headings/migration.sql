-- AlterTable
ALTER TABLE "ProjectSheet" ADD COLUMN "linkCol" TEXT;

-- CreateTable
CREATE TABLE "GridRowMeta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sheetId" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "GridRowMeta_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "ProjectSheet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GridRowMeta_sheetId_row_key" ON "GridRowMeta"("sheetId", "row");
