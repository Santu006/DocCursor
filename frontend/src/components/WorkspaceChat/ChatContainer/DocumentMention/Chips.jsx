import { useEffect, useState } from "react";
import { FilePdf, Folder, Paperclip, Tag, X } from "@phosphor-icons/react";
import { useDocumentMention } from "./context";

function ChipIcon({ mentionType }) {
  switch (mentionType) {
    case "folder":
      return <Folder size={14} className="text-amber-400 shrink-0" weight="fill" />;
    case "category":
    case "tag":
      return <Tag size={14} className="text-sky-400 shrink-0" weight="fill" />;
    case "workspace":
      return <Folder size={14} className="text-violet-400 shrink-0" weight="fill" />;
    default:
      return <FilePdf size={14} className="text-red-400 shrink-0" weight="fill" />;
  }
}

export default function DocumentMentionChips() {
  const { selectedDocuments, removeDocument, clearDocuments } =
    useDocumentMention();
  const [animatingIds, setAnimatingIds] = useState(new Set());

  useEffect(() => {
    const incoming = selectedDocuments
      .filter((doc) => doc.animateIn)
      .map((doc) => doc.docId);
    if (!incoming.length) return;

    setAnimatingIds((prev) => {
      const next = new Set(prev);
      incoming.forEach((id) => next.add(id));
      return next;
    });

    const timer = setTimeout(() => {
      setAnimatingIds((prev) => {
        const next = new Set(prev);
        incoming.forEach((id) => next.delete(id));
        return next;
      });
    }, 220);

    return () => clearTimeout(timer);
  }, [selectedDocuments]);

  if (selectedDocuments.length === 0) return null;

  const activeCount = selectedDocuments.filter((doc) => !doc.unavailable).length;

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-2 pb-1">
      <span className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-white/40 light:text-slate-400 mr-0.5">
        <Paperclip size={12} weight="bold" className="shrink-0" />
        Context
      </span>
      {selectedDocuments.map((doc) => {
        const unavailable = !!doc.unavailable;
        const animateIn = animatingIds.has(doc.docId) || doc.animateIn;
        return (
          <div
            key={doc.docId}
            title={unavailable ? "Document unavailable" : doc.label}
            className={`inline-flex items-center gap-1.5 max-w-[240px] rounded-md border px-2 py-1 transition-all duration-200 ${
              animateIn ? "animate-[chipIn_0.2s_ease-out]" : ""
            } ${
              unavailable
                ? "border-amber-500/30 bg-amber-500/10"
                : "border-primary-button/40 bg-primary-button/10 light:border-blue-300 light:bg-blue-50"
            }`}
          >
            <ChipIcon mentionType={doc.mentionType} />
            <span
              className={`text-xs truncate ${
                unavailable
                  ? "text-amber-300/90 light:text-amber-700 italic"
                  : "text-white/90 light:text-slate-700"
              }`}
            >
              {unavailable ? "Document unavailable" : doc.label}
            </span>
            <button
              type="button"
              onClick={() => removeDocument(doc.docId)}
              className="border-none bg-transparent p-0 cursor-pointer text-white/40 hover:text-white light:text-slate-400 light:hover:text-slate-700 shrink-0"
              aria-label={`Remove ${doc.label}`}
            >
              <X size={12} weight="bold" />
            </button>
          </div>
        );
      })}
      {activeCount > 1 && (
        <button
          type="button"
          onClick={clearDocuments}
          className="inline-flex items-center gap-1 text-[11px] text-white/40 hover:text-white/80 light:text-slate-400 light:hover:text-slate-600 border-none bg-transparent p-0 cursor-pointer ml-0.5"
          aria-label="Clear all selected documents"
        >
          <X size={11} weight="bold" />
          Clear all
        </button>
      )}
    </div>
  );
}
