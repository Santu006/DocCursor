const fs = require("fs");
const {
  buildDocumentPayload,
  finalizeDocument,
  canProcessExtension,
} = require("../base");
const { parseMarkdownStructure } = require("../structure");

const extensions = [".md"];

async function process({ fullFilePath, filename, options = {}, metadata = {} }) {
  console.log(`-- [MarkdownProcessor] Working ${filename} --`);
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

  const { headings, sections } = parseMarkdownStructure(content);
  const data = buildDocumentPayload({
    fullFilePath,
    filename,
    metadata,
    pageContent: content,
    docSource: metadata.docSource || "markdown file uploaded by the user.",
    documentStructure: {
      type: "markdown",
      headings,
      sections: sections.length ? sections : headings,
      hierarchyDepth: headings.length
        ? Math.max(
            ...content
              .split("\n")
              .filter((line) => /^#{1,6}\s+/.test(line))
              .map((line) => line.match(/^(#+)/)[1].length)
          )
        : 0,
    },
  });

  const document = finalizeDocument({ data, filename, fullFilePath, options });
  console.log(`[SUCCESS]: ${filename} converted via MarkdownProcessor.\n`);
  return { success: true, reason: null, documents: [document] };
}

module.exports = {
  id: "markdown",
  extensions,
  canProcess: (extension, filename = "") =>
    canProcessExtension(extension, filename, extensions),
  process,
};
