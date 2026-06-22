/* eslint-env jest, node */

const { nameClause, nameModification, textSimilarity } = require("../../../utils/documentDiff/clauseNaming");
const {
  deduplicateChanges,
  pairAddRemoveAsModified,
  computeRiskScore,
  refineDiffResults,
} = require("../../../utils/documentDiff/diffQuality");
const { RISK_CATEGORIES, SEVERITY } = require("../../../utils/documentDiff/clauseAnalysis");

describe("clauseNaming", () => {
  it("names retainer additions with human-readable title", () => {
    const named = nameClause({
      changeType: "added",
      conceptId: "retainer",
      summary: "Retainer deposit requirement added",
    });
    expect(named.title).toBe("Retainer Deposit Requirement Added");
    expect(named.confidence).toBeGreaterThan(0.9);
  });

  it("names hourly billing snippets instead of raw text", () => {
    const named = nameClause({
      changeType: "added",
      before: "",
      after: "billed at the rate of [dollar amount] per hour",
    });
    expect(named.title).toBe("Hourly Billing Provision Added");
  });

  it("names scope modifications semantically", () => {
    const named = nameModification(
      {
        conceptId: "scope_of_services",
        before: "Limited scope representation",
        summary: "Limited scope representation restriction removed",
      },
      {
        conceptId: "scope_of_services",
        after: "General legal representation",
        summary: "Scope expanded",
      }
    );
    expect(named.title).toBe("Scope of Representation Expanded");
  });
});

describe("diffQuality", () => {
  it("deduplicates repeated findings", () => {
    const changes = deduplicateChanges([
      {
        changeType: "added",
        conceptId: "retainer",
        title: "Retainer Deposit Requirement Added",
        summary: "Retainer deposit requirement added",
        severity: SEVERITY.HIGH,
        confidence: 0.94,
      },
      {
        changeType: "added",
        conceptId: "retainer",
        title: "Retainer Deposit Requirement Added",
        summary: "Retainer deposit requirement added",
        severity: SEVERITY.HIGH,
        confidence: 0.88,
      },
    ]);

    expect(changes).toHaveLength(1);
    expect(changes[0].confidence).toBe(0.94);
  });

  it("pairs added+removed with same concept into modified", () => {
    const refined = pairAddRemoveAsModified([
      {
        changeType: "removed",
        conceptId: "scope_of_services",
        title: "Scope of Services",
        summary: "Limited scope representation restriction removed",
        before: "Limited scope representation only for specified tasks",
        severity: SEVERITY.MEDIUM,
        riskCategory: RISK_CATEGORIES.OPERATIONAL,
      },
      {
        changeType: "added",
        conceptId: "scope_of_services",
        title: "Scope of Services",
        summary: "General legal representation added",
        after: "Attorney shall provide general legal representation",
        severity: SEVERITY.MEDIUM,
        riskCategory: RISK_CATEGORIES.OPERATIONAL,
      },
    ]);

    expect(refined.filter((c) => c.changeType === "modified")).toHaveLength(1);
    expect(refined[0].title).toBe("Scope of Representation Expanded");
    expect(refined[0].before).toContain("Limited scope");
    expect(refined[0].after).toContain("general legal");
  });

  it("computes risk score from severity and category", () => {
    const score = computeRiskScore([
      {
        severity: SEVERITY.HIGH,
        riskCategory: RISK_CATEGORIES.LEGAL,
        confidence: 0.95,
      },
      {
        severity: SEVERITY.HIGH,
        riskCategory: RISK_CATEGORIES.FINANCIAL,
        confidence: 0.93,
      },
    ]);
    expect(score).toBeGreaterThan(40);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("refines noisy duplicate retainer and arbitration findings", () => {
    const { clauseChanges, riskScore } = refineDiffResults([
      {
        changeType: "added",
        conceptId: "retainer",
        label: "Retainer",
        summary: "Retainer deposit requirement added",
        severity: SEVERITY.HIGH,
        riskCategory: RISK_CATEGORIES.FINANCIAL,
      },
      {
        changeType: "added",
        conceptId: "retainer",
        label: "Retainer",
        summary: "Retainer deposit requirement added",
        severity: SEVERITY.HIGH,
        riskCategory: RISK_CATEGORIES.FINANCIAL,
      },
      {
        changeType: "removed",
        conceptId: "arbitration",
        label: "Arbitration",
        summary: "Arbitration clause removed",
        severity: SEVERITY.HIGH,
        riskCategory: RISK_CATEGORIES.LEGAL,
        before: "All disputes shall be resolved by binding arbitration",
      },
      {
        changeType: "removed",
        conceptId: "arbitration",
        label: "Arbitration",
        summary: "Arbitration clause removed",
        severity: SEVERITY.HIGH,
        riskCategory: RISK_CATEGORIES.LEGAL,
        before: "All disputes shall be resolved by binding arbitration",
      },
    ]);

    const addedRetainer = clauseChanges.filter(
      (c) => c.changeType === "added" && c.conceptId === "retainer"
    );
    const removedArbitration = clauseChanges.filter(
      (c) => c.changeType === "removed" && c.conceptId === "arbitration"
    );

    expect(addedRetainer).toHaveLength(1);
    expect(removedArbitration).toHaveLength(1);
    expect(addedRetainer[0].title).toBe("Retainer Deposit Requirement Added");
    expect(removedArbitration[0].title).toBe("Arbitration Clause Removed");
    expect(riskScore).toBeGreaterThan(0);
  });

  it("scores text similarity for modification pairing", () => {
    expect(
      textSimilarity(
        "Limited scope representation for specified legal tasks",
        "Limited scope of representation for defined matters"
      )
    ).toBeGreaterThan(0.4);
  });
});
