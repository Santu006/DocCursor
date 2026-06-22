const { v4 } = require("uuid");
const { tokenizeString } = require("../tokenizer");
const { createdDate, writeToServerDocuments } = require("../files");
const { default: slugify } = require("slugify");

/**
 * @typedef {Object} DocumentStructure
 * @property {string} type - Processor type id (docx, markdown, csv, ...)
 * @property {string[]} [headings]
 * @property {string[]} [sections]
 * @property {string[]} [columns]
 * @property {string[]} [sheetNames]
 * @property {string[]} [slideTitles]
 * @property {number} [rowCount]
 * @property {number} [slideCount]
 * @property {string} [sourceUrl]
 * @property {Record<string, unknown>} [extra]
 */

/**
 * @param {string} extension
 * @param {string} filename
 * @returns {boolean}
 */
function canProcessExtension(extension, filename, extensions = []) {
  const ext = String(extension || "").toLowerCase();
  if (extensions.includes(ext)) return true;
  return extensions.some((item) => filename.toLowerCase().endsWith(item));
}

/**
 * @param {object} params
 * @returns {object}
 */
function buildDocumentPayload({
  fullFilePath,
  filename,
  metadata = {},
  pageContent,
  docSource,
  documentStructure = null,
}) {
  const content = String(pageContent || "");
  return {
    id: v4(),
    url: `file://${fullFilePath}`,
    title: metadata.title || filename,
    docAuthor: metadata.docAuthor || "Unknown",
    description: metadata.description || "No description found.",
    docSource: docSource || "file uploaded by the user.",
    chunkSource: metadata.chunkSource || "",
    published: createdDate(fullFilePath),
    wordCount: content.split(/\s+/).filter(Boolean).length,
    pageContent: content,
    token_count_estimate: tokenizeString(content),
    documentStructure: documentStructure
      ? JSON.stringify(documentStructure)
      : null,
  };
}

/**
 * @param {object} params
 * @returns {object}
 */
function finalizeDocument({
  data,
  filename,
  fullFilePath,
  options = {},
  destinationOverride = null,
}) {
  const document = writeToServerDocuments({
    data,
    filename: `${slugify(filename)}-${data.id}`,
    destinationOverride,
    options: { parseOnly: options.parseOnly },
  });
  if (!options.absolutePath && !options.skipTrash) {
    const { trashFile } = require("../files");
    trashFile(fullFilePath);
  }
  return document;
}

/**
 * @param {object} ProcessorClass
 * @returns {object}
 */
function createProcessor(ProcessorClass) {
  return new ProcessorClass();
}

module.exports = {
  buildDocumentPayload,
  finalizeDocument,
  canProcessExtension,
  createProcessor,
};
