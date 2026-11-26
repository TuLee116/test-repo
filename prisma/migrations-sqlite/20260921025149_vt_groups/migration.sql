-- CreateTable
CREATE TABLE "VtGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "VtGroup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VtPlacement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "section" TEXT NOT NULL DEFAULT 'B',
    "groupId" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 1000000,
    "note" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "VtPlacement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "VtGroup_projectId_idx" ON "VtGroup"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "VtPlacement_projectId_resourceId_key" ON "VtPlacement"("projectId", "resourceId");
