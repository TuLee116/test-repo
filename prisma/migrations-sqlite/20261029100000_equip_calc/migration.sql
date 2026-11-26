-- Tính toán thiết bị thi công
ALTER TABLE "SheetManualItem" ADD COLUMN "calcId" TEXT;

CREATE TABLE "EquipItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'RENT',
    "weight" REAL NOT NULL DEFAULT 0,
    "supplierPrices" TEXT NOT NULL DEFAULT '{}',
    "price" REAL NOT NULL DEFAULT 0,
    "priceManual" BOOLEAN NOT NULL DEFAULT false,
    "buyPrice" REAL NOT NULL DEFAULT 0,
    "lossPct" REAL NOT NULL DEFAULT 0,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "EquipItem_code_key" ON "EquipItem"("code");

CREATE TABLE "EquipCalc" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "params" TEXT NOT NULL DEFAULT '{}',
    "groupId" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EquipCalc_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "EquipCalc_projectId_idx" ON "EquipCalc"("projectId");
