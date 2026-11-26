-- AlterTable
ALTER TABLE "BoqItem" ADD COLUMN "directMode" TEXT;
ALTER TABLE "BoqItem" ADD COLUMN "directPct" REAL;
ALTER TABLE "BoqItem" ADD COLUMN "directBaseId" TEXT;
UPDATE "BoqItem" SET "directMode" = 'LINK' WHERE "directLink" IS NOT NULL;
