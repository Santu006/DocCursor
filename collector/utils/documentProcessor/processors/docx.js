const path = require("path");
const fs = require("fs");
const mammoth = require("mammoth");
const {
  buildDocumentPayload,
  finalizeDocument,
  canProcessExtension,
} = require("../base");
const { parseMarkdownStructure } = require("../structure");

const extensions = [".docx"];

async function process({ fullFilePath, filename, options = {}, metadata = {} }) {
  console.log(`-- [DocxProcessor] Working ${filename} --`);

  const markdownResult = await mammoth.convertToMarkdown({ path: fullFilePath });
  let content = markdownResult.value?.trim() || "";

  if (!content) {
    const textResult = await mammoth.extractRawText({ path: fullFilePath });
    content = textResult.value?.trim() || "";
  }

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

  const { headings, sections } = parseMarkdownStructure(content);
  const data = buildDocumentPayload({
    fullFilePath,
    filename,
    metadata,
    pageContent: content,
    docSource: metadata.docSource || "docx file uploaded by the user.",
    documentStructure: {
      type: "docx",
      headings,
      sections: sections.length ? sections : headings.slice(0, 12),
      paragraphCount: content.split(/\n{2,}/).filter(Boolean).length,
    },
  });

  const document = finalizeDocument({ data, filename, fullFilePath, options });
  console.log(`[SUCCESS]: ${filename} converted via DocxProcessor.\n`);
  return { success: true, reason: null, documents: [document] };
}

module.exports = {
  id: "docx",
  extensions,
  canProcess: (extension, filename = "") =>
    canProcessExtension(extension, filename, extensions),
  process,
};
