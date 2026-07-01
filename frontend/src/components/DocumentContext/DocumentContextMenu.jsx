import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Briefcase,
  ChatCircle,
  Copy,
  FileText,
  Scales,
} from "@phosphor-icons/react";
import paths from "@/utils/paths";
import {
  DocumentContextAction,
  buildDocumentContextPayload,
  dispatchDocumentContextAction,
  runDocumentContextAction,
  stashPendingDocumentContext,
} from "@/utils/documentContext";

const MENU_ITEMS = [
  {
    action: DocumentContextAction.ASK,
    label: "Ask about this document",
    Icon: ChatCircle,
  },
  {
    action: DocumentContextAction.SUMMARIZE,
    label: "Summarize",
    Icon: FileText,
  },
  {
    action: DocumentContextAction.COMPARE,
    label: "Compare…",
    Icon: Scales,
  },
  {
    action: DocumentContextAction.EXECUTIVE_REPORT,
    label: "Executive Report",
    Icon: Briefcase,
  },
  {
    action: DocumentContextAction.COPY_FILENAME,
    label: "Copy filename",
    Icon: Copy,
  },
];

/**
 * Cursor-style right-click menu for workspace documents.
 */
export default function DocumentContextMenu({
  visible = false,
  x = 0,
  y = 0,
  document = null,
  workspaceSlug = null,
  onClose,
}) {
  const menuRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!visible) return;
    function handlePointerDown(event) {
      if (menuRef.current?.contains(event.target)) return;
      onClose?.();
    }
    function handleEscape(event) {
      if (event.key === "Escape") onClose?.();
    }
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [visible, onClose]);

  if (!visible || !document?.docId || !workspaceSlug) return null;

  function isOnWorkspaceChat() {
    return location.pathname.startsWith(`/workspace/${workspaceSlug}`);
  }

  function handleSelect(action) {
    if (action === DocumentContextAction.COPY_FILENAME) {
      runDocumentContextAction({ action, workspaceSlug, document });
      onClose?.();
      return;
    }

    const payload = buildDocumentContextPayload({
      action,
      workspaceSlug,
      document,
    });

    if (!isOnWorkspaceChat()) {
      stashPendingDocumentContext(payload);
      navigate(paths.workspace.chat(workspaceSlug));
    } else {
      dispatchDocumentContextAction(payload);
    }
    onClose?.();
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-[10000] min-w-[210px] rounded-lg border border-white/10 light:border-slate-200 bg-zinc-900 light:bg-white shadow-xl py-1"
      style={{ top: y, left: x }}
      role="menu"
    >
      {MENU_ITEMS.map(({ action, label, Icon }) => (
        <button
          key={action}
          type="button"
          role="menuitem"
          onClick={() => handleSelect(action)}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-left border-none bg-transparent cursor-pointer text-sm text-white/85 light:text-slate-800 hover:bg-white/8 light:hover:bg-slate-100"
        >
          <Icon size={16} className="shrink-0 text-white/50 light:text-slate-500" />
          {label}
        </button>
      ))}
    </div>
  );
}
