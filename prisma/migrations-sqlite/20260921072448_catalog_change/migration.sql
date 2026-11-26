-- CreateTable
CREATE TABLE "CatalogChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "workItemCode" TEXT NOT NULL,
    "workItemName" TEXT NOT NULL,
    "resourceIds" TEXT NOT NULL DEFAULT '',
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "reviewedByName" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "CatalogChange_reviewed_idx" ON "CatalogChange"("reviewed");
