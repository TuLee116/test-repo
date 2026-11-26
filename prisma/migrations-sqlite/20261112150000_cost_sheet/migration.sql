CREATE TABLE "CostSheet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "rows" TEXT NOT NULL DEFAULT '[]',
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "CostSheet_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "CostContract" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CostSheet_contractId_role_idx" ON "CostSheet"("contractId", "role");
