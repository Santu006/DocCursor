const { safeJsonParse } = require("../http");

/**
 * Normalize a document label for fuzzy matching (ignore spaces, hyphens, case, extensions).
 *
 * @param {string} value
 * @returns {string}
 */
function normalizeDocLabel(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/\.json$/i, "")
    .replace(
      /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ""
    )
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Collect searchable labels for a workspace document row.
 *
 * @param {object} doc
 * @returns {string[]}
 */
function getDocumentLabels(doc) {
  const metadata = safeJsonParse(doc?.metadata, {});
  const filename = String(doc?.filename || "");
  const basename = filename.split("/").pop();
  const title = String(metadata?.title || "");

  return [...new Set([filename, basename, title].filter(Boolean))];
}

/**
 * Score how well a reference matches a workspace document.
 *
 * @param {string} needle
 * @param {object} doc
 * @returns {number}
 */
function scoreDocumentMatch(needle, doc) {
  const normNeedle = normalizeDocLabel(needle);
  if (!normNeedle) return 0;

  let best = 0;
  for (const label of getDocumentLabels(doc)) {
    const normLabel = normalizeDocLabel(label);
    if (!normLabel) continue;
    if (normLabel === normNeedle) return 1;
    if (normLabel.includes(normNeedle) || normNeedle.includes(normLabel)) {
      best = Math.max(
        best,
        Math.min(normNeedle.length, normLabel.length) /
          Math.max(normNeedle.length, normLabel.length)
      );
    }
  }
  return best;
}

/**
 * Find the best matching workspace document for a user-provided reference.
 *
 * @param {string} needle
 * @param {object[]} documents
 * @param {number} [threshold=0.72]
 * @returns {object|null}
 */
function findBestDocumentMatch(needle, documents = [], threshold = 0.72) {
  let bestDoc = null;
  let bestScore = threshold;

  for (const doc of documents) {
    const score = scoreDocumentMatch(needle, doc);
    if (score > bestScore) {
      bestScore = score;
      bestDoc = doc;
    }
  }

  return bestDoc;
}

module.exports = {
  normalizeDocLabel,
  getDocumentLabels,
  scoreDocumentMatch,
  findBestDocumentMatch,
};
