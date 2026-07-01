/** @typedef {'document'|'folder'|'category'|'tag'|'workspace'} MentionType */

/**
 * @typedef WorkspaceDocumentMention
 * @property {string} docId
 * @property {string} filename
 * @property {string} label
 * @property {MentionType} mentionType
 */

function parseMetadata(metadata) {
  if (!metadata) return {};
  try {
    return JSON.parse(metadata);
  } catch {
    return {};
  }
}

export function getDocumentLabel(doc) {
  const metadata = parseMetadata(doc?.metadata);
  return metadata?.title || doc?.filename || "Document";
}

export function mapWorkspaceDocuments(documents = []) {
  return documents.map((doc) => ({
    docId: doc.docId,
    filename: doc.filename,
    label: getDocumentLabel(doc),
    mentionType: "document",
  }));
}

export function resolveDocumentMention(workspaceDocuments = [], docpath = "") {
  const doc = workspaceDocuments.find((d) => d.docpath === docpath);
  if (!doc?.docId) return null;
  return mapWorkspaceDocuments([doc])[0];
}
