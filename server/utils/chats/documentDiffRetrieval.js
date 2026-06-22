const { Document } = require("../../models/documents");
const { DocumentComparisons } = require("../../models/documentComparisons");
const { compareDocuments } = require("../documentDiff/documentDiff");
const {
  normalizeDocLabel,
  findBestDocumentMatch,
  getDocumentLabels,
} = require("../documentDiff/documentRef");

/**
 * Pairwise document diff intent patterns.
 */
const DOCUMENT_DIFF_PATTERNS = [
  /\bcompare\b.+\b(with|and|vs\.?|versus|to)\b/i,
  /\bwhat\s+changed\b/i,
  /\bshow\s+(added|removed|modified)\s+(clauses?|sections?|terms?)\b/i,
  /\b(difference|diff)\s+between\b/i,
  /\bchanges?\s+between\b.+\b(documents?|versions?|agreements?|contracts?|files?)\b/i,
  /\bhighlight\b.+\b(confidentiality|payment|billing|termination)\b.+\bchang/i,
  /\bgenerate\s+change\s+summary\b/i,
  /\bshow\s+payment\s+term\s+changes\b/i,
  /\bshow\s+legal\s+risks?\s+introduced\b/i,
  /\bsummari[sz]e\s+modifications\b/i,
];

/**
 * @param {string} message
 * @returns {boolean}
 */
function isDocumentDiffQuery(message = "") {
  if (!message || typeof message !== "string") return false;
  const normalized = message.trim();
  if (!normalized) return false;

  if (/\bcompare\s+(all\s+)?(documents?|agreements?|contracts?)\b/i.test(normalized)) {
    return false;
  }

  return DOCUMENT_DIFF_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Extract two document references from a natural language query.
 *
 * @param {string} message
 * @param {object[]} documents
 * @returns {{ documentA: string, documentB: string }|null}
 */
function extractDocumentPairFromQuery(message = "", documents = []) {
  const normalized = message.trim();
  if (!normalized || documents.length < 2) return null;

  const filenames = documents
    .map((doc) => ({
      docId: doc.docId,
      filename: String(doc.filename || ""),
      basename: String(doc.filename || "").split("/").pop(),
      labels: getDocumentLabels(doc),
    }))
    .sort((a, b) => b.basename.length - a.basename.length);

  const mentioned = filenames.filter((doc) =>
    doc.labels.some((label) =>
      normalized.toLowerCase().includes(label.toLowerCase())
    ) ||
    normalized.toLowerCase().includes(doc.basename.toLowerCase()) ||
    normalized.toLowerCase().includes(doc.filename.toLowerCase()) ||
    doc.labels.some(
      (label) =>
        normalizeDocLabel(normalized).includes(normalizeDocLabel(label)) &&
        normalizeDocLabel(label).length >= 8
    )
  );

  if (mentioned.length >= 2) {
    return {
      documentA: mentioned[0].docId,
      documentB: mentioned[1].docId,
    };
  }

  const compareMatch = normalized.match(
    /\bcompare\s+(.+?)\s+(?:with|and|vs\.?|versus|to)\s+(.+)$/i
  );
  if (compareMatch) {
    const refA = compareMatch[1]
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/[?.!]+$/, "");
    const refB = compareMatch[2]
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/[?.!]+$/, "");

    const matchA = findBestDocumentMatch(refA, documents);
    const matchB = findBestDocumentMatch(refB, documents);

    return {
      documentA: matchA?.docId || refA,
      documentB: matchB?.docId || refB,
    };
  }

  if (mentioned.length === 1 && documents.length === 2) {
    const other = documents.find((doc) => doc.docId !== mentioned[0].docId);
    if (other) {
      return { documentA: mentioned[0].docId, documentB: other.docId };
    }
  }

  return null;
}

/**
 * Run document diff analysis for chat and return context injection.
 *
 * @param {object} params
 * @param {string} params.message
 * @param {object} params.workspace
 * @returns {Promise<{ handled: boolean, context?: string, report?: object, error?: string }>}
 */
async function performDocumentDiffAnalysis({ message, workspace, user = null }) {
  if (!isDocumentDiffQuery(message)) {
    return { handled: false };
  }

  const documents = await Document.forWorkspace(workspace.id);
  const pair = extractDocumentPairFromQuery(message, documents);

  if (!pair) {
    return {
      handled: true,
      context: `Document diff request detected, but two documents could not be identified.
Please ask using explicit filenames, for example:
"Compare Contract_v1.docx with Contract_v2.docx"
"What changed between RETAINER AGREEMENT-2.pdf and TMC0058.pdf?"`,
    };
  }

  const result = await compareDocuments({
    workspaceId: workspace.id,
    documentA: pair.documentA,
    documentB: pair.documentB,
  });

  if (!result.success) {
    return { handled: true, error: result.error };
  }

  const saved = await DocumentComparisons.create({
    workspaceId: workspace.id,
    documentA: result.documentA,
    documentB: result.documentB,
    report: result.report,
    createdBy: user?.id || null,
  });

  return {
    handled: true,
    report: result.report,
    reviewId: saved?.id || null,
    context: `${result.report.report}

Document diff analysis instructions:
- Present the comparison as a Git-style business document diff
- Lead with the executive summary
- List added, removed, and modified clauses clearly
- Call out payment, confidentiality, termination, and legal risk changes explicitly
- Use tables where helpful for clause-by-clause comparison`,
  };
}

const DOCUMENT_DIFF_SYSTEM_PROMPT = `You are a document change analyst for business and legal documents.
When document diff context is provided, produce a PR-style review — NOT a raw text dump.

Structure your response:
1. Executive Summary (overall change level, key changes, financial impact, legal risk)
2. Added Clauses (business-friendly labels only)
3. Removed Clauses
4. Modified Clauses (use ~ prefix)
5. Financial Impact (previous vs new when applicable)
6. Legal Risk Analysis (with severity: HIGH/MEDIUM/LOW)

Rules:
- Never paste sample language, case names, discovery templates, or boilerplate
- Explain what changed, why it matters, and what risks/obligations shifted
- Use concise business language like "Retainer deposit requirement added"
- Do not reproduce full paragraphs from the documents`;

module.exports = {
  isDocumentDiffQuery,
  extractDocumentPairFromQuery,
  performDocumentDiffAnalysis,
  DOCUMENT_DIFF_PATTERNS,
  DOCUMENT_DIFF_SYSTEM_PROMPT,
};
