const { buildWorkspaceReport } = require("../workspaceReport");
const { DocumentIntelligence } = require("../../models/documentIntelligence");

const DOCUMENT_TABLE_PAGE_SIZE = 50;
const ONE_LINE_SUMMARY_MAX = 160;
const MAX_SYNTHESIS_CATALOG_LINES = 250;

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const DOMAIN_SIGNALS = {
  financial: [
    /\b(revenue|invoice|payment|stock|sales|financial|accounting|budget|profit|cost|expense|billing)\b/i,
    /\b(ledger|payable|receivable|margin|earnings)\b/i,
  ],
  legal: [
    /\b(agreement|contract|clause|arbitration|legal|nda|liability|terms|indemnity|warranty)\b/i,
    /\b(retainer|settlement|compliance|jurisdiction)\b/i,
  ],
  research: [
    /\b(research|methodology|findings|study|analysis|hypothesis|experiment|literature)\b/i,
    /\b(dataset|survey|sample|conclusion)\b/i,
  ],
  hr: [
    /\b(employee|hiring|onboarding|payroll|benefits|personnel|recruitment|compensation)\b/i,
    /\b(performance review|leave policy|workforce)\b/i,
  ],
  technical: [
    /\b(api|code|software|technical|architecture|implementation|system|deployment)\b/i,
    /\b(infrastructure|database|integration|specification)\b/i,
  ],
};

const SUGGESTED_QUESTIONS_BY_DOMAIN = {
  financial: [
    "Compare yearly revenue across documents.",
    "Which invoices or reports show the highest values?",
    "Show payment or billing trends over time.",
  ],
  legal: [
    "Compare arbitration or liability clauses across agreements.",
    "Show payment term differences between contracts.",
    "Which documents contain the highest-risk clauses?",
  ],
  research: [
    "Summarize the main findings across documents.",
    "Compare methodologies used in each study.",
    "Which datasets or samples overlap?",
  ],
  hr: [
    "Summarize hiring and onboarding policies.",
    "Compare compensation or benefits terms.",
    "Which documents cover performance review criteria?",
  ],
  technical: [
    "Summarize system architecture across documents.",
    "Compare API or integration requirements.",
    "Which specs define deployment constraints?",
  ],
  general: [
    "Compare the two most recent documents.",
    "What topics appear in the most files?",
    "Which files should be reviewed first?",
  ],
};

const METRIC_TOPIC_PATTERNS = [
  /\bunits?\s+sold\b/i,
  /\bunits?\s+in\s+stock\b/i,
  /\bunit\s+price\b/i,
  /\brevenue\b/i,
  /\binventory\b/i,
  /\bprofit\b/i,
  /\bmargin\b/i,
  /\bheadcount\b/i,
  /\bturnover\b/i,
  /\bamount\b/i,
  /\bquantity\b/i,
  /\bprice\b/i,
  /\bcost\b/i,
  /\bsales\b/i,
];

const WORKSPACE_SYNTHESIS_SYSTEM_PROMPT = `You are a document intelligence analyst synthesizing a workspace from pre-indexed document summaries.

Rules:
- Use ONLY the rollup data and document catalog provided. Never claim you lack access.
- Never reference opening PDFs or raw files. Summaries are already indexed.
- Produce ONLY the markdown sections requested. Do not repeat the document table.
- Be factual, concise, and non-repetitive.
- Overall Insights: maximum 4–5 sentences.
- Use bullet lists for Common Themes, Key Differences, and Suggested Questions.
- Do not invent documents, metrics, or dates not supported by the provided catalog.`;

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeForDedup(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "")
    .trim();
}

/**
 * @param {string} text
 * @returns {string}
 */
function sanitizeResponseQuality(text = "") {
  if (!text || typeof text !== "string") return "";

  const lines = text.split("\n");
  const seenLines = new Set();
  const seenParagraphs = new Set();
  const output = [];
  let paragraphBuffer = [];

  const flushParagraph = () => {
    if (!paragraphBuffer.length) return;
    const paragraph = paragraphBuffer.join("\n").trim();
    paragraphBuffer = [];
    if (!paragraph) return;

    const key = normalizeForDedup(paragraph);
    if (key && seenParagraphs.has(key)) return;
    if (key) seenParagraphs.add(key);
    output.push(paragraph);
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const lineKey = normalizeForDedup(trimmed);
    if (
      (trimmed.startsWith("•") ||
        trimmed.startsWith("-") ||
        trimmed.startsWith("*")) &&
      lineKey
    ) {
      if (seenLines.has(lineKey)) continue;
      seenLines.add(lineKey);
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      flushParagraph();
      if (lineKey && seenLines.has(`heading:${lineKey}`)) continue;
      if (lineKey) seenLines.add(`heading:${lineKey}`);
      output.push(trimmed);
      continue;
    }

    paragraphBuffer.push(line);
  }

  flushParagraph();
  return output.join("\n\n").trim();
}

/**
 * @param {string} message
 * @returns {boolean}
 */
function isWorkspaceSummaryRequest(message = "") {
  if (!message || typeof message !== "string") return false;
  const normalized = message.trim();
  if (!normalized) return false;
  if (/@\S/.test(normalized)) return false;

  const { isWorkspaceSummaryQuery } = require("./contextRouting");
  return isWorkspaceSummaryQuery(normalized);
}

/**
 * @param {string} filename
 * @returns {string}
 */
function displayFilename(filename = "") {
  return String(filename || "Unknown").replace(/\.json$/i, "");
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeMarkdownTableCell(value = "") {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

/**
 * @param {string} summary
 * @param {number} [maxLen]
 * @returns {string}
 */
function toOneLineSummary(summary = "", maxLen = ONE_LINE_SUMMARY_MAX) {
  const normalized = String(summary || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "Summary not yet available.";
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 1)}…`;
}

/**
 * @param {object[]} intelligence
 * @returns {string|null}
 */
function extractDateRange(intelligence = []) {
  const timestamps = [];

  for (const doc of intelligence) {
    const filename = String(doc.filename || "");
    const yearMonth = filename.match(/(20\d{2})[-_/.](\d{1,2})/);
    if (yearMonth) {
      timestamps.push({
        year: Number(yearMonth[1]),
        month: Number(yearMonth[2]),
      });
      continue;
    }

    const monthYear = filename.match(
      /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-_\s]?(20\d{2})/i
    );
    if (monthYear) {
      const monthIndex = MONTH_NAMES.findIndex((name) =>
        monthYear[1].toLowerCase().startsWith(name.toLowerCase())
      );
      timestamps.push({
        year: Number(monthYear[2]),
        month: monthIndex >= 0 ? monthIndex + 1 : 1,
      });
      continue;
    }

    const yearOnly = filename.match(/(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/);
    if (yearOnly) {
      timestamps.push({ year: Number(yearOnly[1]), month: 1 });
    }
  }

  if (!timestamps.length) return null;

  const sorted = timestamps.sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
  });

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const formatPoint = ({ year, month }) =>
    month ? `${MONTH_NAMES[month - 1]} ${year}` : String(year);

  if (first.year === last.year && first.month === last.month) {
    return formatPoint(first);
  }

  return `${formatPoint(first)} – ${formatPoint(last)}`;
}

/**
 * @param {object} report
 * @param {object[]} intelligence
 * @returns {string}
 */
function detectWorkspaceDomain(report = {}, intelligence = []) {
  const corpus = [
    ...(report.categoryDistribution || []).map((item) => item.label),
    ...(report.topTopics || []).map((item) => item.topic),
    ...intelligence.map((doc) => doc.category),
    ...intelligence.map((doc) => doc.documentType),
    ...intelligence.flatMap((doc) => doc.keyTopics || []),
    ...intelligence.flatMap((doc) => doc.keywords || []),
  ]
    .filter(Boolean)
    .join(" ");

  let bestDomain = "general";
  let bestScore = 0;

  for (const [domain, patterns] of Object.entries(DOMAIN_SIGNALS)) {
    const score = patterns.reduce(
      (sum, pattern) => sum + (pattern.test(corpus) ? 1 : 0),
      0
    );
    if (score > bestScore) {
      bestScore = score;
      bestDomain = domain;
    }
  }

  return bestDomain;
}

/**
 * @param {object[]} intelligence
 * @param {object} report
 * @returns {object}
 */
function aggregateIntelligenceRollups(intelligence = [], report = {}) {
  const topicCounts = {};
  const keywordCounts = {};
  const categoryCounts = {};
  const fileTypeCounts = {};
  const documentTypeCounts = {};

  for (const doc of intelligence) {
    const category = doc.category || "general";
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;

    const fileType = (doc.fileType || "unknown").toLowerCase();
    fileTypeCounts[fileType] = (fileTypeCounts[fileType] || 0) + 1;

    if (doc.documentType) {
      const docType = String(doc.documentType).toLowerCase();
      documentTypeCounts[docType] =
        (documentTypeCounts[docType] || 0) + 1;
    }

    for (const topic of doc.keyTopics || []) {
      const key = String(topic).trim().toLowerCase();
      if (!key) continue;
      topicCounts[key] = (topicCounts[key] || 0) + 1;
    }

    for (const keyword of doc.keywords || []) {
      const key = String(keyword).trim().toLowerCase();
      if (!key) continue;
      keywordCounts[key] = (keywordCounts[key] || 0) + 1;
    }
  }

  const topTopics = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([topic, count]) => ({ topic, count }));

  const recurringEntities = Object.entries(keywordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([entity, count]) => ({ entity, count }));

  const metrics = [];
  for (const [topic, count] of Object.entries(topicCounts)) {
    if (METRIC_TOPIC_PATTERNS.some((pattern) => pattern.test(topic))) {
      metrics.push({
        label: topic.replace(/\b\w/g, (char) => char.toUpperCase()),
        count,
      });
    }
  }
  for (const [entity, count] of Object.entries(keywordCounts)) {
    if (
      METRIC_TOPIC_PATTERNS.some((pattern) => pattern.test(entity)) &&
      !metrics.some((item) => item.label.toLowerCase() === entity)
    ) {
      metrics.push({
        label: entity.replace(/\b\w/g, (char) => char.toUpperCase()),
        count,
      });
    }
  }

  const dateRange = extractDateRange(intelligence);
  const domain = detectWorkspaceDomain(report, intelligence);
  const documentCount = intelligence.length;
  const datedFilenames = intelligence.filter((doc) =>
    /(20\d{2})/.test(String(doc.filename || ""))
  ).length;

  const patterns = [];
  if (dateRange?.includes("–")) {
    patterns.push("Documents span a recurring time range.");
  }
  if (datedFilenames >= Math.max(3, Math.floor(documentCount * 0.5))) {
    patterns.push("Filenames suggest periodic or dated reporting.");
  }
  const topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0];
  if (topCategory && topCategory[1] / Math.max(documentCount, 1) >= 0.6) {
    patterns.push(`Most files share the "${topCategory[0]}" category.`);
  }
  if ((report.duplicates || []).length === 0) {
    patterns.push("No near-duplicate files detected.");
  }

  return {
    documentCount,
    dateRange,
    domain,
    topTopics,
    recurringEntities,
    metrics: metrics.slice(0, 8),
    categories: Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count })),
    fileTypes: Object.entries(fileTypeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count })),
    documentTypes: Object.entries(documentTypeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count })),
    patterns,
    summariesAvailable: intelligence.filter((doc) => Boolean(doc.summary?.trim()))
      .length,
  };
}

/**
 * @param {object[]} intelligence
 * @param {{ page?: number, pageSize?: number }} [options]
 * @returns {{ rows: object[], total: number, page: number, pageSize: number, hasMore: boolean }}
 */
function buildDocumentCatalogRows(
  intelligence = [],
  { page = 1, pageSize = DOCUMENT_TABLE_PAGE_SIZE } = {}
) {
  const sorted = [...intelligence].sort((a, b) =>
    displayFilename(a.filename).localeCompare(displayFilename(b.filename))
  );
  const total = sorted.length;
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.max(1, Number(pageSize) || DOCUMENT_TABLE_PAGE_SIZE);
  const start = (safePage - 1) * safePageSize;
  const pageRows = sorted.slice(start, start + safePageSize);

  const rows = pageRows.map((doc) => ({
    filename: displayFilename(doc.filename),
    summary: toOneLineSummary(doc.summary),
    category: doc.category || null,
    documentType: doc.documentType || null,
  }));

  return {
    rows,
    total,
    page: safePage,
    pageSize: safePageSize,
    hasMore: start + pageRows.length < total,
  };
}

/**
 * @param {object[]} intelligence
 * @param {{ page?: number, pageSize?: number }} [options]
 * @returns {string}
 */
function buildDocumentSummaryTable(
  intelligence = [],
  { page = 1, pageSize = DOCUMENT_TABLE_PAGE_SIZE } = {}
) {
  const catalog = buildDocumentCatalogRows(intelligence, { page, pageSize });
  if (!catalog.total) {
    return "## Document Summary Table\n\nNo indexed documents with intelligence summaries.";
  }

  const lines = [
    "## Document Summary Table",
    "",
    `| Document | Summary |`,
    `| --- | --- |`,
  ];

  for (const row of catalog.rows) {
    lines.push(
      `| ${escapeMarkdownTableCell(row.filename)} | ${escapeMarkdownTableCell(row.summary)} |`
    );
  }

  if (catalog.total > catalog.pageSize) {
    const from = (catalog.page - 1) * catalog.pageSize + 1;
    const to = from + catalog.rows.length - 1;
    lines.push(
      "",
      `_Showing documents ${from}–${to} of ${catalog.total}. Remaining documents are indexed and included in the workspace synthesis._`
    );
  }

  return lines.join("\n");
}

/**
 * @param {object} rollups
 * @param {string} [workspaceName]
 * @returns {string}
 */
function buildOverviewSection(rollups = {}, workspaceName = null) {
  const lines = ["## Overview", ""];

  if (workspaceName) {
    lines.push(`**Workspace:** ${workspaceName}`);
  }

  lines.push(`**Total documents:** ${rollups.documentCount ?? 0}`);
  lines.push(
    `**Summaries available:** ${rollups.summariesAvailable ?? 0} of ${rollups.documentCount ?? 0}`
  );

  if (rollups.fileTypes?.length) {
    const typeSummary = rollups.fileTypes
      .slice(0, 6)
      .map((item) => `${item.label.toUpperCase()} (${item.count})`)
      .join(", ");
    lines.push(`**Document types:** ${typeSummary}`);
  }

  if (rollups.dateRange) {
    lines.push(`**Time coverage:** ${rollups.dateRange}`);
  }

  if (rollups.topTopics?.length) {
    const topics = rollups.topTopics
      .slice(0, 6)
      .map((item) => item.topic)
      .join(", ");
    lines.push(`**Recurring topics:** ${topics}`);
  }

  if (rollups.recurringEntities?.length) {
    const entities = rollups.recurringEntities
      .slice(0, 6)
      .map((item) => item.entity)
      .join(", ");
    lines.push(`**Recurring entities:** ${entities}`);
  }

  return lines.join("\n");
}

/**
 * @param {object} rollups
 * @returns {string}
 */
function buildRecurringMetricsSection(rollups = {}) {
  const lines = ["## Recurring Metrics", ""];

  if (!rollups.metrics?.length) {
    lines.push("• No recurring metric fields were detected across document summaries.");
    return lines.join("\n");
  }

  for (const metric of rollups.metrics) {
    lines.push(`• ${metric.label} (appears in ${metric.count} document summaries)`);
  }

  return lines.join("\n");
}

/**
 * @param {object} rollups
 * @param {object[]} intelligence
 * @param {string} [workspaceName]
 * @returns {string}
 */
function buildSynthesisUserPrompt(rollups = {}, intelligence = [], workspaceName = null) {
  const catalogLines = [...intelligence]
    .sort((a, b) =>
      displayFilename(a.filename).localeCompare(displayFilename(b.filename))
    )
    .slice(0, MAX_SYNTHESIS_CATALOG_LINES)
    .map(
      (doc) =>
        `- ${displayFilename(doc.filename)}: ${toOneLineSummary(doc.summary, 120)}`
    );

  const omitted =
    intelligence.length > MAX_SYNTHESIS_CATALOG_LINES
      ? intelligence.length - MAX_SYNTHESIS_CATALOG_LINES
      : 0;

  return [
    workspaceName ? `Workspace: ${workspaceName}` : null,
  `Total documents: ${rollups.documentCount}`,
  rollups.dateRange ? `Time coverage: ${rollups.dateRange}` : null,
  `Domain signal: ${rollups.domain}`,
  rollups.categories?.length
    ? `Categories: ${rollups.categories.map((item) => `${item.label} (${item.count})`).join(", ")}`
    : null,
  rollups.topTopics?.length
    ? `Recurring topics: ${rollups.topTopics.map((item) => `${item.topic} (${item.count})`).join(", ")}`
    : null,
  rollups.recurringEntities?.length
    ? `Recurring entities: ${rollups.recurringEntities.map((item) => `${item.entity} (${item.count})`).join(", ")}`
    : null,
  rollups.patterns?.length ? `Key patterns: ${rollups.patterns.join(" ")}` : null,
  "",
  "Document catalog (pre-indexed summaries — do not regenerate):",
  ...catalogLines,
  omitted > 0
    ? `...and ${omitted} additional documents included in rollups above.`
    : null,
  "",
  "Produce ONLY these markdown sections:",
  "## Overall Insights",
  "## Common Themes",
  "## Key Differences",
  "## Suggested Questions",
  "",
  "Use bullet lists where appropriate. Do not include a document table.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * @param {object} rollups
 * @param {object[]} intelligence
 * @param {object} report
 * @param {string} [workspaceName]
 * @returns {{ deterministicPrefix: string, metadata: object }}
 */
function buildHierarchicalWorkspaceSummary({
  rollups,
  intelligence,
  report = {},
  workspaceName = null,
}) {
  const overview = buildOverviewSection(rollups, workspaceName);
  const documentTable = buildDocumentSummaryTable(intelligence);
  const recurringMetrics = buildRecurringMetricsSection(rollups);

  const deterministicPrefix = sanitizeResponseQuality(
    ["# Workspace Summary", "", overview, "", documentTable].join("\n")
  );

  const catalog = buildDocumentCatalogRows(intelligence);
  const metadata = {
    documents: rollups.documentCount,
    documentTypes: rollups.fileTypes?.length ?? 0,
    topics: rollups.topTopics?.length ?? 0,
    categories: rollups.categories?.length ?? 0,
    duplicates: report.duplicates?.length ?? 0,
    domain: rollups.domain,
    dateRange: rollups.dateRange,
    summariesAvailable: rollups.summariesAvailable,
    documentTable: {
      total: catalog.total,
      page: catalog.page,
      pageSize: catalog.pageSize,
      hasMore: catalog.hasMore,
      rows: catalog.rows,
    },
    recurringMetrics: rollups.metrics,
    kpis: report.executiveSummary?.kpis || {
      documents: rollups.documentCount,
      categories: rollups.categories?.length ?? 0,
      topics: rollups.topTopics?.length ?? 0,
      duplicates: report.duplicates?.length ?? 0,
    },
  };

  return {
    deterministicPrefix,
    recurringMetricsSection: recurringMetrics,
    metadata,
    synthesisUserPrompt: buildSynthesisUserPrompt(
      rollups,
      intelligence,
      workspaceName
    ),
  };
}

/**
 * @param {object} rollups
 * @param {string} [domain]
 * @returns {string}
 */
function buildFallbackSynthesisSections(rollups = {}, domain = "general") {
  const themes = (rollups.topTopics || [])
    .slice(0, 5)
    .map((item) => `• ${item.topic} (${item.count} documents)`);
  const differences = (rollups.categories || [])
    .slice(0, 4)
    .map((item) => `• ${item.label}: ${item.count} document(s)`);
  const questions = [
    ...(SUGGESTED_QUESTIONS_BY_DOMAIN[domain] || SUGGESTED_QUESTIONS_BY_DOMAIN.general),
  ];
  if (rollups.dateRange?.includes("–")) {
    const [start, end] = rollups.dateRange.split("–").map((part) => part.trim());
    if (start && end) questions.unshift(`Compare ${start} with ${end}.`);
  }

  const overview = [
    `This workspace contains ${rollups.documentCount} indexed document${rollups.documentCount === 1 ? "" : "s"}.`,
    rollups.dateRange
      ? `Coverage spans ${rollups.dateRange}.`
      : "Documents cover multiple topics and categories.",
    rollups.patterns?.[0] || "Summaries are available for workspace-level analysis.",
  ]
    .filter(Boolean)
    .join(" ");

  return sanitizeResponseQuality(
    [
      "## Overall Insights",
      overview,
      "",
      "## Common Themes",
      ...(themes.length ? themes : ["• No dominant themes detected."]),
      "",
      "## Key Differences",
      ...(differences.length
        ? differences
        : ["• Documents are relatively homogeneous."]),
      "",
      "## Suggested Questions",
      ...questions.slice(0, 5).map((item) => `• ${item}`),
    ].join("\n")
  );
}

/**
 * Assemble the final hierarchical response.
 * @param {object} params
 * @returns {string}
 */
function assembleHierarchicalResponse({
  deterministicPrefix = "",
  synthesisSections = "",
  recurringMetricsSection = "",
}) {
  return sanitizeResponseQuality(
    [deterministicPrefix, synthesisSections, recurringMetricsSection]
      .filter(Boolean)
      .join("\n\n")
  );
}

/**
 * @param {object} params
 * @param {object} params.workspace
 * @param {string} [params.message]
 * @returns {Promise<object>}
 */
async function performWorkspaceSummaryQuery({ workspace, message = "" }) {
  if (!isWorkspaceSummaryRequest(message)) {
    return { handled: false };
  }

  try {
    const [report, intelligence] = await Promise.all([
      buildWorkspaceReport({ workspace }),
      DocumentIntelligence.loadAllComplete(workspace.id),
    ]);

    if (!intelligence.length) {
      const emptyText = sanitizeResponseQuality(
        [
          "# Workspace Summary",
          "",
          "## Overview",
          "",
          "**Total documents:** 0",
          "",
          "## Document Summary Table",
          "",
          "No indexed documents with intelligence summaries.",
          "",
          "## Overall Insights",
          "This workspace has no enriched documents yet.",
        ].join("\n")
      );

      return {
        handled: true,
        directResponse: emptyText,
        metadata: {
          documents: 0,
          documentTypes: 0,
          topics: 0,
          categories: 0,
          duplicates: 0,
          domain: "general",
        },
        sources: [],
      };
    }

    const rollups = aggregateIntelligenceRollups(intelligence, report);
    const hierarchical = buildHierarchicalWorkspaceSummary({
      rollups,
      intelligence,
      report,
      workspaceName: workspace?.name || null,
    });

    return {
      handled: true,
      synthesisRequired: true,
      synthesisSystemPrompt: WORKSPACE_SYNTHESIS_SYSTEM_PROMPT,
      synthesisUserPrompt: hierarchical.synthesisUserPrompt,
      deterministicPrefix: hierarchical.deterministicPrefix,
      recurringMetricsSection: hierarchical.recurringMetricsSection,
      fallbackSynthesisSections: buildFallbackSynthesisSections(
        rollups,
        rollups.domain
      ),
      metadata: hierarchical.metadata,
      report,
      sources: [],
    };
  } catch (error) {
    console.error("[workspaceSummaryRetrieval]", error);
    return {
      handled: true,
      error: `Workspace summary generation failed: ${error.message}`,
    };
  }
}

module.exports = {
  DOCUMENT_TABLE_PAGE_SIZE,
  MAX_SYNTHESIS_CATALOG_LINES,
  WORKSPACE_SYNTHESIS_SYSTEM_PROMPT,
  DOMAIN_SIGNALS,
  SUGGESTED_QUESTIONS_BY_DOMAIN,
  sanitizeResponseQuality,
  isWorkspaceSummaryRequest,
  displayFilename,
  toOneLineSummary,
  detectWorkspaceDomain,
  extractDateRange,
  aggregateIntelligenceRollups,
  buildDocumentCatalogRows,
  buildDocumentSummaryTable,
  buildOverviewSection,
  buildRecurringMetricsSection,
  buildSynthesisUserPrompt,
  buildHierarchicalWorkspaceSummary,
  buildFallbackSynthesisSections,
  assembleHierarchicalResponse,
  performWorkspaceSummaryQuery,
};
