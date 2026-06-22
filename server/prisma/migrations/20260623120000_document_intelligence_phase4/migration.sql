-- Phase 4: extended document intelligence fields
ALTER TABLE "document_intelligence" ADD COLUMN "documentType" TEXT;
ALTER TABLE "document_intelligence" ADD COLUMN "keywords" TEXT;
ALTER TABLE "document_intelligence" ADD COLUMN "confidenceScore" REAL;
CREATE INDEX "document_intelligence_workspaceId_category_idx" ON "document_intelligence"("workspaceId", "category");
