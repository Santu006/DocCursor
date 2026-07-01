/** @typedef {'document'|'folder'|'category'|'tag'|'collection'|'workspace'} ContextDragMentionType */

/**
 * @typedef ContextDragItem
 * @property {string} [docId]
 * @property {string} [filename]
 * @property {string} label
 * @property {ContextDragMentionType} mentionType
 * @property {string} [docpath]
 * @property {string[]} [documentIds] - resolved doc IDs for folder/category/collection drops
 */

/**
 * @typedef ContextDragPayload
 * @property {number} version
 * @property {string} workspaceSlug
 * @property {ContextDragItem[]} items
 */

export const DOCUMENT_CONTEXT_DRAG_MIME = "application/x-doccursor-context";

export const ContextDragType = {
  DOCUMENT: "document",
  FOLDER: "folder",
  CATEGORY: "category",
  TAG: "tag",
  COLLECTION: "collection",
  WORKSPACE: "workspace",
};

/**
 * @param {ContextDragItem} item
 * @returns {ContextDragItem|null}
 */
export function normalizeContextDragItem(item = {}) {
  if (!item || typeof item !== "object") return null;

  const mentionType = item.mentionType || ContextDragType.DOCUMENT;
  const label = String(item.label || item.filename || "").trim();
  if (!label) return null;

  if (mentionType === ContextDragType.DOCUMENT && !item.docId) return null;

  return {
    docId: item.docId || null,
    filename: item.filename || null,
    label,
    mentionType,
    docpath: item.docpath || null,
    documentIds: Array.isArray(item.documentIds)
      ? item.documentIds.filter(Boolean)
      : undefined,
  };
}

/**
 * @param {object} params
 * @param {string} params.workspaceSlug
 * @param {ContextDragItem|ContextDragItem[]} params.items
 * @returns {ContextDragPayload}
 */
export function buildContextDragPayload({ workspaceSlug, items = [] }) {
  const list = Array.isArray(items) ? items : [items];
  return {
    version: 1,
    workspaceSlug: String(workspaceSlug || ""),
    items: list.map(normalizeContextDragItem).filter(Boolean),
  };
}

/**
 * @param {string} raw
 * @returns {ContextDragPayload|null}
 */
export function parseContextDragPayload(raw = "") {
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const items = (parsed.items || [])
      .map(normalizeContextDragItem)
      .filter(Boolean);
    if (!items.length) return null;
    return {
      version: parsed.version || 1,
      workspaceSlug: String(parsed.workspaceSlug || ""),
      items,
    };
  } catch {
    return null;
  }
}

/**
 * @param {DataTransfer} dataTransfer
 * @returns {boolean}
 */
export function isContextDragEvent(dataTransfer) {
  if (!dataTransfer?.types) return false;
  return Array.from(dataTransfer.types).includes(DOCUMENT_CONTEXT_DRAG_MIME);
}

/**
 * @param {DataTransfer} dataTransfer
 * @param {object} params
 */
export function setContextDragData(dataTransfer, params) {
  const payload = buildContextDragPayload(params);
  if (!payload.items.length) return;

  dataTransfer.setData(
    DOCUMENT_CONTEXT_DRAG_MIME,
    JSON.stringify(payload)
  );
  dataTransfer.setData("text/plain", payload.items[0]?.label || "");
  dataTransfer.effectAllowed = "copy";
}

/**
 * @param {DataTransfer} dataTransfer
 * @returns {ContextDragPayload|null}
 */
export function readContextDragData(dataTransfer) {
  if (!dataTransfer) return null;
  return parseContextDragPayload(
    dataTransfer.getData(DOCUMENT_CONTEXT_DRAG_MIME)
  );
}

/**
 * Expand drag payload items into document mention chips.
 * Folder/category/collection types can supply documentIds for future use.
 *
 * @param {ContextDragPayload|null} payload
 * @param {object[]} workspaceDocuments - documents from mention context
 * @returns {object[]}
 */
export function resolveContextDragItems(payload, workspaceDocuments = []) {
  if (!payload?.items?.length) return [];

  const byDocId = new Map(
    workspaceDocuments.map((doc) => [doc.docId, doc])
  );
  const resolved = [];
  const seen = new Set();

  for (const item of payload.items) {
    if (item.mentionType === ContextDragType.DOCUMENT && item.docId) {
      const doc = byDocId.get(item.docId) || item;
      if (seen.has(doc.docId)) continue;
      seen.add(doc.docId);
      resolved.push({
        ...doc,
        mentionType: ContextDragType.DOCUMENT,
      });
      continue;
    }

    const ids = item.documentIds || [];
    for (const docId of ids) {
      const doc = byDocId.get(docId);
      if (!doc || seen.has(docId)) continue;
      seen.add(docId);
      resolved.push({ ...doc, mentionType: ContextDragType.DOCUMENT });
    }
  }

  return resolved;
}
