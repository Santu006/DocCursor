const {
  buildDocumentPayload,
  finalizeDocument,
} = require("../base");

/**
 * URL documents are created by processLink; this processor enriches saved URL content.
 * @param {object} params
 */
async function processUrlDocument({
  link,
  content,
  metadata = {},
  options = {},
}) {
  const filename = metadata.title || link;
  const data = buildDocumentPayload({
    fullFilePath: link,
    filename,
    metadata: {
      ...metadata,
      title: metadata.title || link,
      chunkSource: metadata.chunkSource || `link://${link}`,
    },
    pageContent: content,
    docSource: metadata.docSource || "URL link uploaded by the user.",
    documentStructure: {
      type: "url",
      sourceUrl: link,
      hostname: safeHostname(link),
    },
  });

  const document = finalizeDocument({
    data,
    filename,
    fullFilePath: link,
    options: { ...options, absolutePath: link },
  });

  return { success: true, reason: null, documents: [document] };
}

function safeHostname(url = "") {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

module.exports = {
  id: "url",
  extensions: [],
  canProcess: () => false,
  process: async () => ({
    success: false,
    reason: "URL documents must be processed via processLink.",
    documents: [],
  }),
  processUrlDocument,
  safeHostname,
};
