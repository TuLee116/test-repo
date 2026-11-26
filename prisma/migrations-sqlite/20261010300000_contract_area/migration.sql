-- Hợp đồng (1 HĐ có nhiều DT-CP: DT-CP gốc + các phụ lục) và khu vực của dự án
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "Project" ADD COLUMN "contractId" TEXT REFERENCES "Contract" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Project" ADD COLUMN "area" TEXT NOT NULL DEFAULT '';
CREATE INDEX "Project_contractId_idx" ON "Project"("contractId");
