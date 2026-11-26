-- Trình giá thầu phụ NỘI THẤT: loại hồ sơ, cột Mô tả vật liệu / Dài / Rộng / Cao, ảnh từng dòng
ALTER TABLE "SubProposal" ADD COLUMN "isNt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SubLine" ADD COLUMN "material" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SubLine" ADD COLUMN "dimL" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SubLine" ADD COLUMN "dimW" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SubLine" ADD COLUMN "dimH" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "SubLineImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proposalId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mime" TEXT NOT NULL DEFAULT 'image/jpeg',
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubLineImage_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "SubLine" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SubLineImage_lineId_idx" ON "SubLineImage"("lineId");

-- CreateIndex
CREATE INDEX "SubLineImage_proposalId_idx" ON "SubLineImage"("proposalId");
