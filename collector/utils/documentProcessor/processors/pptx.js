const officeParser = require("officeparser");
const {
  buildDocumentPayload,
  finalizeDocument,
  canProcessExtension,
} = require("../base");
const { parsePresentationStructure } = require("../structure");

const extensions = [".pptx"];

async function process({ fullFilePath, filename, options = {}, metadata = {} }) {
  console.log(`-- [PptxProcessor] Working ${filename} --`);
  let rawContent = "";

  try {
    rawContent = await officeParser.parseOfficeAsync(fullFilePath);
  } catch (error) {
    console.error("Could not parse presentation file", error);
  }

  if (!rawContent?.trim()) {
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

  const { slideTitles, slideCount, structuredText } =
    parsePresentationStructure(rawContent);
  const summary = [
    "Presentation summary:",
    `- Slides: ${slideCount}`,
    slideTitles.length
      ? `- Slide titles: ${slideTitles.slice(0, 8).join(" | ")}`
      : "",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  const data = buildDocumentPayload({
    fullFilePath,
    filename,
    metadata: {
      ...metadata,
      description:
        metadata.description ||
        `Presentation with ${slideCount} slide(s).`,
    },
    pageContent: `${summary}\n${structuredText}`,
    docSource: metadata.docSource || "pptx file uploaded by the user.",
    documentStructure: {
      type: "pptx",
      slideTitles,
      slideCount,
    },
  });

  const document = finalizeDocument({ data, filename, fullFilePath, options });
  console.log(`[SUCCESS]: ${filename} converted via PptxProcessor.\n`);
  return { success: true, reason: null, documents: [document] };
}

module.exports = {
  id: "pptx",
  extensions,
  canProcess: (extension, filename = "") =>
    canProcessExtension(extension, filename, extensions),
  process,
};
