CREATE TABLE "BoqLineQty" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "boqItemId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "qty" REAL NOT NULL DEFAULT 0,
    "formula" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "BoqLineQty_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BoqLineQty_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BoqLineQty_boqItemId_lineId_key" ON "BoqLineQty"("boqItemId", "lineId");
