/**
 * Build a factual executive summary from workspace intelligence rollups.
 * No LLM calls. No advisory language.
 */

/**
 * @param {object} params
 * @returns {string}
 */
function buildFactualSummary({
  documentCount = 0,
  categoryCount = 0,
  topCategory = null,
  duplicateCount = 0,
  highRiskDocumentCount = 0,
  highRiskReviewCount = 0,
  clusterCount = 0,
  pendingEnrichment = 0,
}) {
  if (documentCount === 0) {
    return "This workspace contains no enriched documents.";
  }

  const parts = [
    `This workspace contains ${documentCount} document${documentCount === 1 ? "" : "s"} across ${categoryCount} categor${categoryCount === 1 ? "y" : "ies"}.`,
  ];

  if (topCategory) {
    if (topCategory.percentage === 100) {
      parts.push(`${topCategory.label} is the only category.`);
    } else {
      parts.push(
        `${topCategory.label} is the dominant category (${topCategory.percentage}%).`
      );
    }
  }

  if (clusterCount > 0) {
    parts.push(
      `Documents are organized into ${clusterCount} semantic cluster${clusterCount === 1 ? "" : "s"}.`
    );
  }

  parts.push(
    duplicateCount === 0
      ? "No duplicate files detected."
      : `${duplicateCount} near-duplicate file pair${duplicateCount === 1 ? "" : "s"} detected.`
  );

  if (highRiskDocumentCount === 0 && highRiskReviewCount === 0) {
    parts.push("No high-severity risks detected.");
  } else {
    if (highRiskDocumentCount === 1) {
      parts.push("One document is classified as high risk.");
    } else if (highRiskDocumentCount > 1) {
      parts.push(
        `${highRiskDocumentCount} documents are classified as high risk.`
      );
    }

    if (highRiskReviewCount === 1) {
      parts.push("One comparison review is classified as high risk.");
    } else if (highRiskReviewCount > 1) {
      parts.push(
        `${highRiskReviewCount} comparison reviews are classified as high risk.`
      );
    }
  }

  if (pendingEnrichment > 0) {
    parts.push(
      `Intelligence enrichment is pending for ${pendingEnrichment} document${pendingEnrichment === 1 ? "" : "s"}.`
    );
  }

  return parts.join(" ");
}

/**
 * @param {object[]} risks
 * @returns {number}
 */
function countHighRiskDocuments(risks = []) {
  const highRiskDocIds = new Set();

  for (const risk of risks) {
    if (String(risk.severity || "").toUpperCase() !== "HIGH") continue;
    if (risk.type === "comparison_review") continue;
    if (risk.documentId) highRiskDocIds.add(risk.documentId);
  }

  return highRiskDocIds.size;
}

/**
 * @param {object[]} risks
 * @returns {number}
 */
function countHighRiskReviews(risks = []) {
  return risks.filter(
    (risk) =>
      risk.type === "comparison_review" &&
      String(risk.severity || "").toUpperCase() === "HIGH"
  ).length;
}

/**
 * @param {object[]} risks
 * @returns {number}
 */
function countHighSeverityIndicators(risks = []) {
  return risks.filter(
    (risk) => String(risk.severity || "").toUpperCase() === "HIGH"
  ).length;
}

/**
 * @param {object} params
 * @returns {object}
 */
function buildExecutiveSummary({
  overview = {},
  graph = {},
  riskSummary = {},
  risks = [],
  reviewsDashboard = {},
  intelligenceStatus = {},
}) {
  const documentCount = graph.meta?.documentCount ?? overview.documents ?? 0;
  const clusterCount = graph.meta?.clusterCount ?? 0;
  const duplicateCount = graph.meta?.duplicateCount ?? graph.duplicates?.length ?? 0;
  const categoryItems =
    graph.distributions?.category?.items || graph.categoryDistribution || [];
  const categoryCount = categoryItems.length;
  const topCategory = categoryItems[0] || null;
  const topicCount = graph.meta?.topicCount ?? overview.topTopics?.length ?? 0;
  const pending =
    (intelligenceStatus.pending ?? 0) + (intelligenceStatus.processing ?? 0);
  const highRiskDocuments = countHighRiskDocuments(risks);
  const highRiskReviews = countHighRiskReviews(risks);
  const highRiskIndicators = countHighSeverityIndicators(risks);

  const summary = buildFactualSummary({
    documentCount,
    categoryCount,
    topCategory,
    duplicateCount,
    highRiskDocumentCount: highRiskDocuments,
    highRiskReviewCount: highRiskReviews,
    clusterCount,
    pendingEnrichment: pending,
  });

  return {
    headline: "Workspace Intelligence Briefing",
    summary,
    paragraphs: [summary],
    kpis: {
      documents: documentCount,
      categories: categoryCount,
      topics: topicCount,
      clusters: clusterCount,
      duplicates: duplicateCount,
      highRiskDocuments,
      highRiskReviews,
      highRiskIndicators,
      riskIndicators: riskSummary.total ?? 0,
      relationships: graph.meta?.relationshipCount ?? 0,
      fileTypes:
        graph.distributions?.fileType?.items?.length ||
        graph.fileTypeDistribution?.length ||
        0,
      intelligencePending: intelligenceStatus.pending ?? 0,
      intelligenceProcessing: intelligenceStatus.processing ?? 0,
      intelligenceComplete: intelligenceStatus.complete ?? documentCount,
    },
  };
}

module.exports = {
  buildExecutiveSummary,
  buildFactualSummary,
  countHighRiskDocuments,
  countHighRiskReviews,
  countHighSeverityIndicators,
};
