/**
 * Prioritize documents for review order using deterministic risk scores.
 * No legal advice language.
 */

const SEVERITY_SCORES = {
  HIGH: 80,
  MEDIUM: 40,
  LOW: 20,
};

/**
 * @param {object[]} risks
 * @param {object[]} intelligence
 * @param {object[]} duplicates
 * @returns {object[]}
 */
function buildReviewOrder({ risks = [], intelligence = [], duplicates = [] } = {}) {
  const scores = new Map();

  const ensure = (documentId, document) => {
    if (!documentId) return null;
    if (!scores.has(documentId)) {
      scores.set(documentId, {
        documentId,
        document: document || documentId,
        riskScore: 0,
        drivers: [],
      });
    }
    return scores.get(documentId);
  };

  const addScore = (documentId, document, points, driver) => {
    const entry = ensure(documentId, document);
    if (!entry || points <= 0) return;
    entry.riskScore += points;
    if (driver && !entry.drivers.includes(driver)) {
      entry.drivers.push(driver);
    }
  };

  for (const risk of risks) {
    const points =
      risk.type === "comparison_review"
        ? Number(risk.riskScore || SEVERITY_SCORES.HIGH)
        : SEVERITY_SCORES[String(risk.severity || "MEDIUM").toUpperCase()] || 20;

    if (risk.type === "comparison_review") {
      addScore(
        risk.documentA,
        risk.documentALabel || risk.documentA,
        Math.round(points / 2),
        risk.riskReason || "High-risk comparison review"
      );
      addScore(
        risk.documentB,
        risk.documentBLabel || risk.documentB,
        Math.round(points / 2),
        risk.riskReason || "High-risk comparison review"
      );
      continue;
    }

    addScore(
      risk.documentId,
      risk.document || risk.title,
      points,
      risk.riskReason || risk.title
    );
  }

  for (const pair of duplicates) {
    const driver = `Near-duplicate (${Math.round((pair.similarityScore || 0.95) * 100)}% similarity)`;
    addScore(pair.source, pair.titles?.[0] || pair.source, 60, driver);
    addScore(pair.target, pair.titles?.[1] || pair.target, 60, driver);
  }

  for (const doc of intelligence) {
    if (
      doc.status === "complete" &&
      typeof doc.confidenceScore === "number" &&
      doc.confidenceScore < 0.6
    ) {
      addScore(
        doc.docId,
        doc.filename,
        15,
        `Low classification confidence (${Math.round(doc.confidenceScore * 100)}%)`
      );
    }
  }

  return [...scores.values()]
    .filter((entry) => entry.riskScore > 0)
    .sort(
      (a, b) =>
        b.riskScore - a.riskScore ||
        String(a.document).localeCompare(String(b.document))
    )
    .slice(0, 20)
    .map((entry, index) => ({
      rank: index + 1,
      document: entry.document,
      documentId: entry.documentId,
      riskScore: entry.riskScore,
      drivers: entry.drivers,
    }));
}

/** @deprecated Use buildReviewOrder */
function buildRecommendations(params) {
  return buildReviewOrder(params);
}

module.exports = {
  SEVERITY_SCORES,
  buildReviewOrder,
  buildRecommendations,
};
