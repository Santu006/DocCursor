import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";
import { shortenError } from "./constants";

export default function CompactError({ message, onRetry = null }) {
  const text = shortenError(message);

  return (
    <div className="flex items-center gap-2 py-2 text-sm text-red-400/90 light:text-red-600">
      <WarningCircle size={16} className="shrink-0" />
      <span className="flex-1 min-w-0 truncate">{text}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 shrink-0 text-xs font-medium text-white/70 light:text-slate-600 hover:text-white light:hover:text-slate-900 border border-white/15 light:border-slate-300 rounded-md px-2 py-1 bg-transparent cursor-pointer transition-colors"
        >
          <ArrowClockwise size={12} />
          Retry
        </button>
      )}
    </div>
  );
}
