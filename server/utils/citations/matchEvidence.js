const { normalizeSource } = require("./normalizeSource");

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeKey(value = "") {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * @param {string} value
 * @returns {Set<string>}
 */
function tokenize(value = "") {
  return new Set(
    normalizeKey(value)
      .split(/\s+/)
      .filter((token) => token.length > 2)
  );
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function textOverlapScore(a = "", b = "") {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (!tokensA.size || !tokensB.size) return 0;

  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap += 1;
  }

  return overlap / Math.max(tokensA.size, tokensB.size);
}

/**
 * @param {string} sectionA
 * @param {string} sectionB
 * @returns {boolean}
 */
function sectionsMatch(sectionA = "", sectionB = "") {
  const left = normalizeKey(sectionA);
  const right = normalizeKey(sectionB);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

/**
 * Score a citation against a finding using deterministic rules.
 *
 * @param {object} finding
 * @param {object} citation
 * @returns {number}
 */
function scoreCitationMatch(finding, citation) {
  const findingSection =
    finding.section || finding.sectionTitle || finding.title || "";
  const findingText = [
    finding.summary,
    finding.title,
    finding.description,
    finding.before,
    finding.after,
  ]
    .filter(Boolean)
    .join(" ");

  if (sectionsMatch(findingSection, citation.sectionTitle || "")) {
    return 1;
  }

  const overlap = textOverlapScore(
    findingText,
    `${citation.sectionTitle || ""} ${citation.excerpt || ""}`
  );
  if (overlap > 0) return 0.5 + overlap * 0.49;

  return typeof citation.similarityScore === "number"
    ? citation.similarityScore * 0.25
    : 0;
}

/**
 * Pick the best citation for a finding.
 *
 * @param {object} finding
 * @param {object[]} citations
 * @returns {object[]}
 */
function matchEvidenceForFinding(finding, citations = []) {
  if (!citations.length) return [];

  const ranked = citations
    .map((citation) => ({
      citation,
      score: scoreCitationMatch(finding, citation),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) {
    const bestBySimilarity = [...citations]
      .filter((c) => typeof c.similarityScore === "number")
      .sort((a, b) => b.similarityScore - a.similarityScore)[0];
    return bestBySimilarity ? [bestBySimilarity] : [];
  }

  return [ranked[0].citation];
}

module.exports = {
  matchEvidenceForFinding,
  scoreCitationMatch,
  sectionsMatch,
  textOverlapScore,
};
