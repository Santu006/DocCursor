-- Phase 6: extend document_comparisons into full review history
ALTER TABLE "document_comparisons" ADD COLUMN "riskScore" INTEGER;
ALTER TABLE "document_comparisons" ADD COLUMN "summary" TEXT;
ALTER TABLE "document_comparisons" ADD COLUMN "createdBy" INTEGER;
ALTER TABLE "document_comparisons" ADD COLUMN "shareToken" TEXT;
ALTER TABLE "document_comparisons" ADD COLUMN "template" TEXT DEFAULT 'legal_review';
ALTER TABLE "document_comparisons" ADD COLUMN "riskLevel" TEXT;

CREATE UNIQUE INDEX "document_comparisons_shareToken_key" ON "document_comparisons"("shareToken");
CREATE INDEX "document_comparisons_workspaceId_riskLevel_idx" ON "document_comparisons"("workspaceId", "riskLevel");
CREATE INDEX "document_comparisons_createdBy_idx" ON "document_comparisons"("createdBy");
