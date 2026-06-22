const fs = require("fs");
const {
  buildDocumentPayload,
  finalizeDocument,
  canProcessExtension,
} = require("../base");
const { parseCsvStructure } = require("../structure");

const extensions = [".csv"];

async function process({ fullFilePath, filename, options = {}, metadata = {} }) {
  console.log(`-- [CsvProcessor] Working ${filename} --`);
  const raw = fs.readFileSync(fullFilePath, "utf8").trim();

  if (!raw) {
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

  const { columns, rowCount, schemaSummary } = parseCsvStructure(raw);
  const pageContent = `${schemaSummary}${raw}`;

  const data = buildDocumentPayload({
    fullFilePath,
    filename,
    metadata: {
      ...metadata,
      description:
        metadata.description ||
        `CSV with ${columns.length} columns and ${rowCount} rows.`,
    },
    pageContent,
    docSource: metadata.docSource || "csv file uploaded by the user.",
    documentStructure: {
      type: "csv",
      columns,
      rowCount,
      columnCount: columns.length,
    },
  });

  const document = finalizeDocument({ data, filename, fullFilePath, options });
  console.log(`[SUCCESS]: ${filename} converted via CsvProcessor.\n`);
  return { success: true, reason: null, documents: [document] };
}

module.exports = {
  id: "csv",
  extensions,
  canProcess: (extension, filename = "") =>
    canProcessExtension(extension, filename, extensions),
  process,
};
