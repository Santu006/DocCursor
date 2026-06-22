const { diffLines } = require("diff");
const { matchSections, extractSections } = require("./sectionMatcher");
const { extractClauses, matchClauses } = require("./clauseMatcher");
const { resolveSectionConcept, getConceptLabel } = require("./sectionConcepts");
const {
  classifySeverity,
  classifyRiskCategory,
  buildFinancialImpact,
  buildBusinessSummary,
  buildExecutiveSummary,
  RISK_CATEGORIES,
} = require("./clauseAnalysis");
const { refineDiffResults } = require("./diffQuality");

const TOPIC_PATTERNS = {
  payment: /\b(payment|billing|fee|invoice|net\s+\d+|retainer|compensation|price|amount|\$\d)/i,
  confidentiality: /\b(confidential|non[- ]disclosure|nda|proprietary|trade secret)/i,
  termination: /\b(terminat\w*|cancel\w*|expir\w*|notice period|end of term)/i,
  liability: /\b(liabil\w*|indemnif\w*|warrant\w*|limitation of liability|damages)/i,
  compliance: /\b(compliance|regulat\w*|gdpr|hipaa|audit|governing law)/i,
  arbitration: /\b(arbitrat\w*|dispute resolution|mediation|jurisdiction)/i,
  nonCompete: /\b(non[- ]compete|restrictive covenant|non[- ]solicit)/i,
};

/**
 * Level 1: raw line diff — kept for optional advanced view only.
 *
 * @param {string} textA
 * @param {string} textB
 * @returns {{ added: string[], removed: string[], modified: object[], gitStyle: string }}
 */
function computeTextDiff(textA = "", textB = "") {
  const parts = diffLines(textA, textB);
  const added = [];
  const removed = [];
  const modified = [];
  let gitStyle = "";

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const value = part.value.replace(/\n$/, "");
    const lines = value.split("\n").filter((line) => line.length > 0);

    if (part.added) {
      added.push(...lines);
      gitStyle += lines.map((line) => `+ ${line}`).join("\n");
      if (gitStyle && !gitStyle.endsWith("\n")) gitStyle += "\n";
      continue;
    }

    if (part.removed) {
      const next = parts[i + 1];
      if (next?.added) {
        modified.push({ before: value.trim(), after: next.value.trim() });
        gitStyle += `- ${value.trim()}\n+ ${next.value.trim()}\n`;
        i++;
        continue;
      }
      removed.push(...lines);
      gitStyle += lines.map((line) => `- ${line}`).join("\n");
      if (gitStyle && !gitStyle.endsWith("\n")) gitStyle += "\n";
    }
  }

  return { added, removed, modified, gitStyle: gitStyle.trim() };
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function detectTopics(text = "") {
  const topics = [];
  for (const [topic, pattern] of Object.entries(TOPIC_PATTERNS)) {
    if (pattern.test(text)) topics.push(topic);
  }
  return topics;
}

/**
 * @param {object} params
 * @returns {object}
 */
function buildClauseChangeRecord({
  changeType,
  clause,
  otherClause = null,
  sectionTitle = "",
}) {
  const concept = clause.concept || resolveSectionConcept(sectionTitle, clause.text);
  const conceptId = concept?.id || null;
  const label = concept?.label || clause.label || sectionTitle || "Clause";

  const summary = buildBusinessSummary(changeType, clause, otherClause);
  const beforeText =
    changeType === "added"
      ? ""
      : otherClause?.text || clause.text || "";
  const afterText =
    changeType === "removed"
      ? ""
      : clause.text || otherClause?.text || "";

  const base = {
    changeType,
    label,
    title: label,
    section: sectionTitle || label,
    conceptId,
    summary,
    previous: beforeText,
    next: afterText,
    before: beforeText,
    after: afterText,
    severity: classifySeverity({
      changeType,
      conceptId,
      summary,
      previous: otherClause?.text || "",
      next: clause.text || "",
    }),
    riskCategory: classifyRiskCategory({ conceptId, summary, next: clause.text }),
    topics: detectTopics(`${label}\n${clause.text || ""}\n${otherClause?.text || ""}`),
  };

  const financialImpact = buildFinancialImpact(base);
  if (financialImpact) base.financialImpact = financialImpact;

  return base;
}

/**
 * Compare clauses within a matched section pair.
 *
 * @param {object} sectionA
 * @param {object} sectionB
 * @returns {object[]}
 */
function diffSectionClauses(sectionA, sectionB) {
  const clausesA = extractClauses(sectionA.body);
  const clausesB = extractClauses(sectionB.body);
  const { matched, onlyA, onlyB } = matchClauses(clausesA, clausesB);
  const changes = [];
  const sectionTitle =
    sectionA.concept?.label ||
    sectionB.concept?.label ||
    sectionA.title ||
    sectionB.title;

  for (const clause of onlyB) {
    changes.push(
      buildClauseChangeRecord({
        changeType: "added",
        clause,
        sectionTitle,
      })
    );
  }

  for (const clause of onlyA) {
    changes.push(
      buildClauseChangeRecord({
        changeType: "removed",
        clause,
        sectionTitle,
      })
    );
  }

  for (const pair of matched) {
    const normA = pair.clauseA.text.replace(/\s+/g, " ").trim();
    const normB = pair.clauseB.text.replace(/\s+/g, " ").trim();
    if (normA === normB) continue;

    changes.push(
      buildClauseChangeRecord({
        changeType: "modified",
        clause: pair.clauseB,
        otherClause: pair.clauseA,
        sectionTitle,
      })
    );
  }

  return changes;
}

/**
 * Phase 5.1 semantic clause diff engine.
 *
 * @param {string} contentA
 * @param {string} contentB
 * @returns {object}
 */
function computeSemanticDiff(contentA = "", contentB = "") {
  const sectionsA = extractSections(contentA);
  const sectionsB = extractSections(contentB);
  const { matched, onlyA, onlyB } = matchSections(sectionsA, sectionsB);

  const clauseChanges = [];

  for (const pair of matched) {
    clauseChanges.push(...diffSectionClauses(pair.sectionA, pair.sectionB));
  }

  for (const section of onlyB) {
    const concept = section.concept || resolveSectionConcept(section.title, section.body);
    clauseChanges.push(
      buildClauseChangeRecord({
        changeType: "added",
        clause: {
          text: section.body,
          label: concept?.label || section.title,
          concept,
        },
        sectionTitle: section.title,
      })
    );
  }

  for (const section of onlyA) {
    const concept = section.concept || resolveSectionConcept(section.title, section.body);
    clauseChanges.push(
      buildClauseChangeRecord({
        changeType: "removed",
        clause: {
          text: section.body,
          label: concept?.label || section.title,
          concept,
        },
        sectionTitle: section.title,
      })
    );
  }

  const {
    clauseChanges: refinedChanges,
    riskScore,
    buckets,
  } = refineDiffResults(clauseChanges);

  const refinedAdded = refinedChanges.filter((c) => c.changeType === "added");
  const refinedRemoved = refinedChanges.filter((c) => c.changeType === "removed");
  const refinedModified = refinedChanges.filter((c) => c.changeType === "modified");

  const executive = buildExecutiveSummary(refinedChanges, { riskScore });
  const textDiff = computeTextDiff(contentA, contentB);

  const financialChanges = buckets.financialChanges;
  const riskChanges = buckets.riskChanges;
  const complianceChanges = buckets.complianceChanges;
  const operationalChanges = buckets.operationalChanges;

  const semanticChanges = refinedChanges.map((c) => ({
    section: c.section,
    changeType: c.changeType,
    summary: c.summary,
    severity: c.severity,
    topics: c.topics,
    confidence: c.confidence,
  }));

  return {
    sectionsA: sectionsA.length,
    sectionsB: sectionsB.length,
    clauseChanges: refinedChanges,
    riskScore,
    sectionChanges: {
      added: refinedAdded.map((c) => ({
        title: c.title,
        summary: c.summary,
        severity: c.severity,
        riskCategory: c.riskCategory,
        topics: c.topics,
        confidence: c.confidence,
      })),
      removed: refinedRemoved.map((c) => ({
        title: c.title,
        summary: c.summary,
        severity: c.severity,
        riskCategory: c.riskCategory,
        topics: c.topics,
        confidence: c.confidence,
      })),
      modified: refinedModified.map((c) => ({
        title: c.title,
        summary: c.summary,
        severity: c.severity,
        riskCategory: c.riskCategory,
        topics: c.topics,
        before: c.before,
        after: c.after,
        confidence: c.confidence,
      })),
    },
    executiveSummary: executive,
    semanticChanges,
    textDiff,
    riskChanges,
    financialChanges,
    complianceChanges,
    operationalChanges,
  };
}

module.exports = {
  computeTextDiff,
  computeSemanticDiff,
  detectTopics,
  diffSectionClauses,
  TOPIC_PATTERNS,
};
