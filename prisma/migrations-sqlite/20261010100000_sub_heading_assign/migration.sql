-- Giao thầu phụ theo đầu mục lớn: phần giao tính theo % khối lượng của từng công tác con
ALTER TABLE "SubcontractorItem" ADD COLUMN "percent" REAL;
ALTER TABLE "SubcontractorItem" ADD COLUMN "assignId" TEXT;
ALTER TABLE "SubcontractorItem" ADD COLUMN "fromHeadingId" TEXT;
CREATE INDEX "SubcontractorItem_assignId_idx" ON "SubcontractorItem"("assignId");
