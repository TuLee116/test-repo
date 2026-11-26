-- AlterTable
ALTER TABLE "Resource" ADD COLUMN "projectId" TEXT;

-- CreateTable
CREATE TABLE "BoqLineResourceSwap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "boqItemId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    CONSTRAINT "BoqLineResourceSwap_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BoqLineResourceSwap_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Resource_projectId_idx" ON "Resource"("projectId");
-- CreateIndex
CREATE UNIQUE INDEX "BoqLineResourceSwap_boqItemId_lineId_key" ON "BoqLineResourceSwap"("boqItemId", "lineId");
