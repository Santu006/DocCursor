const fs = require("fs");
const {
  buildDocumentPayload,
  finalizeDocument,
  canProcessExtension,
} = require("../base");
const { extractPlainTextHeadings } = require("../structure");

const extensions = [".txt"];

async function process({ fullFilePath, filename, options = {}, metadata = {} }) {
  console.log(`-- [TxtProcessor] Working ${filename} --`);
  const content = fs.readFileSync(fullFilePath, "utf8").trim();

  if (!content) {
    if (!options.absolutePath) {
      const { trashFile } = require("../../files");
      trashFile(fullFilePath);
    }
    return {
      success: false,
      reason: `No text content found in ${filename}.`,
      documents: [],
    };
  }

  const headings = extractPlainTextHeadings(content);
  const data = buildDocumentPayload({
    fullFilePath,
    filename,
    metadata,
    pageContent: content,
    docSource: metadata.docSource || "text file uploaded by the user.",
    documentStructure: {
      type: "txt",
      headings,
      lineCount: content.split(/\r?\n/).length,
    },
  });

  const document = finalizeDocument({ data, filename, fullFilePath, options });
  console.log(`[SUCCESS]: ${filename} converted via TxtProcessor.\n`);
  return { success: true, reason: null, documents: [document] };
}

module.exports = {
  id: "txt",
  extensions,
  canProcess: (extension, filename = "") =>
    canProcessExtension(extension, filename, extensions),
  process,
};
