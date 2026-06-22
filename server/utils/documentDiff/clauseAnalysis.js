const { resolveSectionConcept, getConceptLabel } = require("./sectionConcepts");

const SEVERITY = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
};

const RISK_CATEGORIES = {
  FINANCIAL: "Financial Risk",
  LEGAL: "Legal Risk",
  COMPLIANCE: "Compliance Risk",
  OPERATIONAL: "Operational Risk",
};

/**
 * @param {object} change
 * @returns {string}
 */
function classifySeverity(change = {}) {
  const { changeType, conceptId, summary = "", previous = "", next = "" } = change;
  const text = `${summary} ${previous} ${next}`.toLowerCase();

  const highPatterns = [
    /\barbitration\b.*\b(remov|deleted|eliminated)\b/,
    /\b(remov|deleted|eliminated)\b.*\barbitration\b/,
    /\bliability cap\b.*\b(increas|higher|removed)\b/,
    /\bindemnif/i,
    /\btermination\b.*\b(remov|weaken)\b/,
    /\bwithdraw\b.*\b(remov|restrict)\b/,
    /\bno retainer\b.*\$\d+/,
    /\bretainer\b.*\b(introduc|required|deposit)\b/,
    /\bconfidentiality\b.*\b(weaken|remov|narrow)\b/,
  ];

  const mediumPatterns = [
    /\bnet\s+\d+\b/,
    /\bpayment term\b/,
    /\bbilling frequency\b/,
    /\bmonthly statement\b/,
    /\bwithdraw\b.*\b(add|expand|right)\b/,
    /\bconfidentiality\b.*\b(expand|extend|add)\b/,
    /\btermination\b.*\b(chang|extend|notice)\b/,
    /\bhourly rate\b/,
    /\bflat fee\b/,
  ];

  if (changeType === "removed") {
    if (["arbitration", "liability", "termination"].includes(conceptId)) {
      return SEVERITY.HIGH;
    }
  }

  if (changeType === "added") {
    if (["arbitration", "liability", "retainer", "withdrawal"].includes(conceptId)) {
      return conceptId === "retainer" ? SEVERITY.HIGH : SEVERITY.MEDIUM;
    }
  }

  if (highPatterns.some((p) => p.test(text))) return SEVERITY.HIGH;
  if (mediumPatterns.some((p) => p.test(text))) return SEVERITY.MEDIUM;

  if (["payment_terms", "retainer", "liability", "arbitration", "termination"].includes(conceptId)) {
    return changeType === "modified" ? SEVERITY.MEDIUM : SEVERITY.LOW;
  }

  if (conceptId === "file_retention") return SEVERITY.LOW;

  return changeType === "modified" ? SEVERITY.MEDIUM : SEVERITY.LOW;
}

/**
 * @param {object} change
 * @returns {string}
 */
function classifyRiskCategory(change = {}) {
  const conceptId = change.conceptId || change.concept?.id;

  if (["payment_terms", "retainer"].includes(conceptId)) {
    return RISK_CATEGORIES.FINANCIAL;
  }
  if (["arbitration", "liability", "termination", "withdrawal", "confidentiality"].includes(conceptId)) {
    return RISK_CATEGORIES.LEGAL;
  }
  if (conceptId === "compliance") return RISK_CATEGORIES.COMPLIANCE;
  if (["client_responsibilities", "file_retention", "scope_of_services"].includes(conceptId)) {
    return RISK_CATEGORIES.OPERATIONAL;
  }

  const text = `${change.summary || ""} ${change.next || ""}`.toLowerCase();
  if (/\$\d+|retainer|billing|payment|fee|invoice/.test(text)) {
    return RISK_CATEGORIES.FINANCIAL;
  }
  if (/arbitration|liability|indemnif|termination|confidential|withdraw/.test(text)) {
    return RISK_CATEGORIES.LEGAL;
  }
  if (/compliance|regulat|audit|gdpr/.test(text)) {
    return RISK_CATEGORIES.COMPLIANCE;
  }

  return RISK_CATEGORIES.OPERATIONAL;
}

/**
 * @param {string} text
 * @returns {string|null}
 */
function extractMoneyValue(text = "") {
  const match = String(text).match(/\$\s?[\d,]+(?:\.\d{2})?/);
  return match ? match[0].replace(/\s/g, "") : null;
}

/**
 * @param {object} change
 * @returns {object|null}
 */
function buildFinancialImpact(change = {}) {
  if (classifyRiskCategory(change) !== RISK_CATEGORIES.FINANCIAL) return null;

  const previous = change.previous || change.before || "";
  const next = change.next || change.after || "";
  const prevAmount = extractMoneyValue(previous);
  const nextAmount = extractMoneyValue(next);

  let previousLabel = "Not specified";
  if (prevAmount) previousLabel = prevAmount;
  else if (/no retainer|not required|none/i.test(previous)) previousLabel = "No retainer";

  let nextLabel = "Not specified";
  if (nextAmount) nextLabel = nextAmount;
  else if (/no retainer|not required|none/i.test(next)) nextLabel = "No retainer";
  else if (change.changeType === "added" && change.conceptId === "retainer") {
    nextLabel = "Retainer required";
  }

  return {
    label: change.label || change.title || getConceptLabel(change.conceptId),
    previous: previousLabel,
    next: nextLabel,
    impact: classifySeverity(change),
    summary: change.summary,
    category: RISK_CATEGORIES.FINANCIAL,
  };
}

/**
 * @param {string} changeType
 * @param {object} clause
 * @param {object} [otherClause]
 * @returns {string}
 */
function buildBusinessSummary(changeType, clause, otherClause = null) {
  const concept = clause.concept || resolveSectionConcept(clause.label || "", clause.text || "");
  const label = concept?.label || clause.label || "Clause";

  switch (changeType) {
    case "added":
      if (concept?.id === "retainer") return "Retainer deposit requirement added";
      if (concept?.id === "withdrawal") return "Attorney withdrawal rights added";
      if (concept?.id === "payment_terms") return "Monthly billing statements added";
      if (concept?.id === "arbitration") return "Arbitration clause added";
      if (concept?.id === "liability") return "Liability provision added";
      return `${label} added`;
    case "removed":
      if (concept?.id === "scope_of_services") return "Limited scope representation restriction removed";
      if (concept?.id === "arbitration") return "Arbitration clause removed";
      if (concept?.id === "liability") return "Liability limitation removed";
      return `${label} removed`;
    case "modified":
      if (concept?.id === "payment_terms") return "Payment structure changed";
      if (concept?.id === "client_responsibilities") return "Client cooperation obligations expanded";
      if (concept?.id === "retainer") return "Retainer structure changed";
      if (concept?.id === "confidentiality") return "Confidentiality obligations changed";
      if (concept?.id === "termination") return "Termination terms changed";
      return `${label} modified`;
    default:
      return `${label} updated`;
  }
}

/**
 * Compute overall change level from clause changes.
 *
 * @param {object[]} changes
 * @returns {string}
 */
function computeOverallChangeLevel(changes = []) {
  if (changes.some((c) => c.severity === SEVERITY.HIGH)) return SEVERITY.HIGH;
  if (changes.filter((c) => c.severity === SEVERITY.MEDIUM).length >= 2) {
    return SEVERITY.HIGH;
  }
  if (changes.some((c) => c.severity === SEVERITY.MEDIUM)) return SEVERITY.MEDIUM;
  return SEVERITY.LOW;
}

/**
 * @param {object[]} changes
 * @returns {object}
 */
function buildExecutiveSummary(changes = [], { riskScore = null } = {}) {
  const overallChangeLevel = computeOverallChangeLevel(changes);
  const keyChanges = dedupeKeyChanges(
    changes.filter((c) => c.severity !== SEVERITY.LOW)
  ).slice(0, 6);

  const financial = changes.filter(
    (c) => c.riskCategory === RISK_CATEGORIES.FINANCIAL
  );
  const legal = changes.filter((c) => c.riskCategory === RISK_CATEGORIES.LEGAL);

  const financialImpactLevel = computeOverallChangeLevel(financial);
  const legalRiskLevel = computeOverallChangeLevel(legal);

  const topSummaries = keyChanges.map((c) => c.summary || c.title).slice(0, 3);
  const summaryText = [
    riskScore != null ? `Risk Score: ${riskScore}/100.` : null,
    `Overall change level: ${overallChangeLevel}.`,
    topSummaries.length
      ? `Key changes: ${topSummaries.join("; ")}.`
      : "No major clause-level changes detected.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    overallChangeLevel,
    keyChanges: keyChanges.map((c) => c.summary || c.title),
    financialImpactLevel,
    legalRiskLevel,
    riskScore,
    summaryText,
  };
}

/**
 * @param {object[]} changes
 * @returns {object[]}
 */
function dedupeKeyChanges(changes = []) {
  const seen = new Set();
  const result = [];

  for (const change of changes) {
    const key = String(change.summary || change.title || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(change);
  }

  return result;
}

module.exports = {
  SEVERITY,
  RISK_CATEGORIES,
  classifySeverity,
  classifyRiskCategory,
  buildFinancialImpact,
  buildBusinessSummary,
  buildExecutiveSummary,
  extractMoneyValue,
};
