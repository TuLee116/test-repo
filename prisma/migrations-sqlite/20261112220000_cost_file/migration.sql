ALTER TABLE "CostContract" ADD COLUMN "linkInfo" TEXT NOT NULL DEFAULT '[]';

CREATE TABLE "CostFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" BLOB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CostFile_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "CostContract" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CostFile_contractId_key" ON "CostFile"("contractId");
