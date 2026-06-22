const xlsx = require("node-xlsx").default;
const path = require("path");
const fs = require("fs");
const { v4 } = require("uuid");
const { default: slugify } = require("slugify");
const {
  buildDocumentPayload,
  finalizeDocument,
  canProcessExtension,
} = require("../base");
const { documentsFolder } = require("../../files");

const extensions = [".xlsx"];

function convertToCSV(data) {
  return data
    .map((row) =>
      row
        .map((cell) => {
          if (cell === null || cell === undefined) return "";
          if (typeof cell === "string" && cell.includes(",")) return `"${cell}"`;
          return cell;
        })
        .join(",")
    )
    .join("\n");
}

function processSheet(sheet) {
  const { name, data } = sheet;
  const content = convertToCSV(data);
  if (!content?.length) return null;
  const headers = (data[0] || [])
    .map((cell) => (cell == null ? "" : String(cell).trim()))
    .filter(Boolean);
  return {
    name,
    content,
    headers,
    rowCount: Math.max(data.length - 1, 0),
    wordCount: content.split(/\s+/).length,
  };
}

async function process({ fullFilePath, filename, options = {}, metadata = {} }) {
  console.log(`-- [XlsxProcessor] Working ${filename} --`);
  const documents = [];

  try {
    const workSheetsFromFile = xlsx.parse(fullFilePath);

    if (options.parseOnly) {
      const sheetNames = [];
      const sheetSummaries = [];
      let combinedContent = "";
      let totalWordCount = 0;

      for (const sheet of workSheetsFromFile) {
        const processed = processSheet(sheet);
        if (!processed) continue;
        sheetNames.push(processed.name);
        sheetSummaries.push(
          `Sheet "${processed.name}": ${processed.headers.length} columns, ${processed.rowCount} rows`
        );
        combinedContent += `\n\n## Sheet: ${processed.name}\nColumns: ${processed.headers.join(", ")}\n\n${processed.content}`;
        totalWordCount += processed.wordCount;
      }

      if (!combinedContent.trim()) {
        return {
          success: false,
          reason: `No valid sheets found in ${filename}.`,
          documents: [],
        };
      }

      const workbookSummary = [
        "Workbook summary:",
        `- Sheets (${sheetNames.length}): ${sheetNames.join(", ")}`,
        ...sheetSummaries.map((line) => `- ${line}`),
        "",
      ].join("\n");

      const data = buildDocumentPayload({
        fullFilePath,
        filename,
        metadata: {
          ...metadata,
          title: metadata.title || filename,
          description:
            metadata.description ||
            `Excel workbook with ${sheetNames.length} sheet(s).`,
        },
        pageContent: `${workbookSummary}${combinedContent}`,
        docSource: metadata.docSource || "xlsx file uploaded by the user.",
        documentStructure: {
          type: "xlsx",
          sheetNames,
          sheetCount: sheetNames.length,
        },
      });

      documents.push(
        finalizeDocument({ data, filename, fullFilePath, options })
      );
    } else {
      const folderName = slugify(`${path.basename(filename)}-${v4().slice(0, 4)}`, {
        lower: true,
        trim: true,
      });
      const outFolderPath = path.resolve(documentsFolder, folderName);
      if (!fs.existsSync(outFolderPath)) {
        fs.mkdirSync(outFolderPath, { recursive: true });
      }

      for (const sheet of workSheetsFromFile) {
        const processed = processSheet(sheet);
        if (!processed) continue;

        const sheetIntro = [
          `Sheet: ${processed.name}`,
          `Columns: ${processed.headers.join(", ")}`,
          `Rows: ${processed.rowCount}`,
          "",
        ].join("\n");

        const data = buildDocumentPayload({
          fullFilePath: path.join(outFolderPath, `${slugify(processed.name)}.csv`),
          filename: `${filename} - Sheet:${processed.name}`,
          metadata: {
            ...metadata,
            title: metadata.title || `${filename} - Sheet:${processed.name}`,
            description:
              metadata.description ||
              `Sheet "${processed.name}" with ${processed.headers.length} columns.`,
          },
          pageContent: `${sheetIntro}\n${processed.content}`,
          docSource: metadata.docSource || "xlsx file uploaded by the user.",
          documentStructure: {
            type: "xlsx",
            sheetNames: [processed.name],
            columns: processed.headers,
            rowCount: processed.rowCount,
          },
        });

        documents.push(
          finalizeDocument({
            data,
            filename: `sheet-${slugify(processed.name)}`,
            fullFilePath,
            options: { ...options, skipTrash: true },
            destinationOverride: outFolderPath,
          })
        );
      }
    }
  } catch (error) {
    return {
      success: false,
      reason: `Error processing ${filename}: ${error.message}`,
      documents: [],
    };
  } finally {
    if (!options.absolutePath) {
      const { trashFile } = require("../../files");
      trashFile(fullFilePath);
    }
  }

  if (!documents.length) {
    return {
      success: false,
      reason: `No valid sheets found in ${filename}.`,
      documents: [],
    };
  }

  console.log(
    `[SUCCESS]: ${filename} converted via XlsxProcessor (${documents.length} document(s)).\n`
  );
  return { success: true, reason: null, documents };
}

module.exports = {
  id: "xlsx",
  extensions,
  canProcess: (extension, filename = "") =>
    canProcessExtension(extension, filename, extensions),
  process,
};
