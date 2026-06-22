const moment = require("moment");
const { formatMarkdownReport } = require("./diffReport");
const { applyReportTemplate } = require("./reportTemplates");
const { DocumentComparisons } = require("../../models/documentComparisons");
const {
  applyBranding,
} = require("../agents/aibitat/plugins/create-files/pdf/utils.js");

const VALID_EXPORT_TYPES = ["pdf", "markdown", "docx", "md"];

/**
 * @param {object} review
 * @param {string} [templateId]
 * @returns {string}
 */
function buildReviewMarkdown(review, templateId = null) {
  const report = applyReportTemplate(
    review.comparison || review.report || {},
    templateId || review.template || "legal_review"
  );

  const titleA = review.documentALabel || DocumentComparisons.displayDocName(review.documentA);
  const titleB = review.documentBLabel || DocumentComparisons.displayDocName(review.documentB);

  if (report.report && typeof report.report === "string") {
    return report.report;
  }

  return formatMarkdownReport({
    titleA,
    titleB,
    executive: {
      summaryText: report.executiveSummary || report.summary || review.summary || "",
      overallChangeLevel: report.overallChangeLevel || review.riskLevel || "LOW",
      financialImpactLevel: report.financialImpactLevel || "LOW",
      legalRiskLevel: report.legalRiskLevel || "LOW",
      riskScore: report.riskScore ?? review.riskScore ?? null,
      keyChanges: report.keyChanges || [],
    },
    added: report.added || [],
    removed: report.removed || [],
    modified: report.modified || [],
    financialChanges: report.financialChanges || [],
    riskChanges: report.riskChanges || [],
    complianceChanges: report.complianceChanges || [],
    operationalChanges: report.operationalChanges || [],
    llmAnalysis: null,
  });
}

/**
 * @param {string} markdown
 * @returns {Promise<Buffer>}
 */
async function markdownToPdfBuffer(markdown) {
  const { markdownToPdf } = await import("@mintplex-labs/mdpdf");
  const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");
  const pdfDoc = await PDFDocument.load(await markdownToPdf(markdown));
  await applyBranding(pdfDoc, { rgb, StandardFonts });
  return Buffer.from(await pdfDoc.save());
}

/**
 * @param {string} markdown
 * @param {string} title
 * @returns {Promise<Buffer>}
 */
async function markdownToDocxBuffer(markdown, title = "Document Review") {
  const { marked } = await import("marked");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");

  const lines = markdown.split("\n");
  const children = [
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      spacing: { after: 240 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Exported ${moment().format("MMMM D, YYYY h:mm A")}`,
          italics: true,
          size: 20,
        }),
      ],
      spacing: { after: 240 },
    }),
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      children.push(new Paragraph({ text: "" }));
      continue;
    }
    if (trimmed.startsWith("# ")) {
      children.push(
        new Paragraph({ text: trimmed.slice(2), heading: HeadingLevel.HEADING_1 })
      );
      continue;
    }
    if (trimmed.startsWith("## ")) {
      children.push(
        new Paragraph({ text: trimmed.slice(3), heading: HeadingLevel.HEADING_2 })
      );
      continue;
    }
    if (trimmed.startsWith("### ")) {
      children.push(
        new Paragraph({ text: trimmed.slice(4), heading: HeadingLevel.HEADING_3 })
      );
      continue;
    }
    if (trimmed.startsWith("- ")) {
      children.push(new Paragraph({ text: trimmed.slice(2), bullet: { level: 0 } }));
      continue;
    }
    children.push(new Paragraph({ text: trimmed.replace(/\*\*/g, "") }));
  }

  const doc = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

/**
 * @param {object} review
 * @param {string} type
 * @param {string} [templateId]
 * @returns {Promise<{ buffer: Buffer, contentType: string, filename: string }>}
 */
async function exportReview(review, type = "pdf", templateId = null) {
  const normalizedType = type === "md" ? "markdown" : type;
  if (!VALID_EXPORT_TYPES.includes(normalizedType)) {
    throw new Error(`Unsupported export type: ${type}`);
  }

  const markdown = buildReviewMarkdown(review, templateId);
  const baseName = (review.title || "document-review")
    .replace(/[^a-z0-9-_ ]/gi, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);

  if (normalizedType === "markdown") {
    return {
      buffer: Buffer.from(markdown, "utf-8"),
      contentType: "text/markdown",
      filename: `${baseName}.md`,
    };
  }

  if (normalizedType === "pdf") {
    return {
      buffer: await markdownToPdfBuffer(markdown),
      contentType: "application/pdf",
      filename: `${baseName}.pdf`,
    };
  }

  if (normalizedType === "docx") {
    return {
      buffer: await markdownToDocxBuffer(markdown, review.title || "Document Review"),
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: `${baseName}.docx`,
    };
  }

  throw new Error(`Unsupported export type: ${type}`);
}

module.exports = {
  exportReview,
  buildReviewMarkdown,
  VALID_EXPORT_TYPES,
};
