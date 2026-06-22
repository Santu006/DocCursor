/**
 * Extract logical sections from document text using heading heuristics.
 * Supports markdown, numbered sections, and ALL-CAPS headings.
 *
 * @param {string} content
 * @returns {{ title: string, body: string, startLine: number }[]}
 */
function extractSections(content = "") {
  const lines = String(content).split("\n");
  const sections = [];
  let current = null;

  const isHeading = (line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 160) return null;

    const markdown = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (markdown) return markdown[2].trim();

    if (/^(?:\d+\.|\d+\))\s+\S/.test(trimmed)) return trimmed;

    if (
      trimmed === trimmed.toUpperCase() &&
      /[A-Z]/.test(trimmed) &&
      trimmed.split(/\s+/).length <= 14
    ) {
      return trimmed;
    }

    const clause = trimmed.match(
      /^(?:ARTICLE|SECTION|CLAUSE|SCHEDULE|EXHIBIT)\s+[IVXLCDM\d.]+[:\s-]+(.+)$/i
    );
    if (clause) return trimmed;

    return null;
  };

  for (let i = 0; i < lines.length; i++) {
    const heading = isHeading(lines[i]);
    if (heading) {
      if (current) sections.push(current);
      current = { title: heading, body: "", startLine: i + 1 };
      continue;
    }

    if (!current) {
      current = { title: "Preamble", body: "", startLine: 1 };
    }
    current.body += `${lines[i]}\n`;
  }

  if (current) sections.push(current);

  return sections.map((section) => ({
    ...section,
    body: section.body.trim(),
    normalizedTitle: normalizeSectionTitle(section.title),
  }));
}

/**
 * @param {string} title
 * @returns {string}
 */
function normalizeSectionTitle(title = "") {
  return String(title)
    .toLowerCase()
    .replace(/^(?:article|section|clause|schedule|exhibit)\s+[ivxlcdm\d.]+\s*[-:]?\s*/i, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Simple token overlap score between two normalized titles.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function titleSimilarity(a = "", b = "") {
  const tokensA = new Set(a.split(" ").filter(Boolean));
  const tokensB = new Set(b.split(" ").filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap++;
  }

  return overlap / Math.max(tokensA.size, tokensB.size);
}

const { resolveSectionConcept } = require("./sectionConcepts");

/**
 * Match sections between two documents using concept alignment first, then title similarity.
 *
 * @param {object[]} sectionsA
 * @param {object[]} sectionsB
 * @param {number} [threshold=0.45]
 * @returns {{
 *   matched: { sectionA: object, sectionB: object, similarity: number, conceptId?: string }[],
 *   onlyA: object[],
 *   onlyB: object[]
 * }}
 */
function matchSections(sectionsA = [], sectionsB = [], threshold = 0.45) {
  const enrichedA = sectionsA.map((section) => ({
    ...section,
    concept: resolveSectionConcept(section.title, section.body),
  }));
  const enrichedB = sectionsB.map((section) => ({
    ...section,
    concept: resolveSectionConcept(section.title, section.body),
  }));

  const matched = [];
  const usedB = new Set();
  const onlyA = [];

  for (const sectionA of enrichedA) {
    let best = null;
    let bestScore = threshold;

    for (let i = 0; i < enrichedB.length; i++) {
      if (usedB.has(i)) continue;
      const sectionB = enrichedB[i];

      let score = 0;
      if (
        sectionA.concept?.id &&
        sectionB.concept?.id &&
        sectionA.concept.id === sectionB.concept.id
      ) {
        score = 0.95;
      } else {
        const exact =
          sectionA.normalizedTitle === sectionB.normalizedTitle ? 1 : 0;
        score = Math.max(
          exact,
          titleSimilarity(sectionA.normalizedTitle, sectionB.normalizedTitle)
        );
      }

      if (score > bestScore) {
        bestScore = score;
        best = { index: i, sectionB, similarity: score };
      }
    }

    if (best) {
      usedB.add(best.index);
      matched.push({
        sectionA,
        sectionB: best.sectionB,
        similarity: best.similarity,
        conceptId: sectionA.concept?.id || best.sectionB.concept?.id,
      });
    } else {
      onlyA.push(sectionA);
    }
  }

  const onlyB = enrichedB.filter((_, index) => !usedB.has(index));
  return { matched, onlyA, onlyB };
}

module.exports = {
  extractSections,
  normalizeSectionTitle,
  titleSimilarity,
  matchSections,
};
