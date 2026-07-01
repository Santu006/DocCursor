const { Document } = require("../../models/documents");

/**
 * Normalize and validate selected document IDs for the current workspace.
 * @param {number} workspaceId
 * @param {string[]} selectedDocumentIds
 * @returns {Promise<string[]>}
 */
async function normalizeSelectedDocumentIds(
  workspaceId,
  selectedDocumentIds = []
) {
  if (!workspaceId || !Array.isArray(selectedDocumentIds)) return [];
  const unique = [
    ...new Set(
      selectedDocumentIds
        .filter((id) => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim())
    ),
  ];
  if (unique.length === 0) return [];

  const workspaceDocs = await Document.forWorkspace(workspaceId);
  const validIds = new Set(workspaceDocs.map((doc) => doc.docId));
  return unique.filter((id) => validIds.has(id));
}

/**
 * Whether scoped document retrieval is active.
 * @param {string[]} selectedDocumentIds
 * @returns {boolean}
 */
function hasDocumentMentionScope(selectedDocumentIds = []) {
  return (
    Array.isArray(selectedDocumentIds) && selectedDocumentIds.length > 0
  );
}

module.exports = {
  normalizeSelectedDocumentIds,
  hasDocumentMentionScope,
};
