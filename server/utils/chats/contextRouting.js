const { Document } = require("../../models/documents");
const {
  normalizeSelectedDocumentIds,
  hasDocumentMentionScope,
} = require("./documentMention");
const { isProjectWideQuery } = require("./projectWideRetrieval");
const { isExecutiveReportQuery } = require("./workspaceReportRetrieval");
const {
  isWorkspaceGraphQuery,
  classifyGraphQuery,
} = require("./workspaceGraphRetrieval");

const WORKSPACE_INTENTS = {
  WORKSPACE_SUMMARY: "workspace_summary",
  PROJECT_WIDE_SUMMARY: "project_wide_summary",
  EXECUTIVE_REPORT: "executive_report",
  GRAPH_CLUSTERS: "graph_clusters",
  GRAPH_TOPICS: "graph_topics",
  GRAPH_GENERAL: "graph_general",
  DOCUMENT_SCOPE: "document_scope",
};

const EXPLICIT_EXECUTIVE_PATTERNS = [
  /\bexecutive\s+report\b/i,
  /\bexecutive\s+briefing\b/i,
  /\bworkspace\s+briefing\b/i,
  /\bwhat\s+should\s+i\s+review\s+first\b/i,
  /\b(show|list|what\s+are)\s+(the\s+)?key\s+risks?\b/i,
  /\bkey\s+risks?\s+(in|for|across)\s+(this\s+)?(workspace|project)\b/i,
  /\brecommended\s+(documents?|files?)\s+(for\s+)?review\b/i,
];

const WORKSPACE_SUMMARY_PATTERNS = [
  /\bsummari[sz]e\s+(this\s+)?(workspace|project)\b/i,
  /\bsummari[sz]e\s+all\s+(files?|documents?|uploads?)\b/i,
  /\bsummari[sz]e\s+(all\s+)?(documents?|files?)\b/i,
  /\bsummari[sz]e\s+\w+\s+folder\b/i,
  /\bsummari[sz]e\s+(the\s+)?folder\b/i,
  /\bsummari[sz]e\s+(everything|uploads?)\b/i,
  /\ball\s+files?\s+in\s+(this\s+)?workspace\b/i,
  /\btell\s+me\s+about\s+(this\s+)?(workspace|project)\b/i,
  /\bworkspace\s+summary\b/i,
  /\bsummari[sz]e\s+(the\s+)?workspace\b/i,
];

const CONTEXT_AVAILABLE_INSTRUCTIONS = `Important: Retrieved document context has been provided above in the Context section. You have direct access to the selected workspace documents through this context.
Do not claim you lack access to files, cannot read documents, cannot access external files, or need the user to upload materials.
Answer using the provided context. If the context does not contain the answer, state what is missing from the retrieved excerpts.`;

const REFUSAL_PATTERNS = [
  /\bi\s+don['']?t\s+have\s+access\b/i,
  /\bi\s+cannot\s+access\b/i,
  /\bi\s+can['']?t\s+access\b/i,
  /\bdo\s+not\s+have\s+access\b/i,
  /\bplease\s+upload\b/i,
  /\bupload\s+the\s+document\b/i,
  /\bi\s+do\s+not\s+have\s+the\s+document\b/i,
  /\bwithout\s+access\s+to\s+the\s+(file|document)\b/i,
  /\bi\s+don['']?t\s+have\s+the\s+document\b/i,
];

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {object} doc
 * @returns {string}
 */
function getDocumentLabel(doc) {
  try {
    const metadata = JSON.parse(doc?.metadata || "{}");
    return metadata?.title || doc?.filename || "Document";
  } catch {
    return doc?.filename || "Document";
  }
}

/**
 * @param {string} message
 * @returns {boolean}
 */
function isExplicitExecutiveReportQuery(message = "") {
  if (!message || typeof message !== "string") return false;
  return EXPLICIT_EXECUTIVE_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * @param {string} message
 * @returns {boolean}
 */
function isWorkspaceSummaryQuery(message = "") {
  if (!message || typeof message !== "string") return false;
  const normalized = message.trim();
  if (!normalized) return false;
  if (/@\S/.test(normalized)) return false;
  return (
    WORKSPACE_SUMMARY_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    isProjectWideQuery(normalized)
  );
}

/**
 * @param {string} message
 * @param {string|null} workspaceName
 * @returns {string}
 */
function stripWorkspaceReferences(message = "", workspaceName = null) {
  let clean = String(message || "");

  if (workspaceName) {
    clean = clean.replace(new RegExp(`\\b${escapeRegex(workspaceName)}\\b`, "gi"), " ");
  }

  clean = clean
    .replace(/\b(this|the|my)\s+(workspace|project|folder)\b/gi, " ")
    .replace(/\bfolder\b/gi, " ")
    .replace(/\bworkspace\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return clean;
}

/**
 * @param {string} message
 * @param {object} options
 * @returns {string}
 */
function normalizeWorkspaceUserQuestion(message = "", options = {}) {
  const { workspaceIntent = null, workspaceName = null } = options;
  const stripped = stripWorkspaceReferences(message, workspaceName);

  if (
    workspaceIntent === WORKSPACE_INTENTS.WORKSPACE_SUMMARY ||
    workspaceIntent === WORKSPACE_INTENTS.PROJECT_WIDE_SUMMARY
  ) {
    if (!stripped || /^summari[sz]e$/i.test(stripped) || stripped.length < 12) {
      return "Summarize this workspace.";
    }
    if (!/summari[sz]e/i.test(stripped)) {
      return `Summarize this workspace. ${stripped}`.trim();
    }
    return stripped;
  }

  if (workspaceIntent === WORKSPACE_INTENTS.EXECUTIVE_REPORT) {
    if (!stripped || stripped.length < 8) {
      return "Generate an executive report for this workspace.";
    }
    return stripped;
  }

  return stripped || message.trim();
}

/**
 * @param {string} mentionText
 * @param {object[]} workspaceDocs
 * @returns {object|null}
 */
function resolveMentionTextToDocument(mentionText = "", workspaceDocs = []) {
  const normalized = String(mentionText).trim().toLowerCase();
  if (!normalized) return null;

  for (const doc of workspaceDocs) {
    const label = getDocumentLabel(doc).toLowerCase();
    const filename = String(doc.filename || "").toLowerCase();
    const basename = String(doc.docpath || "")
      .split("/")
      .pop()
      ?.toLowerCase();

    if (
      normalized === label ||
      normalized === filename ||
      normalized === basename
    ) {
      return doc;
    }
  }

  for (const doc of workspaceDocs) {
    const label = getDocumentLabel(doc).toLowerCase();
    if (label.includes(normalized) || normalized.includes(label)) {
      return doc;
    }
  }

  return null;
}

/**
 * @param {string} message
 * @param {object[]} workspaceDocs
 */
function parseDocumentMentionsFromMessage(message = "", workspaceDocs = []) {
  if (!message || typeof message !== "string") {
    return { cleanMessage: "", mentions: [], resolvedDocIds: [] };
  }

  let cleanMessage = message;
  const mentions = [];
  const resolvedDocIds = [];

  const legacyMatches = [...message.matchAll(/@document\/(\S+)/gi)];
  for (const match of legacyMatches) {
    const pathSuffix = match[1];
    const doc = workspaceDocs.find(
      (item) =>
        item.docpath === pathSuffix ||
        item.docpath?.endsWith(`/${pathSuffix}`) ||
        item.docpath?.includes(pathSuffix)
    );
    if (doc?.docId) {
      resolvedDocIds.push(doc.docId);
      mentions.push({
        text: match[0],
        docId: doc.docId,
        label: getDocumentLabel(doc),
      });
      cleanMessage = cleanMessage.split(match[0]).join(" ");
    }
  }

  const mentionMatches = [...cleanMessage.matchAll(/@(\S+)/g)];
  for (const match of mentionMatches) {
    const mentionText = match[1];
    if (mentionText.toLowerCase().startsWith("document/")) continue;

    const doc = resolveMentionTextToDocument(mentionText, workspaceDocs);
    if (doc?.docId) {
      resolvedDocIds.push(doc.docId);
      mentions.push({
        text: match[0],
        docId: doc.docId,
        label: getDocumentLabel(doc),
      });
      cleanMessage = cleanMessage.split(match[0]).join(" ");
    }
  }

  cleanMessage = cleanMessage.replace(/\s+/g, " ").trim();

  const uniqueIds = [...new Set(resolvedDocIds)];
  if (uniqueIds.length >= 2) {
    cleanMessage = cleanMessage
      .replace(/\bcompare\s+(with|and|vs\.?|versus|to)\s*$/i, "Compare these documents.")
      .replace(/\bcompare\s*$/i, "Compare these documents.")
      .trim();
    if (!cleanMessage || cleanMessage.length < 8) {
      cleanMessage = "Compare these documents.";
    }
  } else if (uniqueIds.length === 1) {
    if (!cleanMessage || cleanMessage.length < 4) {
      cleanMessage = "Summarize this document.";
    }
  }

  return {
    cleanMessage,
    mentions,
    resolvedDocIds: uniqueIds,
  };
}

/**
 * @param {string} message
 * @param {boolean} hasDocumentScope
 * @returns {string|null}
 */
function detectWorkspaceIntent(message = "", hasDocumentScope = false) {
  if (hasDocumentScope) return WORKSPACE_INTENTS.DOCUMENT_SCOPE;

  if (isExplicitExecutiveReportQuery(message)) {
    return WORKSPACE_INTENTS.EXECUTIVE_REPORT;
  }

  if (isWorkspaceGraphQuery(message)) {
    const graphType = classifyGraphQuery(message);
    if (graphType === "clusters" || graphType === "related-documents") {
      return WORKSPACE_INTENTS.GRAPH_CLUSTERS;
    }
    if (graphType === "major-topics") {
      return WORKSPACE_INTENTS.GRAPH_TOPICS;
    }
    return WORKSPACE_INTENTS.GRAPH_GENERAL;
  }

  if (isWorkspaceSummaryQuery(message)) {
    return WORKSPACE_INTENTS.WORKSPACE_SUMMARY;
  }

  return null;
}

/**
 * Exclusive retrieval plan — prevents recursive overlap between handlers.
 * @param {object} routing
 */
function getRetrievalPlan(routing = {}) {
  const intent = routing.workspaceIntent;

  if (routing.documentScopeActive) {
    return {
      runWorkspaceSummary: false,
      runExecutiveReport: false,
      runWorkspaceGraph: false,
      runDocumentDiff: true,
      forceProjectWide: false,
    };
  }

  switch (intent) {
    case WORKSPACE_INTENTS.EXECUTIVE_REPORT:
      return {
        runWorkspaceSummary: false,
        runExecutiveReport: true,
        runWorkspaceGraph: false,
        runDocumentDiff: false,
        forceProjectWide: false,
      };
    case WORKSPACE_INTENTS.GRAPH_CLUSTERS:
    case WORKSPACE_INTENTS.GRAPH_TOPICS:
    case WORKSPACE_INTENTS.GRAPH_GENERAL:
      return {
        runWorkspaceSummary: false,
        runExecutiveReport: false,
        runWorkspaceGraph: true,
        runDocumentDiff: false,
        forceProjectWide: false,
      };
    case WORKSPACE_INTENTS.WORKSPACE_SUMMARY:
    case WORKSPACE_INTENTS.PROJECT_WIDE_SUMMARY:
      return {
        runWorkspaceSummary: true,
        runExecutiveReport: false,
        runWorkspaceGraph: false,
        runDocumentDiff: false,
        forceProjectWide: false,
      };
    default:
      return {
        runWorkspaceSummary: false,
        runExecutiveReport: isExecutiveReportQuery(routing.cleanMessage),
        runWorkspaceGraph: isWorkspaceGraphQuery(routing.cleanMessage),
        runDocumentDiff: true,
        forceProjectWide: false,
      };
  }
}

async function resolveContextRouting({
  message = "",
  workspaceId,
  workspaceName = null,
  selectedDocumentIds = [],
  indexedDocumentCount = 0,
}) {
  const workspaceDocs = await Document.forWorkspace(workspaceId);
  const parsed = parseDocumentMentionsFromMessage(message, workspaceDocs);
  const mergedIds = [
    ...new Set([...(selectedDocumentIds || []), ...parsed.resolvedDocIds]),
  ];
  const validIds = await normalizeSelectedDocumentIds(workspaceId, mergedIds);
  const selectedDocuments = workspaceDocs
    .filter((doc) => validIds.includes(doc.docId))
    .map((doc) => ({
      docId: doc.docId,
      filename: doc.filename,
      label: getDocumentLabel(doc),
    }));

  let cleanMessage =
    parsed.cleanMessage.trim().length > 0 ? parsed.cleanMessage : message.trim();

  const workspaceIntent = detectWorkspaceIntent(
    cleanMessage,
    hasDocumentMentionScope(validIds)
  );

  if (!hasDocumentMentionScope(validIds)) {
    cleanMessage = stripWorkspaceReferences(cleanMessage, workspaceName) || cleanMessage;
  }

  const normalizedUserQuestion = normalizeWorkspaceUserQuestion(cleanMessage, {
    workspaceIntent,
    workspaceName,
  });

  const retrievalPlan = getRetrievalPlan({
    workspaceIntent,
    documentScopeActive: hasDocumentMentionScope(validIds),
    cleanMessage,
  });

  return {
    cleanMessage: normalizedUserQuestion,
    selectedDocumentIds: validIds,
    selectedDocuments,
    parsedMentions: parsed.mentions,
    workspaceIntent,
    documentScopeActive: hasDocumentMentionScope(validIds),
    indexedDocumentCount: indexedDocumentCount || workspaceDocs.length,
    workspaceName,
    retrievalPlan,
  };
}

function buildRoutedUserPrompt({
  cleanMessage = "",
  selectedDocuments = [],
  workspaceName = null,
  indexedDocumentCount = 0,
  workspaceIntent = null,
}) {
  const isWorkspaceIntent = [
    WORKSPACE_INTENTS.WORKSPACE_SUMMARY,
    WORKSPACE_INTENTS.PROJECT_WIDE_SUMMARY,
    WORKSPACE_INTENTS.EXECUTIVE_REPORT,
    WORKSPACE_INTENTS.GRAPH_CLUSTERS,
    WORKSPACE_INTENTS.GRAPH_TOPICS,
    WORKSPACE_INTENTS.GRAPH_GENERAL,
  ].includes(workspaceIntent);

  if (isWorkspaceIntent && workspaceName) {
    return [
      `Workspace:\n${workspaceName}`,
      `Indexed Documents:\n${indexedDocumentCount}`,
      `User Question:\n${cleanMessage}`,
    ].join("\n\n");
  }

  if (selectedDocuments.length > 0) {
    const bullets = selectedDocuments.map((doc) => `- ${doc.label}`).join("\n");
    return [
      `Selected Documents:\n${bullets}`,
      `User Question:\n${cleanMessage}`,
    ].join("\n\n");
  }

  return `User Question:\n${cleanMessage}`;
}

function applyContextAvailableInstructions(
  systemPrompt = "",
  retrievedChunkCount = 0
) {
  if (!retrievedChunkCount || retrievedChunkCount <= 0) return systemPrompt;
  if (!systemPrompt?.trim()) return CONTEXT_AVAILABLE_INSTRUCTIONS;
  return `${systemPrompt.trim()}\n\n${CONTEXT_AVAILABLE_INSTRUCTIONS}`;
}

function isInvalidNoAccessResponse(text = "", retrievedChunkCount = 0) {
  if (!retrievedChunkCount || retrievedChunkCount <= 0) return false;
  if (!text || typeof text !== "string") return false;
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(text));
}

function logContextRouting(params = {}) {
  console.log(
    JSON.stringify({
      event: "context_routing_before_llm",
      ...params,
      finalPromptPreview:
        typeof params.finalPromptPreview === "string"
          ? params.finalPromptPreview.slice(0, 500)
          : "",
    })
  );
}

module.exports = {
  WORKSPACE_INTENTS,
  WORKSPACE_SUMMARY_PATTERNS,
  CONTEXT_AVAILABLE_INSTRUCTIONS,
  REFUSAL_PATTERNS,
  getDocumentLabel,
  isWorkspaceSummaryQuery,
  isExplicitExecutiveReportQuery,
  stripWorkspaceReferences,
  normalizeWorkspaceUserQuestion,
  resolveMentionTextToDocument,
  parseDocumentMentionsFromMessage,
  detectWorkspaceIntent,
  getRetrievalPlan,
  resolveContextRouting,
  buildRoutedUserPrompt,
  applyContextAvailableInstructions,
  isInvalidNoAccessResponse,
  logContextRouting,
};
