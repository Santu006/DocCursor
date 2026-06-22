-- CreateTable
CREATE TABLE "document_comparisons" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "workspaceId" INTEGER NOT NULL,
    "documentA" TEXT NOT NULL,
    "documentB" TEXT NOT NULL,
    "comparisonSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_comparisons_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "document_comparisons_workspaceId_idx" ON "document_comparisons"("workspaceId");

-- CreateIndex
CREATE INDEX "document_comparisons_workspaceId_createdAt_idx" ON "document_comparisons"("workspaceId", "createdAt");
