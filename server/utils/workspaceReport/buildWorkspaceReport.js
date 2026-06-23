const { DocumentIntelligence } = require("../../models/documentIntelligence");
const { DocumentComparisons } = require("../../models/documentComparisons");
const { Document } = require("../../models/documents");
const { buildWorkspaceGraph } = require("../workspaceGraph");
const { buildExecutiveSummary } = require("./executiveSummary");
const {
  detectDocumentRisks,
  detectReviewRisks,
  dedupeRisks,
  formatRiskTable,
  summarizeRisks,
} = require("./riskSummary");
const { buildReviewOrder } = require("./recommendationEngine");
const { validateWorkspaceReport } = require("./validateReport");

const REPORT_CACHE_TTL_MS = 60_000;
const reportCache = new Map();

/**
 * @param {number} workspaceId
 * @returns {string}
 */
function cacheKey(workspaceId) {
  return `workspace-report:${workspaceId}`;
}

/**
 * @param {number} workspaceId
 */
function invalidateReportCache(workspaceId) {
  reportCache.delete(cacheKey(workspaceId));
}

/**
 * Build a one-page executive workspace intelligence report.
 * Uses stored metadata only — no LLM calls.
 *
 * @param {object} params
 * @param {object} params.workspace
 * @param {boolean} [params.skipCache]
 * @returns {Promise<object>}
 */
async function buildWorkspaceReport({ workspace, skipCache = false }) {
  const workspaceId = workspace.id;
  const key = cacheKey(workspaceId);

  if (!skipCache) {
    const cached = reportCache.get(key);
    if (cached && Date.now() - cached.timestamp < REPORT_CACHE_TTL_MS) {
      return {
        ...cached.report,
        meta: { ...cached.report.meta, cached: true },
      };
    }
  }

  const [intelligence, overview, statusCounts, graph, reviewsDashboard, embedded] =
    await Promise.all([
      DocumentIntelligence.forWorkspace(workspaceId, {
        status: "complete",
        limit: 500,
      }),
      DocumentIntelligence.getWorkspaceOverview(workspaceId),
      DocumentIntelligence.statusCounts(workspaceId),
      buildWorkspaceGraph({
        workspaceId,
        workspaceSlug: workspace.slug,
        skipCache,
      }),
      DocumentComparisons.dashboard(workspaceId),
      Document.forWorkspace(workspaceId),
    ]);

  const reviews = await DocumentComparisons.forWorkspace(workspaceId, {
    limit: 50,
    riskLevel: null,
  });

  const documentRisks = detectDocumentRisks(intelligence);
  const reviewRisks = detectReviewRisks(reviews);
  const allRisks = dedupeRisks([...documentRisks, ...reviewRisks]);
  const riskSummary = summarizeRisks(documentRisks, reviewRisks);
  const riskTable = formatRiskTable(allRisks);

  const executiveSummary = buildExecutiveSummary({
    overview,
    graph,
    riskSummary,
    risks: allRisks,
    reviewsDashboard,
    intelligenceStatus: statusCounts,
  });

  const reviewOrder = buildReviewOrder({
    risks: allRisks,
    intelligence,
    duplicates: graph.duplicates || [],
  });

  const report = {
    executiveSummary,
    categoryDistribution: graph.distributions?.category?.items || graph.categoryDistribution || [],
    fileTypeDistribution: graph.distributions?.fileType?.items || graph.fileTypeDistribution || [],
    distributions: graph.distributions || {
      category: {
        items: graph.categoryDistribution || [],
        totalDocuments: graph.meta?.documentCount ?? intelligence.length,
        sumCounts: (graph.categoryDistribution || []).reduce(
          (sum, item) => sum + item.count,
          0
        ),
      },
      fileType: {
        items: graph.fileTypeDistribution || [],
        totalDocuments: graph.meta?.documentCount ?? intelligence.length,
        sumCounts: (graph.fileTypeDistribution || []).reduce(
          (sum, item) => sum + item.count,
          0
        ),
      },
    },
    topTopics: graph.majorTopics || overview.topTopics || [],
    clusters: (graph.clusters || []).map((cluster) => ({
      id: cluster.id,
      label: cluster.label,
      documentCount: cluster.documentCount,
      confidence: cluster.confidence,
      dominantTopics: cluster.dominantTopics || [],
      topics: cluster.topics,
      documents: cluster.documents,
    })),
    duplicates: graph.duplicates || [],
    risks: allRisks,
    riskTable,
    riskSummary,
    reviewOrder,
    recommendations: reviewOrder,
    reviews: {
      total: reviewsDashboard.totalReviews,
      averageRiskScore: reviewsDashboard.averageRiskScore,
      highRiskCount: reviewsDashboard.highRiskReviews,
      recent: reviewsDashboard.recentReviews || [],
    },
    intelligence: {
      overview,
      status: statusCounts,
      embeddedDocuments: embedded.length,
    },
    meta: {
      workspaceId,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      documentCount: graph.meta?.documentCount ?? intelligence.length,
      generatedAt: new Date().toISOString(),
      cached: false,
      sources: [
        "document_intelligence",
        "workspace_graph",
        "document_comparisons",
      ],
    },
  };

  const validationIssues = validateWorkspaceReport(report);
  report.meta.validation = {
    valid: validationIssues.length === 0,
    issues: validationIssues,
  };

  reportCache.set(key, { report, timestamp: Date.now() });
  return report;
}

/**
 * Format report as markdown for chat context injection.
 *
 * @param {object} report
 * @returns {string}
 */
function formatReportAsContext(report) {
  const lines = [
    "## Workspace Executive Intelligence Report",
    "",
    `Generated: ${report.meta?.generatedAt || "now"}`,
    `Documents analyzed: ${report.meta?.documentCount ?? 0}`,
    "",
    "### Executive Summary",
    report.executiveSummary?.summary ||
      report.executiveSummary?.paragraphs?.[0] ||
      "No summary available.",
    "",
    "### KPIs",
    `- Documents: ${report.executiveSummary?.kpis?.documents ?? 0}`,
    `- Categories: ${report.executiveSummary?.kpis?.categories ?? 0}`,
    `- Topics: ${report.executiveSummary?.kpis?.topics ?? 0}`,
    `- Clusters: ${report.executiveSummary?.kpis?.clusters ?? 0}`,
    `- Duplicates: ${report.executiveSummary?.kpis?.duplicates ?? 0}`,
    `- High risk documents: ${report.executiveSummary?.kpis?.highRiskDocuments ?? 0}`,
    `- High risk reviews: ${report.executiveSummary?.kpis?.highRiskReviews ?? 0}`,
    `- High risk indicators: ${report.executiveSummary?.kpis?.highRiskIndicators ?? 0}`,
    "",
  ];

  if (report.categoryDistribution?.length) {
    lines.push("### Category Distribution");
    for (const item of report.categoryDistribution.slice(0, 12)) {
      lines.push(`- ${item.label}: ${item.count}`);
    }
    lines.push("");
  }

  if (report.fileTypeDistribution?.length) {
    lines.push("### File Type Distribution");
    for (const item of report.fileTypeDistribution.slice(0, 12)) {
      lines.push(`- ${item.label}: ${item.count}`);
    }
    lines.push("");
  }

  if (report.topTopics?.length) {
    lines.push("### Top Topics");
    for (const topic of report.topTopics.slice(0, 10)) {
      const count = topic.documentCount ?? topic.count ?? 0;
      lines.push(`- **${topic.topic}** (${count} documents)`);
    }
    lines.push("");
  }

  if (report.clusters?.length) {
    lines.push("### Document Clusters");
    for (const cluster of report.clusters.slice(0, 10)) {
      lines.push(
        `- **${cluster.label}** — ${cluster.documentCount} docs, confidence ${cluster.confidence ?? "—"}%`
      );
    }
    lines.push("");
  }

  if (report.riskTable?.length) {
    lines.push("### Risk Indicators");
    lines.push("| Document | Risk Reason | Severity |");
    lines.push("| --- | --- | --- |");
    for (const row of report.riskTable.slice(0, 20)) {
      lines.push(`| ${row.document} | ${row.riskReason} | ${row.severity} |`);
    }
    lines.push("");
  }

  if (report.reviewOrder?.length) {
    lines.push("### Recommended Review Order");
    for (const item of report.reviewOrder.slice(0, 15)) {
      lines.push(`${item.rank}. ${item.document}`);
    }
    lines.push("");
  }

  if (report.duplicates?.length) {
    lines.push("### Duplicate Files");
    for (const dup of report.duplicates.slice(0, 5)) {
      lines.push(
        `- ${dup.titles?.[0]} ↔ ${dup.titles?.[1]} (${Math.round((dup.similarityScore || 0) * 100)}%)`
      );
    }
  }

  return lines.join("\n");
}

module.exports = {
  REPORT_CACHE_TTL_MS,
  buildWorkspaceReport,
  formatReportAsContext,
  invalidateReportCache,
  validateWorkspaceReport,
};
