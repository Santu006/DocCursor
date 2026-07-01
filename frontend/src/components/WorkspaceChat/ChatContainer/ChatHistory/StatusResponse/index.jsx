import React, { useState } from "react";
import { CaretRight } from "@phosphor-icons/react";
import { shortenStatusMessage } from "@/components/lib/MinimalUI/constants";

export default function StatusResponse({ messages = [], isThinking = false }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const currentThought = messages[messages.length - 1];
  const previousThoughts = messages.slice(0, -1);
  const summary = shortenStatusMessage(currentThought?.content);
  const hasHistory = previousThoughts.length > 0;

  if (!summary && !isThinking) return null;

  return (
    <div className="flex justify-start w-full py-1">
      <div className="w-full">
        <button
          type="button"
          onClick={() => hasHistory && setIsExpanded((v) => !v)}
          className={`w-full flex items-center gap-2 text-left border-none bg-transparent px-0 py-1 ${
            hasHistory ? "cursor-pointer" : "cursor-default"
          }`}
        >
          {isThinking && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/40 animate-pulse shrink-0" />
          )}
          <span className="text-xs text-white/45 light:text-slate-500 truncate flex-1">
            {isThinking && !summary ? "Working…" : summary}
          </span>
          {hasHistory && (
            <CaretRight
              size={12}
              className={`shrink-0 text-white/30 transition-transform ${isExpanded ? "rotate-90" : ""}`}
            />
          )}
        </button>
        {isExpanded && hasHistory && (
          <div className="mt-1 pl-3 border-l border-white/10 space-y-1">
            {previousThoughts.map((thought, index) => (
              <p
                key={`cot-${thought.uuid || index}`}
                className="text-[11px] text-white/40 light:text-slate-500 font-mono leading-snug"
              >
                {shortenStatusMessage(thought.content)}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
