-- CreateTable
CREATE TABLE "document_intelligence" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "docId" TEXT NOT NULL,
    "workspaceId" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "category" TEXT,
    "summary" TEXT,
    "keyTopics" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "enrichedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_intelligence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "document_intelligence_docId_key" ON "document_intelligence"("docId");

-- CreateIndex
CREATE INDEX "document_intelligence_workspaceId_idx" ON "document_intelligence"("workspaceId");

-- CreateIndex
CREATE INDEX "document_intelligence_workspaceId_status_idx" ON "document_intelligence"("workspaceId", "status");
