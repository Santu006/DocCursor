/* eslint-env jest, node */

const { resolveSectionConcept } = require("../../../utils/documentDiff/sectionConcepts");
const { extractClauses, isNoiseClause } = require("../../../utils/documentDiff/clauseMatcher");
const {
  classifySeverity,
  classifyRiskCategory,
  buildBusinessSummary,
  buildExecutiveSummary,
  RISK_CATEGORIES,
} = require("../../../utils/documentDiff/clauseAnalysis");

describe("sectionConcepts", () => {
  it("matches Deposit (Advance Fee) to retainer concept", () => {
    const concept = resolveSectionConcept("Deposit (Advance Fee)", "");
    expect(concept?.id).toBe("retainer");
  });

  it("matches Retainer section title", () => {
    const concept = resolveSectionConcept("RETAINER", "Client shall deposit funds in trust");
    expect(concept?.id).toBe("retainer");
  });

  it("matches payment terms semantically", () => {
    const concept = resolveSectionConcept("Fees and Billing", "hourly rate of $350");
    expect(concept?.id).toBe("payment_terms");
  });
});

describe("clauseMatcher", () => {
  it("filters template noise clauses", () => {
    expect(isNoiseClause("Sample language for Paragraph 2")).toBe(true);
    expect(isNoiseClause("Jones v Jones Case discovery material")).toBe(true);
    expect(
      isNoiseClause(
        "The client shall deposit a retainer of $10,000 in the attorney trust account."
      )
    ).toBe(false);
  });

  it("extracts meaningful clauses from section body", () => {
    const clauses = extractClauses(
      "The client shall pay hourly fees.\n\nAttorney may withdraw with 30 days notice.\n\nSample language for Paragraph 2"
    );
    expect(clauses.length).toBe(2);
    expect(clauses.some((c) => /withdraw/i.test(c.text))).toBe(true);
  });
});

describe("clauseAnalysis", () => {
  it("assigns HIGH severity to arbitration removal", () => {
    const severity = classifySeverity({
      changeType: "removed",
      conceptId: "arbitration",
      summary: "Arbitration clause removed",
    });
    expect(severity).toBe("HIGH");
  });

  it("classifies retainer changes as financial risk", () => {
    const category = classifyRiskCategory({
      conceptId: "retainer",
      summary: "Retainer deposit requirement added",
    });
    expect(category).toBe(RISK_CATEGORIES.FINANCIAL);
  });

  it("builds business-friendly summaries", () => {
    expect(
      buildBusinessSummary("added", {
        text: "deposit required",
        concept: { id: "retainer", label: "Retainer" },
      })
    ).toBe("Retainer deposit requirement added");
  });

  it("builds executive summary with change levels", () => {
    const executive = buildExecutiveSummary([
      {
        summary: "Arbitration clause removed",
        severity: "HIGH",
        riskCategory: RISK_CATEGORIES.LEGAL,
      },
      {
        summary: "Payment structure changed",
        severity: "MEDIUM",
        riskCategory: RISK_CATEGORIES.FINANCIAL,
      },
    ]);

    expect(executive.overallChangeLevel).toBe("HIGH");
    expect(executive.keyChanges.length).toBeGreaterThan(0);
    expect(executive.legalRiskLevel).toBe("HIGH");
  });
});
