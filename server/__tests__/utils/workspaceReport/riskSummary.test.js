/* eslint-env jest, node */

const {
  detectDocumentRisks,
  detectReviewRisks,
  summarizeRisks,
  textMentionsClause,
} = require("../../../utils/workspaceReport/riskSummary");

describe("riskSummary", () => {
  it("detects missing clauses in agreement metadata", () => {
    const risks = detectDocumentRisks([
      {
        docId: "agreement-1",
        filename: "Basic-Fee-Agreement.pdf",
        category: "agreement",
        status: "complete",
        summary: "Fee agreement covering billing and payment terms.",
        keyTopics: ["billing", "legal fees"],
        keywords: ["retainer", "payment"],
      },
    ]);

    expect(risks.some((r) => r.clause === "arbitration")).toBe(true);
    expect(risks[0].riskReason).toContain("not detected in metadata");
    expect(risks[0].document).toBe("Basic-Fee-Agreement.pdf");
  });

  it("does not flag clause gaps for non-agreement documents", () => {
    const risks = detectDocumentRisks([
      {
        docId: "game-1",
        filename: "sample4.csv",
        category: "spreadsheet",
        status: "complete",
        summary: "Game statistics and player performance data.",
        keyTopics: ["game statistics"],
        keywords: ["csv"],
      },
    ]);

    expect(risks.filter((r) => r.type === "missing_clause")).toHaveLength(0);
  });

  it("detects high financial obligations", () => {
    expect(
      textMentionsClause(
        "Retainer of $5,000 and payment shall be due upon signing.",
        "financial"
      )
    ).toBe(true);

    const risks = detectDocumentRisks([
      {
        docId: "fee-1",
        filename: "retainer.pdf",
        category: "agreement",
        status: "complete",
        summary: "Retainer of $5,000 required with payment terms of net 30.",
        keyTopics: ["retainer", "billing"],
        keywords: ["$5000"],
      },
    ]);

    expect(risks.some((r) => r.type === "financial_obligation")).toBe(true);
  });

  it("detects high-risk comparison reviews", () => {
    const risks = detectReviewRisks([
      {
        id: 1,
        riskScore: 82,
        riskLevel: "HIGH",
        documentA: "a",
        documentB: "b",
        documentALabel: "Contract v1",
        documentBLabel: "Contract v2",
      },
    ]);

    expect(risks).toHaveLength(1);
    expect(risks[0].riskReason).toContain("Comparison review risk score");
  });

  it("summarizes risk counts", () => {
    const summary = summarizeRisks(
      [
        { severity: "MEDIUM", clause: "arbitration", type: "missing_clause" },
        { severity: "HIGH", type: "financial_obligation" },
      ],
      [{ severity: "HIGH", type: "comparison_review" }]
    );

    expect(summary.total).toBe(3);
    expect(summary.high).toBe(2);
    expect(summary.missingArbitration).toBe(1);
    expect(summary.highRiskReviews).toBe(1);
  });

  it("deduplicates risks by documentId and riskReason", () => {
    const { dedupeRisks, riskDedupeKey } = require("../../../utils/workspaceReport/riskSummary");

    const risks = dedupeRisks([
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
      {
        reviewId: 9,
        riskReason: "Comparison review risk score 82/100",
        severity: "HIGH",
        type: "comparison_review",
      },
    ]);

    expect(risks).toHaveLength(2);
    expect(riskDedupeKey(risks[0])).not.toBe(riskDedupeKey(risks[1]));
  });
});
