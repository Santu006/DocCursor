const { normalizeSource } = require("./normalizeSource");
const { matchEvidenceForFinding } = require("./matchEvidence");

/**
 * @param {object[]} sources
 * @returns {{ byChunkId: Map, byDocument: Map, all: object[] }}
 */
function buildCitationMap(sources = []) {
  const all = sources.map(normalizeSource);
  const byChunkId = new Map();
  const byDocument = new Map();

  for (const citation of all) {
    if (citation.chunkId) byChunkId.set(citation.chunkId, citation);

    const key = citation.documentName;
    if (!byDocument.has(key)) byDocument.set(key, []);
    byDocument.get(key).push(citation);
  }

  return { byChunkId, byDocument, all };
}

/**
 * Attach deterministic evidence to findings using retrieved sources.
 *
 * @param {object[]} findings
 * @param {object[]} sources
 * @returns {object[]}
 */
function attachEvidence(findings = [], sources = []) {
  const { all } = buildCitationMap(sources);

  return findings.map((finding) => {
    if (Array.isArray(finding.evidence) && finding.evidence.length > 0) {
      return finding;
    }

    const matched = matchEvidenceForFinding(finding, all).map((citation) => ({
      documentName: citation.documentName,
      sectionTitle: citation.sectionTitle || finding.section || null,
      chunkId: citation.chunkId,
      similarityScore:
        citation.similarityScore ?? finding.confidence ?? null,
    }));

    return {
      ...finding,
      evidence: matched,
    };
  });
}

/**
 * @param {object} evidence
 * @returns {string}
 */
function formatCitation(evidence = {}) {
  const parts = [evidence.documentName].filter(Boolean);

  if (evidence.sectionTitle) {
    parts.push(`Section: ${evidence.sectionTitle}`);
  }

  if (evidence.pageNumber != null) {
    parts.push(`Page: ${evidence.pageNumber}`);
  }

  const score = evidence.similarityScore ?? evidence.confidence;
  if (typeof score === "number") {
    parts.push(`Confidence: ${Math.round(score * 100)}%`);
  }

  return parts.join(" · ");
}

/**
 * Build deterministic evidence for document diff clause items.
 *
 * @param {object} item
 * @param {{ titleA: string, titleB: string }} titles
 * @returns {object[]}
 */
function buildDiffClauseEvidence(item, { titleA, titleB }) {
  const sectionTitle =
    item.sectionTitle || item.section || item.title || item.label || "";
  const similarityScore = item.confidence ?? null;
  const base = {
    sectionTitle: sectionTitle || null,
    chunkId: null,
    similarityScore,
  };

  if (item.changeType === "added") {
    return [{ ...base, documentName: titleB }];
  }

  if (item.changeType === "removed") {
    return [{ ...base, documentName: titleA }];
  }

  if (item.changeType === "modified") {
    return [
      { ...base, documentName: titleA },
      { ...base, documentName: titleB },
    ];
  }

  return [];
}

module.exports = {
  buildCitationMap,
  attachEvidence,
  formatCitation,
  buildDiffClauseEvidence,
  normalizeSource,
  matchEvidenceForFinding,
};
