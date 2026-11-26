-- NGHIỆM THU VỚI CĐT từng đợt (người dùng nhập; trang Tổng quan quản lý hợp đồng tính % hoàn thành)
CREATE TABLE "OwnerAcceptance" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "period" TEXT NOT NULL DEFAULT '',
    "date" TIMESTAMP(3),
    "value" DOUBLE PRECISION NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OwnerAcceptance_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OwnerAcceptance_contractId_idx" ON "OwnerAcceptance"("contractId");
ALTER TABLE "OwnerAcceptance" ADD CONSTRAINT "OwnerAcceptance_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "CostContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
