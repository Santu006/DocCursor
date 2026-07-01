import { formatEta } from "./constants";

export default function CompactProgress({
  label = "Processing",
  current = 0,
  total = 0,
  estimatedSecondsRemaining = null,
  detail = null,
  className = "",
}) {
  const pct =
    total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const eta = formatEta(estimatedSecondsRemaining);

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-white/70 light:text-slate-600 truncate">{label}</span>
        <span className="text-white/50 light:text-slate-500 tabular-nums shrink-0">
          {pct}%{eta ? ` · ${eta}` : ""}
        </span>
      </div>
      <div className="h-1 rounded-full bg-white/10 light:bg-slate-200 overflow-hidden">
        <div
          className="h-full rounded-full bg-white/50 light:bg-slate-600 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      {detail && (
        <p className="text-[11px] text-white/45 light:text-slate-500 truncate">{detail}</p>
      )}
    </div>
  );
}
