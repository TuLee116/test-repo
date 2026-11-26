ALTER TABLE "PriceLine" ADD COLUMN "tpAmount" REAL;
ALTER TABLE "PriceSubmission" ADD COLUMN "totalFormulas" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "PriceSubmission" ADD COLUMN "totalAmounts" TEXT NOT NULL DEFAULT '{}';
