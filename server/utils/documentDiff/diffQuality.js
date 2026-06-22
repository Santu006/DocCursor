const { RISK_CATEGORIES, SEVERITY } = require("./clauseAnalysis");
const { nameClause, nameModification, textSimilarity } = require("./clauseNaming");
const { normalizeSectionTitle, titleSimilarity } = require("./sectionMatcher");

const DEDUP_SIMILARITY_THRESHOLD = 0.82;
const PAIR_MODIFIED_THRESHOLD = 0.38;

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeKey(text = "") {
  return normalizeSectionTitle(String(text).replace(/\[[^\]]+\]/g, "placeholder"));
}

/**
 * @param {object} change
 * @returns {string}
 */
function semanticHash(change) {
  const title = normalizeKey(change.title || change.summary || change.label || "");
  const concept = change.conceptId || "general";
  return `${change.changeType}:${concept}:${title}`;
}

/**
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
function findingSimilarity(a, b) {
  if (a.changeType !== b.changeType) return 0;
  if (a.conceptId && b.conceptId && a.conceptId === b.conceptId) return 0.95;

  const titleA = normalizeKey(a.title || a.summary || "");
  const titleB = normalizeKey(b.title || b.summary || "");
  return titleSimilarity(titleA, titleB);
}

/**
 * Score confidence for a clause change record.
 *
 * @param {object} change
 * @param {object} [naming]
 * @returns {number}
 */
function scoreConfidence(change, naming = null) {
  let confidence = naming?.confidence ?? 0.7;

  if (change.conceptId) confidence += 0.08;
  if (change.severity === SEVERITY.HIGH) confidence += 0.04;
  if (change.changeType === "modified" && change.before && change.after) {
    confidence += 0.05;
  }
  if (/not specified/i.test(`${change.financialImpact?.previous || ""}`)) {
    confidence -= 0.06;
  }

  return Math.min(0.99, Math.max(0.45, Number(confidence.toFixed(2))));
}

/**
 * @param {object} removed
 * @param {object} added
 * @returns {number}
 */
function pairModificationScore(removed, added) {
  if (removed.conceptId && added.conceptId && removed.conceptId === added.conceptId) {
    return 0.88;
  }

  const textScore = textSimilarity(
    removed.before || removed.previous || removed.after || "",
    added.after || added.next || added.before || ""
  );

  const titleScore = titleSimilarity(
    normalizeKey(removed.title || removed.summary || ""),
    normalizeKey(added.title || added.summary || "")
  );

  return Math.max(textScore, titleScore * 0.85);
}

/**
 * Merge an added + removed pair into a single modified finding.
 *
 * @param {object} removed
 * @param {object} added
 * @param {number} pairScore
 * @returns {object}
 */
function buildModifiedFromPair(removed, added, pairScore) {
  const naming = nameModification(removed, added);
  const before = removed.before || removed.previous || removed.after || "";
  const after = added.after || added.next || added.before || "";
  const severity =
    removed.severity === SEVERITY.HIGH || added.severity === SEVERITY.HIGH
      ? SEVERITY.HIGH
      : removed.severity === SEVERITY.MEDIUM || added.severity === SEVERITY.MEDIUM
        ? SEVERITY.MEDIUM
        : SEVERITY.LOW;

  const modified = {
    changeType: "modified",
    label: naming.title,
    title: naming.title,
    summary: naming.title,
    description: naming.description,
    section: removed.section || added.section,
    conceptId: removed.conceptId || added.conceptId,
    previous: before,
    next: after,
    before,
    after,
    severity,
    riskCategory: removed.riskCategory || added.riskCategory,
    topics: [...new Set([...(removed.topics || []), ...(added.topics || [])])],
    financialImpact: removed.financialImpact || added.financialImpact || null,
    pairScore,
  };

  modified.confidence = scoreConfidence(modified, naming);
  return modified;
}

/**
 * Detect added+removed pairs that represent semantic evolution, not deletion + insertion.
 *
 * @param {object[]} changes
 * @returns {object[]}
 */
function pairAddRemoveAsModified(changes = []) {
  const added = changes.filter((c) => c.changeType === "added");
  const removed = changes.filter((c) => c.changeType === "removed");
  const modified = changes.filter((c) => c.changeType === "modified");
  const usedAdded = new Set();
  const usedRemoved = new Set();
  const paired = [];

  for (const rem of removed) {
    let best = null;
    let bestScore = PAIR_MODIFIED_THRESHOLD;

    for (const add of added) {
      if (usedAdded.has(add)) continue;
      const score = pairModificationScore(rem, add);
      if (score > bestScore) {
        bestScore = score;
        best = add;
      }
    }

    if (best) {
      usedAdded.add(best);
      usedRemoved.add(rem);
      paired.push(buildModifiedFromPair(rem, best, bestScore));
    }
  }

  return [
    ...modified,
    ...paired,
    ...added.filter((item) => !usedAdded.has(item)),
    ...removed.filter((item) => !usedRemoved.has(item)),
  ];
}

/**
 * Deduplicate findings by semantic hash and title similarity.
 *
 * @param {object[]} changes
 * @returns {object[]}
 */
function deduplicateChanges(changes = []) {
  const sorted = [...changes].sort(
    (a, b) => (b.confidence || 0) - (a.confidence || 0)
  );
  const kept = [];

  for (const change of sorted) {
    const duplicate = kept.find(
      (existing) =>
        semanticHash(existing) === semanticHash(change) ||
        findingSimilarity(existing, change) >= DEDUP_SIMILARITY_THRESHOLD
    );
    if (!duplicate) kept.push(change);
  }

  return kept;
}

/**
 * Apply human-readable naming and confidence to each change.
 *
 * @param {object[]} changes
 * @returns {object[]}
 */
function applyNamingAndConfidence(changes = []) {
  return changes.map((change) => {
    const naming = nameClause(change);
    const title = naming.title;
    const summary =
      change.changeType === "modified"
        ? title
        : `${title}`;

    const enriched = {
      ...change,
      label: title,
      title,
      summary,
      description: naming.description,
      confidence: scoreConfidence(change, naming),
    };

    if (enriched.financialImpact) {
      enriched.financialImpact = {
        ...enriched.financialImpact,
        label: title,
        summary: title,
      };
    }

    return enriched;
  });
}

/**
 * Drop low-value noise findings from final output.
 *
 * @param {object[]} changes
 * @returns {object[]}
 */
function filterNoiseFindings(changes = []) {
  return changes.filter((change) => {
    const title = normalizeKey(change.title || change.summary || "");
    if (!title || title.length < 8) return false;

    const isGenericFinancial =
      change.severity === SEVERITY.LOW &&
      change.riskCategory === RISK_CATEGORIES.FINANCIAL &&
      /not specified/i.test(
        `${change.financialImpact?.previous || ""} ${change.financialImpact?.next || ""}`
      ) &&
      (change.confidence || 0) < 0.7;

    if (isGenericFinancial) return false;

    const rawSnippet = normalizeKey(change.before || change.after || "");
    if (
      rawSnippet.length > 0 &&
      rawSnippet.length < 30 &&
      (change.confidence || 0) < 0.65 &&
      !change.conceptId
    ) {
      return false;
    }

    return true;
  });
}

/**
 * Compute overall risk score 0-100 from deduplicated findings.
 *
 * @param {object[]} changes
 * @returns {number}
 */
function computeRiskScore(changes = []) {
  if (!changes.length) return 0;

  const severityWeight = {
    [SEVERITY.HIGH]: 22,
    [SEVERITY.MEDIUM]: 11,
    [SEVERITY.LOW]: 4,
  };

  const categoryMultiplier = {
    [RISK_CATEGORIES.FINANCIAL]: 1.15,
    [RISK_CATEGORIES.LEGAL]: 1.25,
    [RISK_CATEGORIES.COMPLIANCE]: 1.1,
    [RISK_CATEGORIES.OPERATIONAL]: 0.85,
  };

  let score = 0;
  for (const change of changes) {
    const base = severityWeight[change.severity] || 4;
    const multiplier = categoryMultiplier[change.riskCategory] || 1;
    const confidence = change.confidence || 0.7;
    score += base * multiplier * confidence;
  }

  return Math.min(100, Math.round(score));
}

/**
 * Rebuild category buckets from refined changes.
 *
 * @param {object[]} changes
 * @returns {object}
 */
function rebuildCategoryBuckets(changes = []) {
  const financialChanges = changes
    .filter((c) => c.riskCategory === RISK_CATEGORIES.FINANCIAL || c.financialImpact)
    .map((c) =>
      c.financialImpact || {
        label: c.title,
        previous: c.before ? "Prior terms" : "Not specified",
        next: c.after ? "Updated terms" : c.summary,
        impact: c.severity,
        summary: c.summary,
        category: RISK_CATEGORIES.FINANCIAL,
        severity: c.severity,
        confidence: c.confidence,
      }
    );

  const riskChanges = changes
    .filter((c) => c.riskCategory === RISK_CATEGORIES.LEGAL)
    .map((c) => ({
      title: c.title,
      section: c.section,
      changeType: c.changeType,
      summary: c.summary,
      severity: c.severity,
      confidence: c.confidence,
      category: "legal_risk",
    }));

  const complianceChanges = changes
    .filter((c) => c.riskCategory === RISK_CATEGORIES.COMPLIANCE)
    .map((c) => ({
      title: c.title,
      section: c.section,
      changeType: c.changeType,
      summary: c.summary,
      severity: c.severity,
      confidence: c.confidence,
      category: "compliance",
    }));

  const operationalChanges = changes
    .filter((c) => c.riskCategory === RISK_CATEGORIES.OPERATIONAL)
    .map((c) => ({
      title: c.title,
      section: c.section,
      changeType: c.changeType,
      summary: c.summary,
      severity: c.severity,
      confidence: c.confidence,
      category: "operational",
    }));

  return {
    financialChanges: deduplicateChanges(financialChanges),
    riskChanges: deduplicateChanges(riskChanges),
    complianceChanges: deduplicateChanges(complianceChanges),
    operationalChanges: deduplicateChanges(operationalChanges),
  };
}

/**
 * Phase 5.2 post-processing pipeline.
 *
 * @param {object[]} clauseChanges
 * @returns {{ clauseChanges: object[], riskScore: number, buckets: object }}
 */
function refineDiffResults(clauseChanges = []) {
  let refined = pairAddRemoveAsModified(clauseChanges);
  refined = applyNamingAndConfidence(refined);
  refined = filterNoiseFindings(refined);
  refined = deduplicateChanges(refined);

  const riskScore = computeRiskScore(refined);
  const buckets = rebuildCategoryBuckets(refined);

  return { clauseChanges: refined, riskScore, buckets };
}

module.exports = {
  refineDiffResults,
  deduplicateChanges,
  pairAddRemoveAsModified,
  computeRiskScore,
  scoreConfidence,
  semanticHash,
};
