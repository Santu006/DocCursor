/* eslint-env jest, node */

const {
  buildExecutiveSummary,
  countHighRiskReviews,
  countHighSeverityIndicators,
} = require("../../../utils/workspaceReport/executiveSummary");
const { validateWorkspaceReport } = require("../../../utils/workspaceReport/validateReport");

describe("executiveSummary KPI consistency", () => {
  it("counts high risk reviews separately from high risk documents", () => {
    const risks = [
      {
        documentId: "legal-1",
        severity: "HIGH",
        type: "financial_obligation",
        riskReason: "High financial obligation signals in metadata",
      },
      {
        reviewId: 1,
        severity: "HIGH",
        type: "comparison_review",
        riskReason: "Comparison review risk score 82/100",
      },
    ];

    const summary = buildExecutiveSummary({
      overview: { documents: 2 },
      graph: { meta: { documentCount: 2, clusterCount: 1, duplicateCount: 0 } },
      riskSummary: { total: 2 },
      risks,
      reviewsDashboard: {},
      intelligenceStatus: { complete: 2 },
    });

    expect(summary.kpis.highRiskDocuments).toBe(1);
    expect(summary.kpis.highRiskReviews).toBe(1);
    expect(summary.kpis.highRiskIndicators).toBe(2);
    expect(summary.summary).toContain("One document is classified as high risk");
    expect(summary.summary).toContain("One comparison review is classified as high risk");
    expect(countHighRiskReviews(risks)).toBe(1);
    expect(countHighSeverityIndicators(risks)).toBe(2);
  });
});

describe("validateWorkspaceReport", () => {
  it("passes when distributions, clusters, risks, and KPIs are consistent", () => {
    const report = {
      meta: { documentCount: 3 },
      categoryDistribution: [
        { label: "Legal Agreements", count: 2 },
        { label: "Spreadsheet", count: 1 },
      ],
      fileTypeDistribution: [
        { label: "PDF", count: 2 },
        { label: "CSV", count: 1 },
      ],
      distributions: {
        category: { items: [], totalDocuments: 3, sumCounts: 3 },
        fileType: { items: [], totalDocuments: 3, sumCounts: 3 },
      },
      clusters: [{ label: "Legal Agreements", documentCount: 2 }, { label: "Game Statistics", documentCount: 1 }],
      riskTable: [
        {
          documentId: "legal-1",
          riskReason: "High financial obligation signals in metadata",
          severity: "HIGH",
          type: "financial_obligation",
        },
        {
          reviewId: 1,
          riskReason: "Comparison review risk score 82/100",
          severity: "HIGH",
          type: "comparison_review",
        },
      ],
      executiveSummary: {
        kpis: {
          highRiskDocuments: 1,
          highRiskReviews: 1,
          highRiskIndicators: 2,
        },
      },
    };

    expect(validateWorkspaceReport(report)).toEqual([]);
  });

  it("flags duplicate risk rows and KPI mismatches", () => {
    const report = {
      meta: { documentCount: 1 },
      categoryDistribution: [{ count: 1 }],
      fileTypeDistribution: [{ count: 1 }],
      distributions: {
        category: { sumCounts: 1 },
        fileType: { sumCounts: 1 },
      },
      clusters: [{ documentCount: 1 }],
      riskTable: [
        {
          documentId: "legal-1",
          riskReason: "Arbitration clause not detected in metadata",
          severity: "MEDIUM",
        },
        {
          documentId: "legal-1",
          riskReason: "Arbitration clause not detected in metadata",
          severity: "MEDIUM",
        },
      ],
      executiveSummary: {
        kpis: {
          highRiskDocuments: 0,
          highRiskReviews: 0,
          highRiskIndicators: 0,
        },
      },
    };

    const issues = validateWorkspaceReport(report);
    expect(issues.some((issue) => issue.includes("duplicate risk row"))).toBe(true);
  });
});
