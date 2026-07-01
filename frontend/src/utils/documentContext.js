import { resolveDocumentMention as resolveDocumentMentionModel } from "@/utils/documentMentionModel";

export const DOCUMENT_CONTEXT_ACTION_EVENT =
  "doccursor_document_context_action";
export const OPEN_DOCUMENT_MENTION_PICKER_EVENT =
  "doccursor_open_document_mention_picker";
export const FOCUS_PROMPT_INPUT_EVENT = "doccursor_focus_prompt_input";
export const SET_PROMPT_MESSAGE_EVENT = "doccursor_set_prompt_message";
export const PENDING_DOCUMENT_CONTEXT = "doccursor_pending_document_context";
export const WORKSPACE_DOCUMENTS_CHANGED_EVENT =
  "doccursor_workspace_documents_changed";
export const AUTO_SUBMIT_CHAT_EVENT = "doccursor_auto_submit_chat";

/** @typedef {'ask'|'summarize'|'compare'|'executive_report'|'copy_filename'} DocumentContextActionType */

export const DocumentContextAction = {
  ASK: "ask",
  SUMMARIZE: "summarize",
  COMPARE: "compare",
  EXECUTIVE_REPORT: "executive_report",
  COPY_FILENAME: "copy_filename",
};

/**
 * Resolve a workspace DB document to a mention chip object.
 * @param {object[]} workspaceDocuments
 * @param {string} docpath
 */
export function resolveDocumentMention(workspaceDocuments = [], docpath = "") {
  return resolveDocumentMentionModel(workspaceDocuments, docpath);
}

/**
 * @param {object} detail
 */
export function dispatchDocumentContextAction(detail) {
  window.dispatchEvent(
    new CustomEvent(DOCUMENT_CONTEXT_ACTION_EVENT, { detail })
  );
}

export function stashPendingDocumentContext(payload) {
  sessionStorage.setItem(PENDING_DOCUMENT_CONTEXT, JSON.stringify(payload));
}

export function consumePendingDocumentContext() {
  const raw = sessionStorage.getItem(PENDING_DOCUMENT_CONTEXT);
  if (!raw) return null;
  sessionStorage.removeItem(PENDING_DOCUMENT_CONTEXT);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function focusPromptInput() {
  window.dispatchEvent(new CustomEvent(FOCUS_PROMPT_INPUT_EVENT));
}

export function openDocumentMentionPicker() {
  window.dispatchEvent(new CustomEvent(OPEN_DOCUMENT_MENTION_PICKER_EVENT));
}

/**
 * @param {string} message
 * @param {boolean} [autoSubmit]
 */
export function setPromptMessage(message, autoSubmit = false) {
  window.dispatchEvent(
    new CustomEvent(SET_PROMPT_MESSAGE_EVENT, {
      detail: { message, autoSubmit },
    })
  );
}

/**
 * Build the full event payload for a document context action.
 * @param {object} params
 * @param {DocumentContextActionType} params.action
 * @param {string} params.workspaceSlug
 * @param {object} params.document
 */
export function buildDocumentContextPayload({ action, workspaceSlug, document }) {
  const base = { action, workspaceSlug, document };
  switch (action) {
    case DocumentContextAction.ASK:
      return base;
    case DocumentContextAction.SUMMARIZE:
      return {
        ...base,
        message: "Summarize this document.",
        autoSubmit: true,
      };
    case DocumentContextAction.COMPARE:
      return {
        ...base,
        message: "Compare these agreements.",
        openPicker: true,
      };
    case DocumentContextAction.EXECUTIVE_REPORT:
      return {
        ...base,
        message: "Generate an executive report for this document.",
        autoSubmit: true,
      };
    default:
      return base;
  }
}

/**
 * Run a document context action (chat-scoped actions dispatch events).
 * @param {object} params
 * @param {DocumentContextActionType} params.action
 * @param {string} params.workspaceSlug
 * @param {object} params.document
 */
export function runDocumentContextAction({ action, workspaceSlug, document }) {
  if (!document?.docId) return;

  if (action === DocumentContextAction.COPY_FILENAME) {
    const text = document.label || document.filename || "";
    if (text) navigator.clipboard?.writeText(text);
    return;
  }

  dispatchDocumentContextAction(
    buildDocumentContextPayload({ action, workspaceSlug, document })
  );
}

export function autoSubmitChatMessage(message, selectedDocumentIds = []) {
  window.dispatchEvent(
    new CustomEvent(AUTO_SUBMIT_CHAT_EVENT, {
      detail: { message, selectedDocumentIds },
    })
  );
}

export function notifyWorkspaceDocumentsChanged(workspaceSlug) {
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_DOCUMENTS_CHANGED_EVENT, {
      detail: { workspaceSlug },
    })
  );
}
