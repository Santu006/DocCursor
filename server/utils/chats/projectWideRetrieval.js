const PROJECT_WIDE_CANDIDATE_LIMIT = 40;
const FACTUAL_EXTRACTION_THRESHOLD = 0.15;

/**
 * Regex patterns that indicate the user wants coverage across the whole project,
 * not a single highest-scoring document.
 */
const PROJECT_WIDE_PATTERNS = [
  /\bsummarize\s+all\b/i,
  /\ball\s+(documents?|agreements?|contracts?|pdfs?|files?|uploads?)\b/i,
  /\bevery\s+(document|agreement|contract|pdf|file)s?\b/i,
  /\bcompare\s+(all\s+)?(documents?|agreements?|contracts?)\b/i,
  /\bcompare\b.+\b(documents?|agreements?|contracts?)\b/i,
  /\ball\s+uploaded\b/i,
  /\bevery\s+document\s+in\s+(this\s+)?(project|workspace)\b/i,
];

/**
 * Patterns for exhaustive fact extraction across documents.
 */
const FACTUAL_EXTRACTION_PATTERNS = [
  /\blist\s+(every|all)\s+(monetary\s+)?amounts?\b/i,
  /\blist\s+every\s+monetary\s+amount\b/i,
  /\ball\s+(dates?|deadlines?|fees?|amounts?|obligations?|payment\s+terms?)\b/i,
  /\bevery\s+(obligation|payment\s+term)s?\b/i,
  /\blist\s+(every|all)\s+(dates?|deadlines?|fees?)\b/i,
  /\bevery\s+(monetary\s+)?amount\b/i,
];

/**
 * @param {string} message
 * @returns {boolean}
 */
function isProjectWideQuery(message = "") {
  if (!message || typeof message !== "string") return false;
  const normalized = message.trim();
  if (!normalized) return false;

  if (/@document\//i.test(normalized)) return false;

  return PROJECT_WIDE_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * @param {string} message
 * @returns {boolean}
 */
function isFactualExtractionQuery(message = "") {
  if (!message || typeof message !== "string") return false;
  const normalized = message.trim();
  if (!normalized) return false;

  return FACTUAL_EXTRACTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * @param {number} totalChunksInDocument
 * @returns {number}
 */
function getDynamicMaxChunksPerDoc(totalChunksInDocument = 0) {
  const total = Number(totalChunksInDocument) || 0;
  if (total < 10) return Number.POSITIVE_INFINITY;
  if (total <= 30) return 5;
  return 8;
}

const PROJECT_WIDE_COVERAGE_ENFORCEMENT = `You MUST provide an output entry for every document listed below.
If no matching information exists, write: "Not specified"
Do not omit any document.`;

const PROJECT_WIDE_SYSTEM_INSTRUCTIONS = `Project-wide analysis instructions:
- Analyze every document separately.
- Include every document represented in context.
- When creating tables, produce one row per document.
- If information is missing, write "Not specified".
- Ignore placeholders such as [dollar amount], ---, and blank template fields (e.g., underscores or unfilled form lines).`;

/**
 * Build a bullet checklist of documents represented in structured context.
 *
 * @param {string[]} documentsInContext
 * @returns {{ text: string, documents: string[] }}
 */
function buildDocumentCoverageChecklist(documentsInContext = []) {
  const documents = (documentsInContext ?? []).filter(Boolean);
  if (!documents.length) {
    return { text: "", documents: [] };
  }

  const bullets = documents.map((doc) => `* ${doc}`).join("\n");
  return {
    text: `Documents represented in context:\n\n${bullets}`,
    documents,
  };
}

/**
 * @param {string[]} [documentsInContext]
 * @returns {string}
 */
function getProjectWideSystemInstructions(documentsInContext = []) {
  const { documents } = buildDocumentCoverageChecklist(documentsInContext);
  if (!documents.length) return PROJECT_WIDE_SYSTEM_INSTRUCTIONS;

  const documentsToCover = documents.map((doc) => `* ${doc}`).join("\n");
  return `${PROJECT_WIDE_SYSTEM_INSTRUCTIONS}

${PROJECT_WIDE_COVERAGE_ENFORCEMENT}

Documents to cover:
${documentsToCover}`;
}

/**
 * Append project-wide reasoning instructions to the workspace system prompt.
 *
 * @param {string} systemPrompt
 * @param {{ projectWide?: boolean, documentsInContext?: string[] }} vectorSearchResults
 * @returns {string}
 */
function applyProjectWideSystemPrompt(systemPrompt = "", vectorSearchResults = {}) {
  if (!vectorSearchResults?.projectWide) return systemPrompt;
  const instructions = getProjectWideSystemInstructions(
    vectorSearchResults.documentsInContext ?? []
  );
  if (!systemPrompt?.trim()) return instructions;
  return `${systemPrompt.trim()}\n\n${instructions}`;
}

/**
 * @param {object[]} sources
 * @returns {Map<string, object[]>}
 */
function groupChunksByDocument(sources = []) {
  const grouped = new Map();

  for (const source of sources) {
    const key = getDocumentKey(source);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(source);
  }

  for (const chunks of grouped.values()) {
    chunks.sort((a, b) => getSourceScore(b.score) - getSourceScore(a.score));
  }

  return grouped;
}

/**
 * Build document-grouped context for project-wide queries.
 *
 * @param {object[]} sources
 * @returns {{ text: string, documentsInContext: string[], chunksPerDocument: Record<string, number> }}
 */
function buildStructuredDocumentContext(sources = []) {
  if (!sources?.length) {
    return { text: "", documentsInContext: [], chunksPerDocument: {} };
  }

  const grouped = groupChunksByDocument(sources);
  const docOrder = [...grouped.entries()].sort((a, b) => {
    const maxA = Math.max(...a[1].map((s) => getSourceScore(s.score)));
    const maxB = Math.max(...b[1].map((s) => getSourceScore(s.score)));
    return maxB - maxA;
  });

  const documentsInContext = [];
  const chunksPerDocument = {};
  const sections = [];

  for (const [title, chunks] of docOrder) {
    documentsInContext.push(title);
    chunksPerDocument[title] = chunks.length;

    const chunkBodies = chunks
      .map((chunk) => (chunk.text || "").trim())
      .filter(Boolean)
      .join("\n\n");

    sections.push(`## Document: ${title}\n\n${chunkBodies}`);
  }

  return {
    text: sections.join("\n\n"),
    documentsInContext,
    chunksPerDocument,
  };
}

/**
 * @param {object} source
 * @returns {string}
 */
function getDocumentKey(source = {}) {
  return (
    source.title ||
    source.chunkSource ||
    source.url ||
    source.id ||
    "unknown-document"
  );
}

/**
 * @param {number|null|undefined} score
 * @returns {number}
 */
function getSourceScore(score) {
  return typeof score === "number" && !Number.isNaN(score) ? score : 0;
}

/**
 * @param {object[]} sources
 * @param {number} threshold
 * @returns {object[]}
 */
function filterSourcesByThreshold(sources = [], threshold = 0.25) {
  return sources.filter((source) => getSourceScore(source.score) >= threshold);
}

/**
 * Keep highest-scoring chunks per document using dynamic per-document limits.
 *
 * @param {object[]} sources
 * @param {{ documentChunkCounts?: Record<string, number>, maxPerDoc?: number }} [options]
 * @returns {{ contextTexts: string[], sources: object[] }}
 */
function balanceChunksByDocument(
  sources = [],
  { documentChunkCounts = {}, maxPerDoc } = {}
) {
  if (!sources?.length) {
    return { contextTexts: [], sources: [] };
  }

  const sorted = [...sources].sort(
    (a, b) => getSourceScore(b.score) - getSourceScore(a.score)
  );

  const grouped = new Map();

  for (const source of sorted) {
    const key = getDocumentKey(source);
    if (!grouped.has(key)) grouped.set(key, []);

    const totalInDocument =
      documentChunkCounts[key] ??
      documentChunkCounts[source.title] ??
      sorted.filter((item) => getDocumentKey(item) === key).length;

    const limit =
      typeof maxPerDoc === "number"
        ? maxPerDoc
        : getDynamicMaxChunksPerDoc(totalInDocument);

    const bucket = grouped.get(key);
    if (bucket.length < limit) bucket.push(source);
  }

  const balanced = [...grouped.values()]
    .flat()
    .sort((a, b) => getSourceScore(b.score) - getSourceScore(a.score));

  return {
    contextTexts: balanced.map((source) => source.text).filter(Boolean),
    sources: balanced,
  };
}

/**
 * @param {object} VectorDb
 * @param {string} namespace
 * @returns {Promise<Record<string, number>>}
 */
async function resolveDocumentChunkCounts(VectorDb, namespace) {
  if (typeof VectorDb?.getDocumentChunkCounts === "function") {
    return VectorDb.getDocumentChunkCounts(namespace);
  }
  return {};
}

/**
 * @param {object} params
 * @param {object} params.VectorDb
 * @param {object} params.workspace
 * @param {string} params.input
 * @param {object} params.LLMConnector
 * @param {string[]} [params.filterIdentifiers]
 * @returns {Promise<{ contextTexts: string[], sources: object[], message: string|boolean, projectWide: boolean }>}
 */
async function performWorkspaceSimilaritySearch({
  VectorDb,
  workspace,
  input,
  LLMConnector,
  filterIdentifiers = [],
}) {
  const projectWide = isProjectWideQuery(input);
  const factualExtraction = isFactualExtractionQuery(input);
  const rerank = workspace?.vectorSearchMode === "rerank";
  const workspaceThreshold =
    typeof workspace?.similarityThreshold === "number"
      ? workspace.similarityThreshold
      : 0.25;

  const effectiveThreshold =
    projectWide && factualExtraction
      ? FACTUAL_EXTRACTION_THRESHOLD
      : workspaceThreshold;

  const vectorSearchResults = await VectorDb.performSimilaritySearch({
    namespace: workspace.slug,
    input,
    LLMConnector,
    similarityThreshold: projectWide ? 0 : effectiveThreshold,
    topN: projectWide ? PROJECT_WIDE_CANDIDATE_LIMIT : workspace?.topN || 4,
    filterIdentifiers,
    rerank,
  });

  if (!projectWide || vectorSearchResults.message) {
    return { ...vectorSearchResults, projectWide: false };
  }

  const rawSources = vectorSearchResults.sources ?? [];
  const afterThreshold = filterSourcesByThreshold(rawSources, effectiveThreshold);
  const documentChunkCounts = await resolveDocumentChunkCounts(
    VectorDb,
    workspace.slug
  );
  const balanced = balanceChunksByDocument(afterThreshold, {
    documentChunkCounts,
  });

  const structured = buildStructuredDocumentContext(balanced.sources);
  const { text: coverageChecklist } = buildDocumentCoverageChecklist(
    structured.documentsInContext
  );

  console.log("[ProjectWideRetrieval]", {
    query: input,
    factualExtraction,
    similarityThreshold: effectiveThreshold,
    rawChunks: rawSources.length,
    chunksAfterThreshold: afterThreshold.length,
    chunksAfterBalancing: balanced.sources.length,
    uniqueDocuments: new Set(balanced.sources.map((s) => s.title)).size,
    documentsInContext: structured.documentsInContext,
    chunksPerDocument: structured.chunksPerDocument,
    coverageChecklist,
  });

  return {
    contextTexts: structured.text ? [structured.text] : [],
    sources: balanced.sources,
    message: false,
    projectWide: true,
    documentsInContext: structured.documentsInContext,
    coverageChecklist,
  };
}

/**
 * Merge vector search results into running context/source arrays.
 *
 * @param {object} params
 * @param {object} params.vectorSearchResults
 * @param {string[]} params.contextTexts
 * @param {object[]} params.sources
 * @param {object[]} params.rawHistory
 * @param {object} params.workspace
 * @param {string[]} params.pinnedDocIdentifiers
 * @returns {{ contextTexts: string[], sources: object[] }}
 */
function mergeRetrievalIntoContext({
  vectorSearchResults,
  contextTexts,
  sources,
  rawHistory,
  workspace,
  pinnedDocIdentifiers,
}) {
  if (vectorSearchResults.projectWide) {
    return {
      contextTexts: [...contextTexts, ...vectorSearchResults.contextTexts],
      sources: [...sources, ...vectorSearchResults.sources],
    };
  }

  const { fillSourceWindow } = require("../helpers/chat");
  const filledSources = fillSourceWindow({
    nDocs: workspace?.topN || 4,
    searchResults: vectorSearchResults.sources,
    history: rawHistory,
    filterIdentifiers: pinnedDocIdentifiers,
  });

  return {
    contextTexts: [...contextTexts, ...filledSources.contextTexts],
    sources: [...sources, ...vectorSearchResults.sources],
  };
}

module.exports = {
  PROJECT_WIDE_CANDIDATE_LIMIT,
  FACTUAL_EXTRACTION_THRESHOLD,
  PROJECT_WIDE_SYSTEM_INSTRUCTIONS,
  PROJECT_WIDE_COVERAGE_ENFORCEMENT,
  isProjectWideQuery,
  isFactualExtractionQuery,
  getDynamicMaxChunksPerDoc,
  getProjectWideSystemInstructions,
  applyProjectWideSystemPrompt,
  buildDocumentCoverageChecklist,
  groupChunksByDocument,
  buildStructuredDocumentContext,
  balanceChunksByDocument,
  filterSourcesByThreshold,
  performWorkspaceSimilaritySearch,
  mergeRetrievalIntoContext,
};
