/**
 * Parse embedded document_metadata block from chunk text.
 * @param {string} text
 * @returns {Record<string, string>}
 */
function parseDocumentMetadata(text = "") {
  if (!String(text).includes("<document_metadata>")) return {};

  const block =
    String(text).split("<document_metadata>")[1]?.split("</document_metadata>")[0] ||
    "";

  const meta = {};
  for (const line of block.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key && value) meta[key] = value;
  }

  return meta;
}

/**
 * Normalize a retrieved chunk/source into a canonical citation record.
 *
 * @param {object} source
 * @returns {object}
 */
function normalizeSource(source = {}) {
  const text = source.text || "";
  const embedded = parseDocumentMetadata(text);

  return {
    documentName:
      embedded.sourceDocument ||
      source.title ||
      source.documentName ||
      "Unknown document",
    chunkId: source.id || source.chunkId || null,
    pageNumber: source.pageNumber ?? embedded.pageNumber ?? null,
    sectionTitle:
      source.sectionTitle ||
      embedded.sectionTitle ||
      embedded.section ||
      null,
    similarityScore:
      typeof source.score === "number"
        ? source.score
        : typeof source.similarityScore === "number"
          ? source.similarityScore
          : null,
    excerpt: text ? String(text).slice(0, 500) : "",
  };
}

module.exports = {
  normalizeSource,
  parseDocumentMetadata,
};
