const { Document } = require("../../models/documents");
const { Workspace } = require("../../models/workspace");
const { getLLMProvider } = require("../helpers");
const { safeJsonParse } = require("../http");
const { resolveIntelligenceLLM } = require("../intelligence/resolveIntelligenceLLM");
const { computeSemanticDiff } = require("./semanticDiff");
const { buildDiffReport, normalizeLLMAnalysis } = require("./diffReport");
const {
  normalizeDocLabel,
  findBestDocumentMatch,
  getDocumentLabels,
} = require("./documentRef");

const LLM_DIFF_PROMPT = `You are a legal and business document change analyst producing executive-grade clause diffs.
Given two document versions and a structured CLAUSE-LEVEL diff (not raw text), return ONLY valid JSON:
{
  "executiveSummary": "2-4 sentence business summary — no raw document text",
  "overallChangeLevel": "LOW|MEDIUM|HIGH",
  "keyChanges": ["short bullet summaries of the most important clause changes"],
  "financialImpactLevel": "LOW|MEDIUM|HIGH",
  "legalRiskLevel": "LOW|MEDIUM|HIGH",
  "whyItMatters": "1-2 sentences on business/legal significance",
  "addedClauses": ["business-friendly clause change labels"],
  "removedClauses": ["business-friendly clause change labels"],
  "modifiedClauses": ["business-friendly clause change labels"],
  "newObligations": ["new obligations introduced in version B"],
  "removedProtections": ["protections removed from version A"],
  "paymentTermChanges": ["specific payment/billing changes with before/after when known"],
  "confidentialityChanges": ["confidentiality changes"],
  "terminationChanges": ["termination or withdrawal changes"],
  "legalImpact": "brief legal impact assessment",
  "businessImpact": "brief business impact assessment",
  "semanticChanges": [
    { "section": "concept name", "changeType": "added|removed|modified", "summary": "what changed", "severity": "LOW|MEDIUM|HIGH" }
  ],
  "riskChanges": [
    { "section": "concept name", "changeType": "added|removed|modified", "summary": "legal risk change", "severity": "LOW|MEDIUM|HIGH", "category": "legal_risk" }
  ],
  "financialChanges": [
    { "label": "concept name", "previous": "before state", "next": "after state", "impact": "LOW|MEDIUM|HIGH", "summary": "financial impact" }
  ],
  "complianceChanges": [],
  "operationalChanges": []
}

Rules:
- Answer: What changed? Why does it matter? What risks were introduced? What obligations changed? What financial impact exists?
- Use business language (e.g. "Retainer deposit requirement added", NOT raw paragraph text)
- Never dump sample language, case names, or template boilerplate
- Base analysis on the provided clause diff data only
- Return JSON only, no markdown fences or commentary`;

/**
 * @param {string} text
 * @returns {object|null}
 */
function parseAnalysisJson(text = "") {
  const trimmed = String(text).trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const parsed = safeJsonParse(candidate, null);
  if (parsed && typeof parsed === "object") return parsed;

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  return safeJsonParse(candidate.slice(start, end + 1), null);
}

/**
 * Resolve a workspace document reference by docId or filename.
 *
 * @param {number} workspaceId
 * @param {string} ref
 * @returns {Promise<{ docId: string, title: string, content: string, filename: string }|null>}
 */
async function resolveDocumentRef(workspaceId, ref = "") {
  const needle = String(ref).trim();
  if (!needle || !workspaceId) return null;

  const documents = await Document.forWorkspace(workspaceId);
  const lowerNeedle = needle.toLowerCase();

  const exactDoc = documents.find((doc) => doc.docId === needle);
  if (exactDoc) {
    const { title, content } = await Document.content(exactDoc.docId);
    return {
      docId: exactDoc.docId,
      title: title || exactDoc.filename,
      content,
      filename: exactDoc.filename,
    };
  }

  const exactLabelMatches = documents.filter((doc) =>
    getDocumentLabels(doc).some((label) => label.toLowerCase() === lowerNeedle)
  );
  if (exactLabelMatches.length === 1) {
    const doc = exactLabelMatches[0];
    const { title, content } = await Document.content(doc.docId);
    return {
      docId: doc.docId,
      title: title || doc.filename,
      content,
      filename: doc.filename,
    };
  }

  const byFilename = documents.filter((doc) => {
    const filename = String(doc.filename || "").toLowerCase();
    return (
      filename === lowerNeedle ||
      filename.endsWith(`/${lowerNeedle}`) ||
      filename.includes(lowerNeedle)
    );
  });

  if (byFilename.length === 1) {
    const doc = byFilename[0];
    const { title, content } = await Document.content(doc.docId);
    return {
      docId: doc.docId,
      title: title || doc.filename,
      content,
      filename: doc.filename,
    };
  }

  if (byFilename.length > 1) {
    const exactName = byFilename.find(
      (doc) =>
        String(doc.filename).toLowerCase() === lowerNeedle ||
        String(doc.filename).toLowerCase().endsWith(`/${lowerNeedle}`)
    );
    if (exactName) {
      const { title, content } = await Document.content(exactName.docId);
      return {
        docId: exactName.docId,
        title: title || exactName.filename,
        content,
        filename: exactName.filename,
      };
    }
  }

  const fuzzyMatch = findBestDocumentMatch(needle, documents);
  if (fuzzyMatch) {
    const { title, content } = await Document.content(fuzzyMatch.docId);
    return {
      docId: fuzzyMatch.docId,
      title: title || fuzzyMatch.filename,
      content,
      filename: fuzzyMatch.filename,
    };
  }

  return null;
}

/**
 * @param {object} params
 * @param {object} params.diffResult
 * @param {string} params.titleA
 * @param {string} params.titleB
 * @param {string} params.contentA
 * @param {string} params.contentB
 * @param {object|null} params.workspace
 * @returns {Promise<object|null>}
 */
async function runLLMAnalysis({
  diffResult,
  titleA,
  titleB,
  contentA,
  contentB,
  workspace = null,
}) {
  if (!process.env.OPEN_AI_KEY && !process.env.LLM_PROVIDER) return null;

  const { provider, model } = resolveIntelligenceLLM(workspace);
  const llm = getLLMProvider({ provider, model });

  const userMessage = `${LLM_DIFF_PROMPT}

Document A: ${titleA}
Document B: ${titleB}

Clause-level diff (use this as primary source — do NOT reproduce raw text):
${JSON.stringify(
  {
    overallChangeLevel: diffResult.executiveSummary?.overallChangeLevel,
    addedClauses: diffResult.clauseChanges
      ?.filter((c) => c.changeType === "added")
      .map((c) => ({ summary: c.summary, severity: c.severity, category: c.riskCategory })),
    removedClauses: diffResult.clauseChanges
      ?.filter((c) => c.changeType === "removed")
      .map((c) => ({ summary: c.summary, severity: c.severity, category: c.riskCategory })),
    modifiedClauses: diffResult.clauseChanges
      ?.filter((c) => c.changeType === "modified")
      .map((c) => ({ summary: c.summary, severity: c.severity, category: c.riskCategory })),
    financialChanges: diffResult.financialChanges,
    riskChanges: diffResult.riskChanges,
    executiveSummary: diffResult.executiveSummary,
  },
  null,
  2
)}`;

  const { textResponse } = await llm.getChatCompletion(
    [{ role: "user", content: userMessage }],
    { temperature: 0 }
  );

  const parsed = parseAnalysisJson(textResponse);
  return parsed ? normalizeLLMAnalysis(parsed) : null;
}

/**
 * Compare two documents and produce a structured diff report.
 *
 * @param {object} params
 * @param {number} [params.workspaceId]
 * @param {string} [params.documentA]
 * @param {string} [params.documentB]
 * @param {string} [params.contentA]
 * @param {string} [params.contentB]
 * @param {string} [params.titleA]
 * @param {string} [params.titleB]
 * @param {boolean} [params.useLLM=true]
 * @returns {Promise<{ success: boolean, error?: string, report?: object }>}
 */
async function compareDocuments({
  workspaceId = null,
  documentA = null,
  documentB = null,
  contentA = null,
  contentB = null,
  titleA = null,
  titleB = null,
  useLLM = true,
}) {
  try {
    let resolvedA = null;
    let resolvedB = null;
    let workspace = null;

    if (workspaceId) {
      workspace = await Workspace.get({ id: workspaceId });
    }

    if (contentA && contentB) {
      resolvedA = {
        docId: documentA || "document-a",
        title: titleA || documentA || "Document A",
        content: contentA,
        filename: titleA || documentA || "Document A",
      };
      resolvedB = {
        docId: documentB || "document-b",
        title: titleB || documentB || "Document B",
        content: contentB,
        filename: titleB || documentB || "Document B",
      };
    } else {
      if (!workspaceId || !documentA || !documentB) {
        return {
          success: false,
          error:
            "Provide workspaceId + documentA + documentB, or raw contentA + contentB.",
        };
      }

      resolvedA = await resolveDocumentRef(workspaceId, documentA);
      resolvedB = await resolveDocumentRef(workspaceId, documentB);

      if (!resolvedA) {
        return {
          success: false,
          error: `Could not resolve document A: ${documentA}`,
        };
      }
      if (!resolvedB) {
        return {
          success: false,
          error: `Could not resolve document B: ${documentB}`,
        };
      }
    }

    if (!resolvedA.content?.trim() || !resolvedB.content?.trim()) {
      return {
        success: false,
        error: "One or both documents have no extractable content.",
      };
    }

    const diffResult = computeSemanticDiff(resolvedA.content, resolvedB.content);

    let llmAnalysis = null;
    if (useLLM) {
      try {
        llmAnalysis = await runLLMAnalysis({
          diffResult,
          titleA: resolvedA.title,
          titleB: resolvedB.title,
          contentA: resolvedA.content,
          contentB: resolvedB.content,
          workspace,
        });
      } catch (error) {
        console.error("[documentDiff] LLM analysis failed:", error.message);
      }
    }

    const report = buildDiffReport({
      titleA: resolvedA.title,
      titleB: resolvedB.title,
      diffResult,
      llmAnalysis,
    });

    return {
      success: true,
      documentA: resolvedA.docId,
      documentB: resolvedB.docId,
      titleA: resolvedA.title,
      titleB: resolvedB.title,
      report,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || "Document comparison failed",
    };
  }
}

module.exports = {
  compareDocuments,
  resolveDocumentRef,
  runLLMAnalysis,
  parseAnalysisJson,
};
