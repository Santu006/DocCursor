import { useCallback, useRef, useState } from "react";
import showToast from "@/utils/toast";
import {
  isContextDragEvent,
  readContextDragData,
  resolveContextDragItems,
} from "@/utils/documentContextDrag";
import { useDocumentMention } from "./context";

/**
 * Drop target for sidebar document context → mention chips.
 * @param {{ workspaceSlug?: string|null, children: import('react').ReactNode, className?: string }} props
 */
export default function DocumentContextDropZone({
  workspaceSlug = null,
  children,
  className = "",
}) {
  const { documents, addDocuments, focusAfterDrop } = useDocumentMention();
  const [isOver, setIsOver] = useState(false);
  const depthRef = useRef(0);

  const handleDragEnter = useCallback(
    (event) => {
      if (!isContextDragEvent(event.dataTransfer)) return;
      event.preventDefault();
      depthRef.current += 1;
      setIsOver(true);
    },
    []
  );

  const handleDragLeave = useCallback((event) => {
    if (!isContextDragEvent(event.dataTransfer)) return;
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setIsOver(false);
  }, []);

  const handleDragOver = useCallback((event) => {
    if (!isContextDragEvent(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsOver(true);
  }, []);

  const handleDrop = useCallback(
    (event) => {
      if (!isContextDragEvent(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      depthRef.current = 0;
      setIsOver(false);

      const payload = readContextDragData(event.dataTransfer);
      if (!payload) return;

      if (
        workspaceSlug &&
        payload.workspaceSlug &&
        payload.workspaceSlug !== workspaceSlug
      ) {
        showToast(
          "Drop documents from the current workspace into chat.",
          "warning",
          { clear: true }
        );
        return;
      }

      const mentions = resolveContextDragItems(payload, documents);
      if (!mentions.length) {
        showToast("Could not add those documents as context.", "error", {
          clear: true,
        });
        return;
      }

      const added = addDocuments(mentions);
      if (added.length > 0) {
        focusAfterDrop?.();
      }
    },
    [workspaceSlug, documents, addDocuments, focusAfterDrop]
  );

  return (
    <div
      className={`relative ${className}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isOver && (
        <div className="pointer-events-none absolute inset-0 z-20 rounded-[20px] border-2 border-dashed border-sky-400/80 bg-sky-500/10 light:border-sky-500 light:bg-sky-50/80 flex items-center justify-center">
          <p className="text-xs font-medium text-sky-200 light:text-sky-700 px-4 text-center">
            Drop document here to add as context
          </p>
        </div>
      )}
      {children}
    </div>
  );
}
