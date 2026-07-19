const { Document } = require("../../models/documents");

/**
 * Cursor-style direct read budgets.
 * gpt-4o-mini / similar ~128k tokens — reserve headroom for system,
 * history, and the reply; give the rest to selected document text.
 * (~4 chars/token → ~320k chars ≈ 80k tokens of document text.)
 */
const MAX_CHARS_PER_DOCUMENT = 100_000;
const MAX_TOTAL_DIRECT_CHARS = 320_000;
const MAX_SELECTED_DOCUMENTS = 8;

const DOCUMENT_QA_SYSTEM_PROMPT = `You are DocCursor, a document Q&A assistant (Cursor-style for documents).
You answer questions using ONLY the document text provided in Context.
You do NOT edit, rewrite, or modify documents.

Rules:
1. Prefer exact facts from the document text. Do not invent numbers, names, dates, fees, or rows.
2. For numeric / table lookups: only answer if an exact matching row or value appears in the provided text. If not, say "Not found in the provided document(s)."
3. Never claim you cannot access the file when document context is provided below.
4. Never offer to edit or change the original document. If asked to edit, explain you only support Q&A.
5. When summarizing, use a clear structure:
## Answer
- 5 concise bullets with key numbers when available
## Evidence
- Source filename and the key facts used
## Not found / Uncertain
- Anything missing from the document text
6. If multiple documents are selected, name which file each fact comes from.
7. If Context notes a document was truncated for length, do not invent content beyond the provided text; list uncertain items under Not found / Uncertain.`;

/**
 * @param {string} text
 * @param {number} maxChars
 * @returns {{ text: string, truncated: boolean }}
 */
function truncateText(text = "", maxChars = MAX_CHARS_PER_DOCUMENT) {
  const value = String(text || "");
  if (value.length <= maxChars) return { text: value, truncated: false };
  return {
    text: `${value.slice(0, maxChars)}\n\n[...truncated for length; answer only from the text above...]`,
    truncated: true,
  };
}

/**
 * Fair-share per-doc cap so every selected file gets room in context
 * (Cursor: selected files + enough room), instead of first-N-fill-budget.
 *
 * @param {number} selectedCount
 * @returns {number}
 */
function perDocumentBudget(selectedCount = 1) {
  const count = Math.max(1, selectedCount);
  return Math.min(
    MAX_CHARS_PER_DOCUMENT,
    Math.floor(MAX_TOTAL_DIRECT_CHARS / count)
  );
}

/**
 * Load full (or fairly truncated) document text for explicitly selected docs.
 * Mirrors Cursor's direct read of active file(s) for Q/A.
 *
 * @param {object} params
 * @param {string[]} params.selectedDocumentIds
 * @param {object[]} [params.selectedDocuments]
 * @returns {Promise<{
 *   contextTexts: string[],
 *   sources: object[],
 *   loadedCount: number,
 *   requestedCount: number,
 *   labels: string[],
 *   truncatedLabels: string[],
 *   failedLabels: string[],
 * }>}
 */
async function loadSelectedDocumentContext({
  selectedDocumentIds = [],
  selectedDocuments = [],
} = {}) {
  const ids = [...new Set((selectedDocumentIds || []).filter(Boolean))].slice(
    0,
    MAX_SELECTED_DOCUMENTS
  );
  if (!ids.length) {
    return {
      contextTexts: [],
      sources: [],
      loadedCount: 0,
      requestedCount: 0,
      labels: [],
      truncatedLabels: [],
      failedLabels: [],
    };
  }

  const labelById = new Map(
    (selectedDocuments || []).map((doc) => [doc.docId, doc.label || doc.filename])
  );

  const contextTexts = [];
  const sources = [];
  const labels = [];
  const truncatedLabels = [];
  const failedLabels = [];
  const docBudget = perDocumentBudget(ids.length);

  for (const docId of ids) {
    const fallbackLabel = labelById.get(docId) || docId;
    try {
      const { title, content } = await Document.content(docId);
      const label = labelById.get(docId) || title || docId;
      const { text: body, truncated } = truncateText(content, docBudget);
      if (!body.trim()) {
        failedLabels.push(label);
        continue;
      }

      if (truncated) truncatedLabels.push(label);

      const block = `Selected document (direct read): ${label}\n\n${body}`;
      contextTexts.push(block);
      sources.push({
        title: label,
        chunkSource: `direct://${docId}`,
        docId,
        text: body.slice(0, 1_000),
        score: 1,
        truncated: Boolean(truncated),
      });
      labels.push(label);
    } catch (error) {
      failedLabels.push(fallbackLabel);
      console.warn(
        `[SelectedDocumentContext] Failed to load docId=${docId}: ${error.message}`
      );
    }
  }

  if (contextTexts.length > 0) {
    const statusParts = [
      `[DocCursor context budget] Loaded ${contextTexts.length}/${ids.length} selected document(s).`,
      `Per-document budget: ${docBudget.toLocaleString()} chars (total cap ${MAX_TOTAL_DIRECT_CHARS.toLocaleString()}).`,
    ];
    if (truncatedLabels.length) {
      statusParts.push(`Truncated for length: ${truncatedLabels.join(", ")}.`);
    }
    if (failedLabels.length) {
      statusParts.push(`Failed to load: ${failedLabels.join(", ")}.`);
    }
    if (!truncatedLabels.length && !failedLabels.length) {
      statusParts.push("All selected documents loaded in full.");
    }
    contextTexts.unshift(statusParts.join(" "));
  }

  return {
    contextTexts,
    sources,
    loadedCount: labels.length,
    requestedCount: ids.length,
    labels,
    truncatedLabels,
    failedLabels,
  };
}

/**
 * @param {string} systemPrompt
 * @param {boolean} hasDirectDocumentContext
 * @returns {string}
 */
function applyDocumentQaSystemPrompt(systemPrompt = "", hasDirectDocumentContext = false) {
  if (!hasDirectDocumentContext) return systemPrompt;
  const base = String(systemPrompt || "").trim();
  if (!base) return DOCUMENT_QA_SYSTEM_PROMPT;
  return `${base}\n\n${DOCUMENT_QA_SYSTEM_PROMPT}`;
}

module.exports = {
  loadSelectedDocumentContext,
  applyDocumentQaSystemPrompt,
  perDocumentBudget,
  DOCUMENT_QA_SYSTEM_PROMPT,
  MAX_CHARS_PER_DOCUMENT,
  MAX_TOTAL_DIRECT_CHARS,
  MAX_SELECTED_DOCUMENTS,
};
