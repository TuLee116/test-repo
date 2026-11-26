-- File gốc (Excel) chuyển ra KHO FILE riêng: cột fileKey trỏ tới file, cột bytea để trống
ALTER TABLE "PriceSubmission" ADD COLUMN "fileKey" TEXT;
ALTER TABLE "SubProposal" ADD COLUMN "fileKey" TEXT;
ALTER TABLE "CostFile" ADD COLUMN "fileKey" TEXT;
ALTER TABLE "CostFile" ALTER COLUMN "data" DROP NOT NULL;
