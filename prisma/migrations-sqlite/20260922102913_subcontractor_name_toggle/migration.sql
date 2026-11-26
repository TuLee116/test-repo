-- CreateTable
CREATE TABLE "SubcontractorNameToggle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "showInDtcp" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "SubcontractorNameToggle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SubcontractorNameToggle_projectId_name_key" ON "SubcontractorNameToggle"("projectId", "name");
