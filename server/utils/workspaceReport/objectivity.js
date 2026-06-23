/**
 * Objectivity guards — executive reports must not contain legal advice language.
 */

const ADVISORY_PATTERNS = [
  /\bideal\b/i,
  /\badvantageous\b/i,
  /\bclients?\s+should\b/i,
  /\byou\s+should\s+choose\b/i,
  /\bshould\s+choose\b/i,
  /\brecommend(?:ed|ing)?\s+choos/i,
  /\bmost\s+advantageous\b/i,
  /\bthis\s+agreement\s+is\b/i,
  /\blegal\s+advice\b/i,
  /\bwe\s+recommend\b/i,
  /\bconsider\s+consolidating\b/i,
  /\bmay\s+need\s+verification\b/i,
  /\bmay\s+be\s+an\s+outlier\b/i,
];

/**
 * @param {string} text
 * @returns {boolean}
 */
function containsAdvisoryLanguage(text = "") {
  const value = String(text);
  return ADVISORY_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * @param {string|string[]} texts
 * @returns {string[]}
 */
function findAdvisoryPhrases(texts = []) {
  const list = Array.isArray(texts) ? texts : [texts];
  const haystack = list.filter(Boolean).join("\n");
  return ADVISORY_PATTERNS.filter((pattern) => pattern.test(haystack)).map(
    (pattern) => pattern.source
  );
}

module.exports = {
  ADVISORY_PATTERNS,
  containsAdvisoryLanguage,
  findAdvisoryPhrases,
};
