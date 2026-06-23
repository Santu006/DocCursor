const {
  buildWorkspaceReport,
  formatReportAsContext,
} = require("../workspaceReport");
const { containsAdvisoryLanguage } = require("../workspaceReport/objectivity");

/**
 * Patterns for executive workspace report queries.
 */
const EXECUTIVE_REPORT_PATTERNS = [
  /\bsummari[sz]e\s+(this\s+)?(workspace|project)\b/i,
  /\bexecutive\s+report\b/i,
  /\bworkspace\s+(briefing|summary|overview)\b/i,
  /\bwhat\s+should\s+i\s+review\s+first\b/i,
  /\b(show|list|what\s+are)\s+(the\s+)?key\s+risks?\b/i,
  /\bkey\s+risks?\s+(in|for|across)\s+(this\s+)?(workspace|project)\b/i,
  /\brecommended\s+(documents?|files?)\s+(for\s+)?review\b/i,
  /\bexecutive\s+briefing\b/i,
];

/**
 * @param {string} message
 * @returns {boolean}
 */
function isExecutiveReportQuery(message = "") {
  if (!message || typeof message !== "string") return false;
  const normalized = message.trim();
  if (!normalized) return false;

  if (/@document\//i.test(normalized)) return false;

  return EXECUTIVE_REPORT_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * @param {string} message
 * @returns {"review-priority"|"key-risks"|"full-report"}
 */
function classifyReportQuery(message = "") {
  const normalized = message.trim();

  if (/\bwhat\s+should\s+i\s+review\s+first\b/i.test(normalized)) {
    return "review-priority";
  }

  if (/\b(show|list|what\s+are)\s+(the\s+)?key\s+risks?\b/i.test(normalized)) {
    return "key-risks";
  }

  return "full-report";
}

/**
 * @param {object} report
 * @param {string} message
 * @returns {string}
 */
function formatReportContext(report, message) {
  const queryType = classifyReportQuery(message);

  if (queryType === "review-priority") {
    const lines = [
      "## Recommended Review Order",
      "",
    ];
    if (!report.reviewOrder?.length) {
      lines.push("No prioritized documents identified.");
    } else {
      for (const item of report.reviewOrder.slice(0, 15)) {
        lines.push(`${item.rank}. ${item.document} (risk score ${item.riskScore})`);
      }
    }
    return lines.join("\n");
  }

  if (queryType === "key-risks") {
    const lines = [
      "## Risk Indicators",
      "",
      "| Document | Risk Reason | Severity |",
      "| --- | --- | --- |",
    ];
    if (!report.riskTable?.length) {
      lines.push("| — | No risk indicators detected | — |");
    } else {
      for (const row of report.riskTable.slice(0, 20)) {
        lines.push(`| ${row.document} | ${row.riskReason} | ${row.severity} |`);
      }
    }
    return lines.join("\n");
  }

  return formatReportAsContext(report);
}

/**
 * Run executive report analysis for chat.
 *
 * @param {object} params
 * @param {string} params.message
 * @param {object} params.workspace
 * @returns {Promise<{ handled: boolean, context?: string, report?: object, error?: string }>}
 */
async function performExecutiveReportQuery({ message, workspace }) {
  if (!isExecutiveReportQuery(message)) {
    return { handled: false };
  }

  try {
    const report = await buildWorkspaceReport({ workspace });

    return {
      handled: true,
      report,
      context: `${formatReportContext(report, message)}

Executive report instructions:
- Present workspace metrics only (documents, categories, topics, clusters, risks, duplicates)
- Do not provide legal advice or recommendations about which agreement is better
- Use the risk table and review order exactly as listed
- If data is incomplete, state that fact objectively`,
    };
  } catch (error) {
    console.error("[workspaceReportRetrieval]", error);
    return {
      handled: true,
      error: `Executive report generation failed: ${error.message}`,
    };
  }
}

const EXECUTIVE_REPORT_SYSTEM_PROMPT = `You are a workspace business intelligence assistant.
When executive report context is provided, answer ONLY from that deterministic report.

Rules:
- Report workspace-level metrics and classifications only
- Never provide legal advice, contract recommendations, or language like "ideal", "advantageous", or "clients should"
- Use the risk table format: Document | Risk Reason | Severity
- For review priority, list documents in the provided review order only
- Do not speculate beyond the report data
- If enrichment is still pending, note that the briefing may be incomplete`;

module.exports = {
  EXECUTIVE_REPORT_PATTERNS,
  EXECUTIVE_REPORT_SYSTEM_PROMPT,
  classifyReportQuery,
  containsAdvisoryLanguage,
  formatReportContext,
  isExecutiveReportQuery,
  performExecutiveReportQuery,
};
