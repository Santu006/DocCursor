import {
  getDocumentLabel,
  mapWorkspaceDocuments,
} from "@/utils/documentMentionModel";

/** @typedef {'document'|'folder'|'category'|'tag'} MentionType */

/**
 * @typedef WorkspaceDocumentMention
 * @property {string} docId
 * @property {string} filename
 * @property {string} label
 * @property {MentionType} mentionType
 */

export { getDocumentLabel, mapWorkspaceDocuments };

/**
 * Detect active @ mention query at cursor.
 * @returns {{ active: boolean, query: string, start: number, end: number }}
 */
export function detectMentionAtCursor(text = "", cursorPos = 0) {
  const before = text.slice(0, cursorPos);
  const atIndex = before.lastIndexOf("@");
  if (atIndex === -1) return { active: false, query: "", start: -1, end: cursorPos };

  const afterAt = before.slice(atIndex + 1);
  if (/\s/.test(afterAt)) return { active: false, query: "", start: -1, end: cursorPos };

  return {
    active: true,
    query: afterAt,
    start: atIndex,
    end: cursorPos,
  };
}

export function highlightMatch(label = "", query = "") {
  if (!query) return [{ text: label, match: false }];
  const lower = label.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx === -1) return [{ text: label, match: false }];
  return [
    { text: label.slice(0, idx), match: false },
    { text: label.slice(idx, idx + query.length), match: true },
    { text: label.slice(idx + query.length), match: false },
  ].filter((part) => part.text.length > 0);
}

export function filterMentionDocuments(documents = [], query = "", selectedIds = []) {
  const q = query.trim().toLowerCase();
  return documents
    .filter((doc) => !selectedIds.includes(doc.docId))
    .filter((doc) => {
      if (!q) return true;
      return (
        doc.label.toLowerCase().includes(q) ||
        doc.filename.toLowerCase().includes(q)
      );
    })
    .slice(0, 12);
}
