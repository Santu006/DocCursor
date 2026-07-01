import { useEffect, useMemo, useRef, useState } from "react";
import { FilePdf } from "@phosphor-icons/react";
import { filterMentionDocuments, highlightMatch } from "./utils";
import { useDocumentMention } from "./context";

export const DOCUMENT_MENTION_KEYBOARD_EVENT = "document-mention-keyboard";

export default function DocumentMentionPicker({
  open = false,
  query = "",
  onSelect,
  highlightedIndexRef,
}) {
  const { documents, selectedDocuments } = useDocumentMention();
  const [highlightIndex, setHighlightIndex] = useState(0);
  const highlightIndexRef = useRef(0);

  const selectedIds = useMemo(
    () => selectedDocuments.map((doc) => doc.docId),
    [selectedDocuments]
  );

  const results = useMemo(
    () => filterMentionDocuments(documents, query, selectedIds),
    [documents, query, selectedIds]
  );

  useEffect(() => {
    setHighlightIndex(0);
    highlightIndexRef.current = 0;
  }, [query, open]);

  useEffect(() => {
    highlightIndexRef.current = highlightIndex;
    if (highlightedIndexRef) highlightedIndexRef.current = highlightIndex;
  }, [highlightIndex, highlightedIndexRef]);

  useEffect(() => {
    if (!open) return;
    function onKeyboard(event) {
      const { key } = event.detail || {};
      if (key === "ArrowDown") {
        setHighlightIndex((i) => {
          const next = Math.min(i + 1, Math.max(results.length - 1, 0));
          highlightIndexRef.current = next;
          return next;
        });
      } else if (key === "ArrowUp") {
        setHighlightIndex((i) => {
          const next = Math.max(i - 1, 0);
          highlightIndexRef.current = next;
          return next;
        });
      } else if (key === "Enter") {
        const doc = results[highlightIndexRef.current];
        if (doc) onSelect?.(doc);
      }
    }
    window.addEventListener(DOCUMENT_MENTION_KEYBOARD_EVENT, onKeyboard);
    return () =>
      window.removeEventListener(DOCUMENT_MENTION_KEYBOARD_EVENT, onKeyboard);
  }, [open, results, onSelect]);

  if (!open) return null;

  return (
    <div className="absolute left-0 right-0 bottom-full mb-2 z-50">
      <div className="rounded-lg border border-white/10 light:border-slate-200 bg-zinc-900 light:bg-white shadow-lg overflow-hidden max-h-56 overflow-y-auto">
        {results.length === 0 ? (
          <p className="px-3 py-2 text-xs text-white/45 light:text-slate-500">
            No documents match
          </p>
        ) : (
          results.map((doc, index) => (
            <button
              key={doc.docId}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect?.(doc);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left border-none cursor-pointer ${
                index === highlightIndex
                  ? "bg-white/10 light:bg-slate-100"
                  : "bg-transparent hover:bg-white/5 light:hover:bg-slate-50"
              }`}
            >
              <FilePdf size={16} className="text-red-400 shrink-0" weight="fill" />
              <span className="text-sm text-white/85 light:text-slate-800 truncate">
                {highlightMatch(doc.label, query).map((part, i) =>
                  part.match ? (
                    <mark
                      key={i}
                      className="bg-yellow-500/30 text-inherit rounded px-0.5"
                    >
                      {part.text}
                    </mark>
                  ) : (
                    <span key={i}>{part.text}</span>
                  )
                )}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
