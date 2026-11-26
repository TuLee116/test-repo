-- Một dòng BOQ có thể chia thành nhiều phần giao thầu phụ (mỗi phần có khối lượng, phạm vi bao VT/TB/NC, đơn giá riêng)
DROP INDEX "SubcontractorItem_boqItemId_key";
ALTER TABLE "SubcontractorItem" ADD COLUMN "followBoq" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SubcontractorItem" ADD COLUMN "coverVT" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SubcontractorItem" ADD COLUMN "coverTB" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SubcontractorItem" ADD COLUMN "coverNC" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SubcontractorItem" ADD COLUMN "coveredLines" TEXT;
-- Dòng thầu phụ trọn gói đang có (link BOQ) = 1 phần giao 100% khối lượng, theo khối lượng BOQ
UPDATE "SubcontractorItem" SET "followBoq" = true WHERE "boqItemId" IS NOT NULL;
CREATE INDEX "SubcontractorItem_boqItemId_idx" ON "SubcontractorItem"("boqItemId");
