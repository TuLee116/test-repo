-- CreateTable
CREATE TABLE "FieldFormula" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "formula" TEXT NOT NULL,
    CONSTRAINT "FieldFormula_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "FieldFormula_projectId_kind_targetId_field_key" ON "FieldFormula"("projectId", "kind", "targetId", "field");
