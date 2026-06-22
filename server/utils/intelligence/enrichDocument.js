const { Document } = require("../../models/documents");
const { Workspace } = require("../../models/workspace");
const {
  DocumentIntelligence,
} = require("../../models/documentIntelligence");
const { getLLMProvider } = require("../helpers");
const { safeJsonParse } = require("../http");
const { summarizeContent } = require("../agents/aibitat/utils/summarize");

const LONG_CONTENT_CHAR_THRESHOLD = 12_000;

const VALID_CATEGORIES = [
  "contract",
  "agreement",
  "invoice",
  "policy",
  "filing",
  "correspondence",
  "financial_statement",
  "audit_report",
  "hr_document",
  "compliance",
  "presentation",
  "spreadsheet",
  "other",
];

const CLASSIFICATION_PROMPT = `You are a document intelligence system for business documents.
Analyze the document content and return ONLY valid JSON with this exact shape:
{
  "category": "one of: ${VALID_CATEGORIES.join(", ")}",
  "summary": "A concise 2-4 sentence summary of the document's purpose and key content",
  "keyTopics": ["topic1", "topic2", "topic3"]
}

Rules:
- category must be exactly one value from the allowed list
- summary must be factual and based only on the provided content
- keyTopics should contain 3-8 short topic labels
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
 * @param {object} payload
 * @returns {{ category: string, summary: string, keyTopics: string[] }}
 */
function normalizeClassification(payload = {}) {
  const category = VALID_CATEGORIES.includes(payload.category)
    ? payload.category
    : "other";

  const summary =
    typeof payload.summary === "string" ? payload.summary.trim() : "";

  const keyTopics = Array.isArray(payload.keyTopics)
    ? payload.keyTopics
        .filter((topic) => typeof topic === "string" && topic.trim())
        .map((topic) => topic.trim())
        .slice(0, 12)
    : [];

  return { category, summary, keyTopics };
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
    const llm = getLLMProvider({
      provider: workspace?.chatProvider || null,
      model: workspace?.chatModel || null,
    });

    let sourceText = content;
    if (content.length > LONG_CONTENT_CHAR_THRESHOLD) {
      sourceText = await summarizeContent({
        provider: workspace?.chatProvider || process.env.LLM_PROVIDER || "openai",
        model: workspace?.chatModel || null,
        content,
      });
    }

    const userMessage = `${CLASSIFICATION_PROMPT}

Document filename: ${title || record.filename}

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
  detectFileType: DocumentIntelligence.detectFileType,
  VALID_CATEGORIES,
  parseClassificationJson,
  normalizeClassification,
  LONG_CONTENT_CHAR_THRESHOLD,
};
