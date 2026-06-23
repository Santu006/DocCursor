const { riskDedupeKey } = require("./riskSummary");

/**
 * @param {object} report
 * @returns {string[]}
 */
function validateWorkspaceReport(report = {}) {
  const issues = [];
  const totalDocuments = report.meta?.documentCount ?? 0;

  const categoryDistribution =
    report.distributions?.category?.items || report.categoryDistribution || [];
  const categorySum =
    report.distributions?.category?.sumCounts ??
    categoryDistribution.reduce((sum, item) => sum + (item.count || 0), 0);

  if (categorySum !== totalDocuments) {
    issues.push(
      `category distribution sum (${categorySum}) does not equal total documents (${totalDocuments})`
    );
  }

  const fileTypeDistribution =
    report.distributions?.fileType?.items || report.fileTypeDistribution || [];
  const fileTypeSum =
    report.distributions?.fileType?.sumCounts ??
    fileTypeDistribution.reduce((sum, item) => sum + (item.count || 0), 0);

  if (fileTypeSum !== totalDocuments) {
    issues.push(
      `file type distribution sum (${fileTypeSum}) does not equal total documents (${totalDocuments})`
    );
  }

  const clusteredDocuments = (report.clusters || []).reduce(
    (sum, cluster) => sum + (cluster.documentCount || 0),
    0
  );

  if (clusteredDocuments !== totalDocuments) {
    issues.push(
      `clustered documents (${clusteredDocuments}) does not equal total documents (${totalDocuments})`
    );
  }

  const riskKeys = new Set();
  for (const row of report.riskTable || []) {
    const key = riskDedupeKey(row);
    if (riskKeys.has(key)) {
      issues.push(`duplicate risk row: ${key}`);
    }
    riskKeys.add(key);
  }

  const highSeverityRows = (report.riskTable || []).filter(
    (row) => String(row.severity || "").toUpperCase() === "HIGH"
  ).length;

  const highRiskDocuments = report.executiveSummary?.kpis?.highRiskDocuments ?? 0;
  const highRiskReviews = report.executiveSummary?.kpis?.highRiskReviews ?? 0;
  const highRiskIndicators =
    report.executiveSummary?.kpis?.highRiskIndicators ??
    highRiskDocuments + highRiskReviews;

  if (highRiskIndicators !== highSeverityRows) {
    issues.push(
      `high risk KPI total (${highRiskIndicators}) does not match HIGH severity rows (${highSeverityRows})`
    );
  }

  const documentHighRows = (report.riskTable || []).filter(
    (row) =>
      String(row.severity || "").toUpperCase() === "HIGH" &&
      row.type !== "comparison_review"
  ).length;

  if (documentHighRows !== highRiskDocuments) {
    issues.push(
      `highRiskDocuments KPI (${highRiskDocuments}) does not match document HIGH rows (${documentHighRows})`
    );
  }

  const reviewHighRows = (report.riskTable || []).filter(
    (row) =>
      String(row.severity || "").toUpperCase() === "HIGH" &&
      row.type === "comparison_review"
  ).length;

  if (reviewHighRows !== highRiskReviews) {
    issues.push(
      `highRiskReviews KPI (${highRiskReviews}) does not match review HIGH rows (${reviewHighRows})`
    );
  }

  return issues;
}

module.exports = {
  validateWorkspaceReport,
};
