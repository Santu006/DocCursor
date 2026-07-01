/** Supported extensions for enterprise folder upload (Phase 8.1). */
const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  ".csv",
  ".xlsx",
  ".pptx",
]);

const EXTENSION_LABELS = {
  ".pdf": "PDF",
  ".docx": "DOCX",
  ".txt": "TXT",
  ".md": "MD",
  ".csv": "CSV",
  ".xlsx": "XLSX",
  ".pptx": "PPTX",
};

const DEFAULT_UPLOAD_CONCURRENCY = Number(
  process.env.FOLDER_UPLOAD_CONCURRENCY || 4
);

const SKIPPED_NAMES = new Set([
  ".ds_store",
  "thumbs.db",
  "desktop.ini",
  ".gitkeep",
]);

module.exports = {
  DEFAULT_UPLOAD_CONCURRENCY,
  EXTENSION_LABELS,
  SKIPPED_NAMES,
  SUPPORTED_EXTENSIONS,
};
