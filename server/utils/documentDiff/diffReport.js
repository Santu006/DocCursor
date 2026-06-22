/**
 * Build a human-readable comparison report from clause-level diff + optional LLM analysis.
 *
 * @param {object} params
 * @param {string} params.titleA
 * @param {string} params.titleB
 * @param {object} params.diffResult
 * @param {object|null} [params.llmAnalysis]
 * @returns {object}
 */
function buildDiffReport({
  titleA,
  titleB,
  diffResult,
  llmAnalysis = null,
}) {
  const {
    sectionChanges,
    clauseChanges = [],
    textDiff,
    semanticChanges,
    riskChanges,
    financialChanges,
    complianceChanges,
    operationalChanges = [],
    executiveSummary: computedExecutive,
    riskScore = null,
  } = diffResult;

  const added = clauseChanges
    .filter((c) => c.changeType === "added")
    .map(formatClauseItem);

  const removed = clauseChanges
    .filter((c) => c.changeType === "removed")
    .map(formatClauseItem);

  const modified = clauseChanges
    .filter((c) => c.changeType === "modified")
    .map(formatClauseItem);

  const executive = mergeExecutiveSummary(computedExecutive, llmAnalysis, {
    added,
    removed,
    modified,
    titleA,
    titleB,
  });

  const report = formatMarkdownReport({
    titleA,
    titleB,
    executive,
    added,
    removed,
    modified,
    financialChanges: llmAnalysis?.financialChanges?.length
      ? llmAnalysis.financialChanges
      : financialChanges,
    riskChanges: llmAnalysis?.riskChanges?.length
      ? llmAnalysis.riskChanges
      : riskChanges,
    complianceChanges: llmAnalysis?.complianceChanges?.length
      ? llmAnalysis.complianceChanges
      : complianceChanges,
    operationalChanges,
    llmAnalysis,
  });

  return {
    summary: executive.summaryText,
    executiveSummary: executive.summaryText,
    overallChangeLevel: executive.overallChangeLevel,
    riskScore: llmAnalysis?.riskScore ?? riskScore ?? computedExecutive?.riskScore ?? null,
    keyChanges: executive.keyChanges,
    financialImpactLevel: executive.financialImpactLevel,
    legalRiskLevel: executive.legalRiskLevel,
    added,
    removed,
    modified,
    clauseChanges: clauseChanges.map(formatClauseItem),
    riskChanges: llmAnalysis?.riskChanges?.length
      ? llmAnalysis.riskChanges
      : riskChanges,
    financialChanges: llmAnalysis?.financialChanges?.length
      ? llmAnalysis.financialChanges
      : financialChanges,
    complianceChanges: llmAnalysis?.complianceChanges?.length
      ? llmAnalysis.complianceChanges
      : complianceChanges,
    operationalChanges,
    semanticChanges: llmAnalysis?.semanticChanges?.length
      ? llmAnalysis.semanticChanges
      : semanticChanges,
    addedClauses: added.map((item) => item.summary || item.title),
    removedClauses: removed.map((item) => item.summary || item.title),
    modifiedClauses: modified.map((item) => item.summary || item.title),
    newObligations: llmAnalysis?.newObligations || [],
    removedProtections: llmAnalysis?.removedProtections || [],
    paymentTermChanges: llmAnalysis?.paymentTermChanges || [],
    confidentialityChanges: llmAnalysis?.confidentialityChanges || [],
    terminationChanges: llmAnalysis?.terminationChanges || [],
    legalImpact: llmAnalysis?.legalImpact || "",
    businessImpact: llmAnalysis?.businessImpact || "",
    rawGitStyleDiff: textDiff.gitStyle,
    gitStyleDiff: textDiff.gitStyle,
    textDiff: {
      added: textDiff.added,
      removed: textDiff.removed,
      modified: textDiff.modified,
    },
    report,
  };
}

/**
 * @param {object} item
 * @returns {object}
 */
function formatClauseItem(item) {
  return {
    title: item.title || item.label || item.section,
    summary: item.summary || item.title || item.label,
    description: item.description || item.summary || "",
    severity: item.severity || "LOW",
    confidence: item.confidence ?? null,
    riskCategory: item.riskCategory || "",
    changeType: item.changeType || "",
    section: item.section || "",
    financialImpact: item.financialImpact || null,
    topics: item.topics || [],
    before: item.before,
    after: item.after,
  };
}

/**
 * @param {object|null} computed
 * @param {object|null} llmAnalysis
 * @param {object} context
 * @returns {object}
 */
function mergeExecutiveSummary(computed, llmAnalysis, context) {
  const fallback = buildFallbackSummary(context);
  return {
    overallChangeLevel:
      llmAnalysis?.overallChangeLevel || computed?.overallChangeLevel || "LOW",
    riskScore: llmAnalysis?.riskScore ?? computed?.riskScore ?? null,
    keyChanges:
      llmAnalysis?.keyChanges?.length
        ? llmAnalysis.keyChanges
        : computed?.keyChanges?.length
          ? computed.keyChanges
          : [...context.added, ...context.removed, ...context.modified]
              .slice(0, 5)
              .map((c) => c.summary),
    financialImpactLevel:
      llmAnalysis?.financialImpactLevel || computed?.financialImpactLevel || "LOW",
    legalRiskLevel:
      llmAnalysis?.legalRiskLevel || computed?.legalRiskLevel || "LOW",
    summaryText:
      llmAnalysis?.executiveSummary ||
      computed?.summaryText ||
      fallback,
  };
}

/**
 * @param {object} params
 * @returns {string}
 */
function buildFallbackSummary({ titleA, titleB, added, removed, modified }) {
  const parts = [
    `Comparison of "${titleA}" vs "${titleB}":`,
    `${added.length} clause(s) added`,
    `${removed.length} clause(s) removed`,
    `${modified.length} clause(s) modified`,
  ];
  return parts.join(" · ");
}

/**
 * @param {object} params
 * @returns {string}
 */
function formatMarkdownReport({
  titleA,
  titleB,
  executive,
  added,
  removed,
  modified,
  financialChanges,
  riskChanges,
  complianceChanges,
  operationalChanges,
  llmAnalysis,
}) {
  const lines = [
    `# Document Comparison Report`,
    ``,
    `**Document A:** ${titleA}`,
    `**Document B:** ${titleB}`,
    ``,
    `## 1. Executive Summary`,
    executive.summaryText,
    ``,
  ];

  if (executive.riskScore != null) {
    lines.push(`**Risk Score:** ${executive.riskScore}/100`, ``);
  }

  lines.push(
    `**Overall Change Level:** ${executive.overallChangeLevel}`,
    `**Financial Impact:** ${executive.financialImpactLevel}`,
    `**Legal Risk:** ${executive.legalRiskLevel}`,
    ``
  );

  if (executive.keyChanges?.length) {
    lines.push(`**Key Changes:**`);
    executive.keyChanges.forEach((item) => lines.push(`- ${item}`));
    lines.push(``);
  }

  if (llmAnalysis?.businessImpact) {
    lines.push(`**Business impact:** ${llmAnalysis.businessImpact}`, ``);
  }
  if (llmAnalysis?.legalImpact) {
    lines.push(`**Legal impact:** ${llmAnalysis.legalImpact}`, ``);
  }

  lines.push(`## 2. Added Clauses`);
  if (added.length === 0) lines.push(`_None detected._`);
  else added.forEach((item) => lines.push(formatClauseLine(item, "+")));

  lines.push(``, `## 3. Removed Clauses`);
  if (removed.length === 0) lines.push(`_None detected._`);
  else removed.forEach((item) => lines.push(formatClauseLine(item, "-")));

  lines.push(``, `## 4. Modified Clauses`);
  if (modified.length === 0) lines.push(`_None detected._`);
  else modified.forEach((item) => lines.push(formatClauseLine(item, "~")));

  lines.push(``, `## 5. Financial Impact`);
  const financial = financialChanges || [];
  if (financial.length === 0) lines.push(`_No payment or billing changes detected._`);
  else {
    for (const item of financial) {
      if (item.previous && item.next) {
        lines.push(
          `- **${item.label || item.section}** — Previous: ${item.previous} → New: ${item.next} · Impact: ${item.impact || item.severity || "MEDIUM"}`
        );
      } else {
        lines.push(`- ${item.summary || item.section}`);
      }
    }
  }

  lines.push(``, `## 6. Legal Risk Analysis`);
  const risks = riskChanges || [];
  if (risks.length === 0) lines.push(`_No significant legal risk changes detected._`);
  else {
    for (const item of risks) {
      lines.push(
        `- [${item.severity || "MEDIUM"}] ${item.summary || item.section}`
      );
    }
  }

  if (complianceChanges?.length) {
    lines.push(``, `## Compliance Changes`);
    complianceChanges.forEach((item) =>
      lines.push(`- [${item.severity || "MEDIUM"}] ${item.summary || item.section}`)
    );
  }

  if (operationalChanges?.length) {
    lines.push(``, `## 7. Operational Impact`);
    operationalChanges.forEach((item) =>
      lines.push(`- [${item.severity || "LOW"}] ${item.summary || item.title || item.section}`)
    );
  }

  return lines.join("\n");
}

/**
 * @param {object} item
 * @param {string} prefix
 * @returns {string}
 */
function formatClauseLine(item, prefix) {
  const severity = item.severity ? ` [${item.severity}]` : "";
  const confidence =
    item.confidence != null
      ? ` · Confidence: ${Math.round(item.confidence * 100)}%`
      : "";
  return `- ${prefix} ${item.summary || item.title}${severity}${confidence}`;
}

/**
 * @param {object} payload
 * @returns {object}
 */
function normalizeLLMAnalysis(payload = {}) {
  const asArray = (value) =>
    Array.isArray(value) ? value.filter(Boolean).map(String) : [];

  return {
    executiveSummary:
      typeof payload.executiveSummary === "string"
        ? payload.executiveSummary.trim()
        : typeof payload.summary === "string"
          ? payload.summary.trim()
          : "",
    overallChangeLevel: payload.overallChangeLevel || null,
    keyChanges: asArray(payload.keyChanges),
    financialImpactLevel: payload.financialImpactLevel || null,
    legalRiskLevel: payload.legalRiskLevel || null,
    addedClauses: asArray(payload.addedClauses),
    removedClauses: asArray(payload.removedClauses),
    modifiedClauses: asArray(payload.modifiedClauses),
    newObligations: asArray(payload.newObligations),
    removedProtections: asArray(payload.removedProtections),
    paymentTermChanges: asArray(payload.paymentTermChanges),
    confidentialityChanges: asArray(payload.confidentialityChanges),
    terminationChanges: asArray(payload.terminationChanges),
    legalImpact:
      typeof payload.legalImpact === "string" ? payload.legalImpact.trim() : "",
    businessImpact:
      typeof payload.businessImpact === "string"
        ? payload.businessImpact.trim()
        : "",
    whyItMatters:
      typeof payload.whyItMatters === "string" ? payload.whyItMatters.trim() : "",
    semanticChanges: Array.isArray(payload.semanticChanges)
      ? payload.semanticChanges
      : [],
    riskChanges: Array.isArray(payload.riskChanges) ? payload.riskChanges : [],
    financialChanges: Array.isArray(payload.financialChanges)
      ? payload.financialChanges
      : [],
    complianceChanges: Array.isArray(payload.complianceChanges)
      ? payload.complianceChanges
      : [],
    operationalChanges: Array.isArray(payload.operationalChanges)
      ? payload.operationalChanges
      : [],
  };
}

module.exports = {
  buildDiffReport,
  formatMarkdownReport,
  normalizeLLMAnalysis,
};
