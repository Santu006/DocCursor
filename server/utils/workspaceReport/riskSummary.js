/**
 * Deterministic clause/topic detection from intelligence metadata text.
 * No LLM — scans summary, keywords, and keyTopics only.
 */

const CLAUSE_PATTERNS = {
  arbitration: /\b(arbitrat\w*|dispute\s+resolution|binding\s+mediation|mediation\s+clause)/i,
  confidentiality: /\b(confidential\w*|non[- ]disclosure|nda\b|proprietary\s+information|trade\s+secret)/i,
  termination: /\b(terminat\w*|cancel\w*|notice\s+period|end\s+of\s+term|expir\w*\s+of\s+agreement)/i,
  financial: /\b(\$\s?\d|payment\s+term|retainer|monetary|compensation|invoice|billing|fee[s]?\s+of|financial\s+obligation)/i,
};

const AGREEMENT_CATEGORIES = new Set([
  "agreement",
  "contract",
  "legal_document",
]);

const HIGH_FINANCIAL_PATTERN =
  /\b(\$\s?\d{3,}|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|retainer\s+of|fee[s]?\s+(?:of|shall\s+be|exceed)|payment\s+(?:of|shall)|financial\s+obligation)/i;

/**
 * @param {object} doc
 * @returns {string}
 */
function documentSearchText(doc = {}) {
  const topics = Array.isArray(doc.keyTopics)
    ? doc.keyTopics
    : Array.isArray(doc.topics)
      ? doc.topics
      : [];
  const keywords = Array.isArray(doc.keywords) ? doc.keywords : [];

  return [
    doc.summary,
    doc.documentType,
    ...topics,
    ...keywords,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * @param {string} text
 * @param {string} clauseType
 * @returns {boolean}
 */
function textMentionsClause(text = "", clauseType) {
  const pattern = CLAUSE_PATTERNS[clauseType];
  return pattern ? pattern.test(text) : false;
}

/**
 * @param {object} doc
 * @returns {boolean}
 */
function isAgreementLike(doc = {}) {
  const category = String(doc.category || "").toLowerCase();
  return AGREEMENT_CATEGORIES.has(category);
}

/**
 * Scan intelligence records for missing clauses and financial risk signals.
 *
 * @param {object[]} intelligence
 * @returns {object[]}
 */
function detectDocumentRisks(intelligence = []) {
  const risks = [];
  const complete = intelligence.filter((doc) => doc.status === "complete");

  for (const doc of complete) {
    if (!isAgreementLike(doc)) continue;

    const text = documentSearchText(doc);
    const base = {
      documentId: doc.docId,
      title: doc.filename,
      category: doc.category,
      documentType: doc.documentType,
    };

    if (!textMentionsClause(text, "arbitration")) {
      risks.push({
        id: `missing-arbitration-${doc.docId}`,
        type: "missing_clause",
        clause: "arbitration",
        severity: "MEDIUM",
        document: doc.filename,
        riskReason: "Arbitration clause not detected in metadata",
        title: doc.filename,
        ...base,
      });
    }

    if (!textMentionsClause(text, "confidentiality")) {
      risks.push({
        id: `missing-confidentiality-${doc.docId}`,
        type: "missing_clause",
        clause: "confidentiality",
        severity: "MEDIUM",
        document: doc.filename,
        riskReason: "Confidentiality clause not detected in metadata",
        title: doc.filename,
        ...base,
      });
    }

    if (!textMentionsClause(text, "termination")) {
      risks.push({
        id: `missing-termination-${doc.docId}`,
        type: "missing_clause",
        clause: "termination",
        severity: "MEDIUM",
        document: doc.filename,
        riskReason: "Termination clause not detected in metadata",
        title: doc.filename,
        ...base,
      });
    }

    if (textMentionsClause(text, "financial") && HIGH_FINANCIAL_PATTERN.test(text)) {
      risks.push({
        id: `high-financial-${doc.docId}`,
        type: "financial_obligation",
        severity: "HIGH",
        document: doc.filename,
        riskReason: "High financial obligation signals in metadata",
        title: doc.filename,
        ...base,
      });
    }
  }

  return risks;
}

/**
 * Surface high-risk saved comparison reviews.
 *
 * @param {object[]} reviews
 * @param {number} [threshold]
 * @returns {object[]}
 */
function detectReviewRisks(reviews = [], threshold = 70) {
  return reviews
    .filter(
      (review) =>
        review.riskLevel === "HIGH" ||
        (typeof review.riskScore === "number" && review.riskScore >= threshold)
    )
    .map((review) => ({
      id: `review-risk-${review.id}`,
      type: "comparison_review",
      severity: review.riskLevel || "HIGH",
      document: `${review.documentALabel || review.documentA} → ${review.documentBLabel || review.documentB}`,
      riskReason: `Comparison review risk score ${review.riskScore ?? "—"}/100`,
      title: `${review.documentALabel || review.documentA} → ${review.documentBLabel || review.documentB}`,
      reviewId: review.id,
      riskScore: review.riskScore,
      documentA: review.documentA,
      documentB: review.documentB,
      documentALabel: review.documentALabel,
      documentBLabel: review.documentBLabel,
    }));
}

/**
 * Stable deduplication key for a risk row.
 *
 * @param {object} risk
 * @returns {string}
 */
function riskDedupeKey(risk = {}) {
  const documentKey =
    risk.documentId ||
    (risk.reviewId != null ? `review:${risk.reviewId}` : null) ||
    risk.document ||
    risk.title ||
    "unknown";
  const reason = risk.riskReason || risk.type || "risk";
  return `${documentKey}::${reason}`;
}

/**
 * Remove duplicate risk rows by (documentId + riskReason).
 *
 * @param {object[]} risks
 * @returns {object[]}
 */
function dedupeRisks(risks = []) {
  const seen = new Set();
  const deduped = [];

  for (const risk of risks) {
    const key = riskDedupeKey(risk);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(risk);
  }

  return deduped;
}

/**
 * @param {object[]} documentRisks
 * @param {object[]} reviewRisks
 * @returns {object}
 */
function summarizeRisks(documentRisks = [], reviewRisks = []) {
  const all = dedupeRisks([...documentRisks, ...reviewRisks]);
  const bySeverity = { HIGH: 0, MEDIUM: 0, LOW: 0 };

  for (const risk of all) {
    const level = String(risk.severity || "LOW").toUpperCase();
    bySeverity[level] = (bySeverity[level] || 0) + 1;
  }

  return {
    total: all.length,
    high: bySeverity.HIGH || 0,
    medium: bySeverity.MEDIUM || 0,
    low: bySeverity.LOW || 0,
    missingArbitration: documentRisks.filter((r) => r.clause === "arbitration").length,
    missingConfidentiality: documentRisks.filter((r) => r.clause === "confidentiality").length,
    missingTermination: documentRisks.filter((r) => r.clause === "termination").length,
    financialObligations: documentRisks.filter((r) => r.type === "financial_obligation").length,
    highRiskReviews: reviewRisks.filter(
      (risk) => String(risk.severity || "").toUpperCase() === "HIGH"
    ).length,
  };
}

/**
 * @param {object[]} risks
 * @returns {object[]}
 */
function formatRiskTable(risks = []) {
  return dedupeRisks(risks).map((risk) => ({
    id: risk.id,
    document: risk.document || risk.title || "—",
    riskReason: risk.riskReason || risk.type || "Risk indicator",
    severity: String(risk.severity || "LOW").toUpperCase(),
    documentId: risk.documentId || null,
    reviewId: risk.reviewId || null,
    type: risk.type,
  }));
}

module.exports = {
  CLAUSE_PATTERNS,
  AGREEMENT_CATEGORIES,
  dedupeRisks,
  detectDocumentRisks,
  detectReviewRisks,
  documentSearchText,
  formatRiskTable,
  isAgreementLike,
  riskDedupeKey,
  summarizeRisks,
  textMentionsClause,
};
