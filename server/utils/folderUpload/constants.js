/** Supported extensions for enterprise folder upload (Phase 8.1). */
const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  ".html",
  ".htm",
  ".json",
  ".org",
  ".adoc",
  ".rst",
  ".csv",
  ".xlsx",
  ".pptx",
  ".odt",
  ".odp",
  ".epub",
]);

const EXTENSION_LABELS = {
  ".pdf": "PDF",
  ".docx": "DOCX",
  ".txt": "TXT",
  ".md": "MD",
  ".html": "HTML",
  ".htm": "HTML",
  ".json": "JSON",
  ".org": "ORG",
  ".adoc": "AsciiDoc",
  ".rst": "RST",
  ".csv": "CSV",
  ".xlsx": "XLSX",
  ".pptx": "PPTX",
  ".odt": "ODT",
  ".odp": "ODP",
  ".epub": "EPUB",
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
