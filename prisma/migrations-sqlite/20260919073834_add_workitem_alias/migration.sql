-- CreateTable
CREATE TABLE "WorkItemAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "normalizedText" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkItemAlias_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkItemAlias_normalizedText_key" ON "WorkItemAlias"("normalizedText");
