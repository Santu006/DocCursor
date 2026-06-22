const pdfProcessor = require("./processors/pdf");
const docxProcessor = require("./processors/docx");
const markdownProcessor = require("./processors/markdown");
const txtProcessor = require("./processors/txt");
const csvProcessor = require("./processors/csv");
const xlsxProcessor = require("./processors/xlsx");
const pptxProcessor = require("./processors/pptx");
const urlProcessor = require("./processors/url");

/** @type {import('./types').DocumentProcessor[]} */
const PROCESSORS = [
  pdfProcessor,
  docxProcessor,
  markdownProcessor,
  txtProcessor,
  csvProcessor,
  xlsxProcessor,
  pptxProcessor,
  urlProcessor,
];

/**
 * @param {string} extension
 * @param {string} [filename]
 * @returns {import('./types').DocumentProcessor|null}
 */
function getProcessor(extension = "", filename = "") {
  const normalized = String(extension || "").toLowerCase();
  return (
    PROCESSORS.find((processor) =>
      processor.canProcess(normalized, filename)
    ) || null
  );
}

/**
 * Unified ingestion entry for file-based documents.
 * @param {string} extension
 * @param {object} context
 */
async function processWithProcessor(extension, context) {
  const processor = getProcessor(extension, context.filename);
  if (!processor) return null;
  return processor.process(context);
}

/**
 * @param {string} extension
 * @returns {boolean}
 */
function isSupportedByProcessor(extension = "") {
  return Boolean(getProcessor(String(extension).toLowerCase()));
}

/**
 * @returns {string[]}
 */
function listSupportedExtensions() {
  const extensions = new Set();
  for (const processor of PROCESSORS) {
    for (const ext of processor.extensions || []) extensions.add(ext);
  }
  return [...extensions].sort();
}

module.exports = {
  PROCESSORS,
  getProcessor,
  processWithProcessor,
  isSupportedByProcessor,
  listSupportedExtensions,
  PdfProcessor: pdfProcessor,
  DocxProcessor: docxProcessor,
  MarkdownProcessor: markdownProcessor,
  TxtProcessor: txtProcessor,
  CsvProcessor: csvProcessor,
  XlsxProcessor: xlsxProcessor,
  PptxProcessor: pptxProcessor,
  UrlProcessor: urlProcessor,
};
