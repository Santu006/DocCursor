import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import Workspace from "@/models/workspace";
import { mapWorkspaceDocuments } from "./utils";
import {
  DOCUMENT_CONTEXT_ACTION_EVENT,
  DocumentContextAction,
  WORKSPACE_DOCUMENTS_CHANGED_EVENT,
  autoSubmitChatMessage,
  focusPromptInput,
  openDocumentMentionPicker,
  setPromptMessage,
} from "@/utils/documentContext";

const UNAVAILABLE_CHIP_MS = 2500;

const DocumentMentionContext = createContext(null);

export function DocumentMentionProvider({ workspaceSlug, children }) {
  const [documents, setDocuments] = useState([]);
  const [selectedDocuments, setSelectedDocuments] = useState([]);

  const refreshDocuments = useCallback(async () => {
    if (!workspaceSlug) {
      setDocuments([]);
      return [];
    }
    const workspace = await Workspace.bySlug(workspaceSlug);
    const mapped = mapWorkspaceDocuments(workspace?.documents || []);
    setDocuments(mapped);
    return mapped;
  }, [workspaceSlug]);

  useEffect(() => {
    let cancelled = false;
    refreshDocuments().then((mapped) => {
      if (cancelled || !mapped) return;
    });
    return () => {
      cancelled = true;
    };
  }, [refreshDocuments]);

  // Mark chips unavailable when their document is removed from the workspace.
  useEffect(() => {
    if (documents.length === 0 && selectedDocuments.length === 0) return;
    const validIds = new Set(documents.map((doc) => doc.docId));
    setSelectedDocuments((prev) => {
      let changed = false;
      const next = prev.map((doc) => {
        if (validIds.has(doc.docId) || doc.unavailable) return doc;
        changed = true;
        return { ...doc, unavailable: true };
      });
      return changed ? next : prev;
    });
  }, [documents, selectedDocuments.length]);

  // Auto-remove unavailable chips after a short notice.
  useEffect(() => {
    const hasUnavailable = selectedDocuments.some((doc) => doc.unavailable);
    if (!hasUnavailable) return;
    const timer = setTimeout(() => {
      setSelectedDocuments((prev) => prev.filter((doc) => !doc.unavailable));
    }, UNAVAILABLE_CHIP_MS);
    return () => clearTimeout(timer);
  }, [selectedDocuments]);

  const addDocument = useCallback((doc) => {
    if (!doc?.docId || doc.unavailable) return false;
    let added = false;
    setSelectedDocuments((prev) => {
      if (prev.some((item) => item.docId === doc.docId)) return prev;
      added = true;
      return [
        ...prev,
        {
          ...doc,
          mentionType: doc.mentionType || "document",
          animateIn: true,
        },
      ];
    });
    return added;
  }, []);

  const addDocuments = useCallback(
    (docs = []) => {
      const valid = (docs || []).filter((doc) => doc?.docId && !doc.unavailable);
      if (!valid.length) return [];

      const addedIds = [];
      setSelectedDocuments((prev) => {
        const next = [...prev];
        for (const doc of valid) {
          if (next.some((item) => item.docId === doc.docId)) continue;
          addedIds.push(doc.docId);
          next.push({
            ...doc,
            mentionType: doc.mentionType || "document",
            animateIn: true,
          });
        }
        return addedIds.length ? next : prev;
      });
      return addedIds;
    },
    []
  );

  const focusAfterDrop = useCallback(() => {
    focusPromptInput();
  }, []);

  const removeDocument = useCallback((docId) => {
    setSelectedDocuments((prev) => prev.filter((doc) => doc.docId !== docId));
  }, []);

  const clearDocuments = useCallback(() => {
    setSelectedDocuments([]);
  }, []);

  const applyDocumentContextAction = useCallback(
    (detail) => {
      const { action, workspaceSlug: slug, document, message, autoSubmit, openPicker } =
        detail || {};
      if (!document?.docId || slug !== workspaceSlug) return;

      addDocument(document);

      switch (action) {
        case DocumentContextAction.ASK:
          focusPromptInput();
          break;
        case DocumentContextAction.SUMMARIZE:
        case DocumentContextAction.EXECUTIVE_REPORT:
          if (message && autoSubmit) {
            autoSubmitChatMessage(message, [document.docId]);
          } else if (message) {
            setPromptMessage(message, false);
          }
          break;
        case DocumentContextAction.COMPARE:
          if (message) setPromptMessage(message, false);
          if (openPicker) openDocumentMentionPicker();
          focusPromptInput();
          break;
        default:
          break;
      }
    },
    [workspaceSlug, addDocument]
  );

  useEffect(() => {
    function onDocumentContextAction(event) {
      applyDocumentContextAction(event.detail);
    }
    function onDocumentsChanged(event) {
      if (event.detail?.workspaceSlug === workspaceSlug) {
        refreshDocuments();
      }
    }
    window.addEventListener(DOCUMENT_CONTEXT_ACTION_EVENT, onDocumentContextAction);
    window.addEventListener(
      WORKSPACE_DOCUMENTS_CHANGED_EVENT,
      onDocumentsChanged
    );
    return () => {
      window.removeEventListener(
        DOCUMENT_CONTEXT_ACTION_EVENT,
        onDocumentContextAction
      );
      window.removeEventListener(
        WORKSPACE_DOCUMENTS_CHANGED_EVENT,
        onDocumentsChanged
      );
    };
  }, [applyDocumentContextAction, refreshDocuments, workspaceSlug]);

  const selectedDocumentIds = useMemo(
    () =>
      selectedDocuments
        .filter((doc) => !doc.unavailable)
        .map((doc) => doc.docId),
    [selectedDocuments]
  );

  const value = useMemo(
    () => ({
      documents,
      selectedDocuments,
      selectedDocumentIds,
      addDocument,
      addDocuments,
      removeDocument,
      clearDocuments,
      focusAfterDrop,
      refreshDocuments,
      applyDocumentContextAction,
    }),
    [
      documents,
      selectedDocuments,
      selectedDocumentIds,
      addDocument,
      addDocuments,
      removeDocument,
      clearDocuments,
      focusAfterDrop,
      refreshDocuments,
      applyDocumentContextAction,
    ]
  );

  return (
    <DocumentMentionContext.Provider value={value}>
      {children}
    </DocumentMentionContext.Provider>
  );
}

export function useDocumentMention() {
  const ctx = useContext(DocumentMentionContext);
  if (!ctx) {
    return {
      documents: [],
      selectedDocuments: [],
      selectedDocumentIds: [],
      addDocument: () => false,
      addDocuments: () => [],
      removeDocument: () => {},
      clearDocuments: () => {},
      focusAfterDrop: () => {},
      refreshDocuments: async () => [],
      applyDocumentContextAction: () => {},
    };
  }
  return ctx;
}
