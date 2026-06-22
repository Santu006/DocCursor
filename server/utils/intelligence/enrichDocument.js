const { Document } = require("../../models/documents");
const { Workspace } = require("../../models/workspace");
const {
  DocumentIntelligence,
} = require("../../models/documentIntelligence");
const { getLLMProvider } = require("../helpers");
const { safeJsonParse } = require("../http");
const { summarizeContent } = require("../agents/aibitat/utils/summarize");
const { resolveIntelligenceLLM } = require("./resolveIntelligenceLLM");

const LONG_CONTENT_CHAR_THRESHOLD = 12_000;

const VALID_CATEGORIES = [
  "agreement",
  "contract",
  "policy",
  "invoice",
  "resume",
  "presentation",
  "spreadsheet",
  "research_paper",
  "technical_documentation",
  "financial_report",
  "legal_document",
  "general",
];

const LEGACY_CATEGORY_MAP = {
  filing: "legal_document",
  correspondence: "general",
  financial_statement: "financial_report",
  audit_report: "financial_report",
  hr_document: "resume",
  compliance: "policy",
  other: "general",
};

const CLASSIFICATION_PROMPT = `You are a document intelligence system for business and organizational documents.
Analyze the document content and return ONLY valid JSON with this exact shape:
{
  "category": "one of: ${VALID_CATEGORIES.join(", ")}",
  "documentType": "short label such as retainer agreement, employee handbook, sales deck, budget spreadsheet",
  "summary": "A concise 2-4 sentence summary of the document's purpose and key content",
  "keyTopics": ["topic1", "topic2", "topic3"],
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "confidenceScore": 0.0
}

Rules:
- category must be exactly one value from the allowed list
- documentType should be a short human-readable label
- summary must be factual and based only on the provided content
- keyTopics should contain 3-8 short topic labels
- keywords should contain 5-12 search-oriented terms
- confidenceScore must be a number from 0 to 1 reflecting classification confidence
- Return JSON only, no markdown fences or commentary`;

/**
 * @param {string} text
 * @returns {object|null}
 */
function parseClassificationJson(text = "") {
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
 * @param {string} category
 * @returns {string}
 */
function normalizeCategory(category = "") {
  const value = String(category || "").trim();
  if (VALID_CATEGORIES.includes(value)) return value;
  if (LEGACY_CATEGORY_MAP[value]) return LEGACY_CATEGORY_MAP[value];
  return "general";
}

/**
 * @param {object} payload
 */
function normalizeClassification(payload = {}) {
  const category = normalizeCategory(payload.category);
  const documentType =
    typeof payload.documentType === "string"
      ? payload.documentType.trim().slice(0, 120)
      : category;

  const summary =
    typeof payload.summary === "string" ? payload.summary.trim() : "";

  const keyTopics = Array.isArray(payload.keyTopics)
    ? payload.keyTopics
        .filter((topic) => typeof topic === "string" && topic.trim())
        .map((topic) => topic.trim())
        .slice(0, 12)
    : [];

  const keywords = Array.isArray(payload.keywords)
    ? payload.keywords
        .filter((word) => typeof word === "string" && word.trim())
        .map((word) => word.trim())
        .slice(0, 20)
    : [];

  let confidenceScore = Number(payload.confidenceScore);
  if (Number.isNaN(confidenceScore)) confidenceScore = 0.75;
  confidenceScore = Math.max(0, Math.min(1, confidenceScore));

  return {
    category,
    documentType,
    summary,
    keyTopics,
    keywords,
    confidenceScore,
  };
}

/**
 * @param {object} record - document_intelligence row
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function enrichDocument(record) {
  if (!record?.docId) return { success: false, error: "Missing docId" };

  try {
    const workspaceDocument = await Document.get({ docId: record.docId });
    if (!workspaceDocument) {
      return { success: false, error: "Workspace document not found" };
    }

    const { title, content } = await Document.content(record.docId);
    if (!content || !content.trim()) {
      return { success: false, error: "Document has no extractable content" };
    }

    const workspace = await Workspace.get({ id: record.workspaceId });
    const { provider, model } = resolveIntelligenceLLM(workspace);
    const llm = getLLMProvider({ provider, model });

    let sourceText = content;
    if (content.length > LONG_CONTENT_CHAR_THRESHOLD) {
      sourceText = await summarizeContent({
        provider: provider || process.env.LLM_PROVIDER || "openai",
        model,
        content,
      });
    }

    const rawMetadata = workspaceDocument?.metadata;
    const structureHint =
      typeof rawMetadata === "string"
        ? safeJsonParse(rawMetadata, {})
        : rawMetadata || {};
    const documentStructure = structureHint.documentStructure
      ? safeJsonParse(structureHint.documentStructure, structureHint.documentStructure)
      : null;

    const userMessage = `${CLASSIFICATION_PROMPT}

Document filename: ${title || record.filename}
File type: ${record.fileType || "unknown"}
${documentStructure ? `Document structure: ${JSON.stringify(documentStructure)}` : ""}

Document content:
${sourceText}`;

    const { textResponse } = await llm.getChatCompletion(
      [{ role: "user", content: userMessage }],
      { temperature: 0 }
    );

    const parsed = parseClassificationJson(textResponse);
    if (!parsed) {
      return {
        success: false,
        error: "Failed to parse intelligence JSON from model response",
      };
    }

    const normalized = normalizeClassification(parsed);
    if (!normalized.summary) {
      return { success: false, error: "Model returned an empty summary" };
    }

    await DocumentIntelligence.markComplete(record.id, normalized);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Enrichment failed" };
  }
}

module.exports = {
  enrichDocument,
  resolveIntelligenceLLM,
  detectFileType: DocumentIntelligence.detectFileType,
  VALID_CATEGORIES,
  LEGACY_CATEGORY_MAP,
  parseClassificationJson,
  normalizeClassification,
  normalizeCategory,
  LONG_CONTENT_CHAR_THRESHOLD,
};
