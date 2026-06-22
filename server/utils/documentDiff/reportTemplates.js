/**
 * Report templates for document comparison reviews.
 */

const REPORT_TEMPLATES = {
  legal_review: {
    id: "legal_review",
    label: "Legal Review",
    description: "Full legal clause analysis with risk scoring.",
    sections: [
      "executiveSummary",
      "riskScore",
      "added",
      "removed",
      "modified",
      "financialChanges",
      "riskChanges",
      "operationalChanges",
    ],
  },
  compliance_review: {
    id: "compliance_review",
    label: "Compliance Review",
    description: "Focus on compliance, regulatory, and policy changes.",
    sections: [
      "executiveSummary",
      "riskScore",
      "complianceChanges",
      "modified",
      "riskChanges",
    ],
  },
  financial_review: {
    id: "financial_review",
    label: "Financial Review",
    description: "Payment terms, retainer, and billing impact focus.",
    sections: [
      "executiveSummary",
      "riskScore",
      "financialChanges",
      "modified",
      "added",
      "removed",
    ],
  },
  executive_summary: {
    id: "executive_summary",
    label: "Executive Summary",
    description: "Concise leadership overview with key risks only.",
    sections: ["executiveSummary", "riskScore", "keyChanges"],
  },
};

/**
 * @param {string} templateId
 * @returns {object}
 */
function getReportTemplate(templateId = "legal_review") {
  return REPORT_TEMPLATES[templateId] || REPORT_TEMPLATES.legal_review;
}

/**
 * Filter report sections according to template.
 *
 * @param {object} report
 * @param {string} templateId
 * @returns {object}
 */
function applyReportTemplate(report = {}, templateId = "legal_review") {
  const template = getReportTemplate(templateId);
  const filtered = { ...report, template: template.id, templateLabel: template.label };

  if (!template.sections.includes("added")) filtered.added = [];
  if (!template.sections.includes("removed")) filtered.removed = [];
  if (!template.sections.includes("modified")) filtered.modified = [];
  if (!template.sections.includes("financialChanges")) filtered.financialChanges = [];
  if (!template.sections.includes("riskChanges")) filtered.riskChanges = [];
  if (!template.sections.includes("complianceChanges")) filtered.complianceChanges = [];
  if (!template.sections.includes("operationalChanges")) filtered.operationalChanges = [];
  if (!template.sections.includes("keyChanges")) filtered.keyChanges = [];

  return filtered;
}

module.exports = {
  REPORT_TEMPLATES,
  getReportTemplate,
  applyReportTemplate,
};
