const { resolveSectionConcept } = require("./sectionConcepts");
const { normalizeSectionTitle, titleSimilarity } = require("./sectionMatcher");

/** Boilerplate / template noise — not useful in business diff output. */
const CLAUSE_NOISE_PATTERNS = [
  /^sample language for\b/i,
  /\bv\.?\s+\w+/i,
  /\bdiscovery requests?\b/i,
  /\bcourt appearance\b/i,
  /^\[.+\]$/,
  /^_{3,}$/,
  /^x+$/i,
  /^lorem ipsum\b/i,
  /^see (?:attached|exhibit|appendix)\b/i,
  /^placeholder\b/i,
  /^example only\b/i,
  /^insert .+ here\b/i,
];

/**
 * @param {string} text
 * @returns {boolean}
 */
function isNoiseClause(text = "") {
  const trimmed = String(text).trim();
  if (!trimmed || trimmed.length < 24) return true;
  if (trimmed.split(/\s+/).length < 4) return true;
  return CLAUSE_NOISE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Extract clause units from section body text.
 *
 * @param {string} body
 * @returns {{ id: string, text: string, label: string, concept: object|null }[]}
 */
function extractClauses(body = "") {
  const chunks = String(body)
    .split(/\n(?=(?:\d+\.|\d+\)|[a-z]\)|[•\-*]\s|\([a-z]\)\s))/i)
    .flatMap((block) => block.split(/\n{2,}/))
    .map((chunk) => chunk.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((chunk) => !isNoiseClause(chunk));

  return chunks.map((text, index) => {
    const concept = resolveSectionConcept("", text);
    return {
      id: `clause-${index}`,
      text,
      label: buildClauseLabel(text, concept),
      concept,
    };
  });
}

/**
 * @param {string} text
 * @param {object|null} concept
 * @returns {string}
 */
function buildClauseLabel(text, concept) {
  if (concept?.label) return concept.label;

  const firstSentence = text.split(/[.!?]/)[0]?.trim() || text;
  const words = firstSentence.split(/\s+/).slice(0, 8).join(" ");
  return words.length > 60 ? `${words.slice(0, 57)}…` : words;
}

/**
 * Score similarity between two clause texts.
 *
 * @param {object} clauseA
 * @param {object} clauseB
 * @returns {number}
 */
function clauseSimilarity(clauseA, clauseB) {
  if (clauseA.concept?.id && clauseB.concept?.id) {
    if (clauseA.concept.id === clauseB.concept.id) return 0.95;
  }

  const normA = normalizeSectionTitle(clauseA.text);
  const normB = normalizeSectionTitle(clauseB.text);
  return titleSimilarity(normA, normB);
}

/**
 * Match clauses within aligned sections.
 *
 * @param {object[]} clausesA
 * @param {object[]} clausesB
 * @param {number} [threshold=0.35]
 * @returns {{
 *   matched: { clauseA: object, clauseB: object, similarity: number }[],
 *   onlyA: object[],
 *   onlyB: object[]
 * }}
 */
function matchClauses(clausesA = [], clausesB = [], threshold = 0.35) {
  const matched = [];
  const usedB = new Set();
  const onlyA = [];

  for (const clauseA of clausesA) {
    let best = null;
    let bestScore = threshold;

    for (let i = 0; i < clausesB.length; i++) {
      if (usedB.has(i)) continue;
      const score = clauseSimilarity(clauseA, clausesB[i]);
      if (score > bestScore) {
        bestScore = score;
        best = { index: i, clauseB: clausesB[i], similarity: score };
      }
    }

    if (best) {
      usedB.add(best.index);
      matched.push({
        clauseA,
        clauseB: best.clauseB,
        similarity: best.similarity,
      });
    } else {
      onlyA.push(clauseA);
    }
  }

  const onlyB = clausesB.filter((_, index) => !usedB.has(index));
  return { matched, onlyA, onlyB };
}

module.exports = {
  extractClauses,
  matchClauses,
  isNoiseClause,
  buildClauseLabel,
  CLAUSE_NOISE_PATTERNS,
};
