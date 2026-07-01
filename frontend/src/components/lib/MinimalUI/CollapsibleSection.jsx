import { useState } from "react";
import { CaretRight } from "@phosphor-icons/react";

export default function CollapsibleSection({
  title,
  subtitle = null,
  defaultOpen = false,
  badge = null,
  children,
  className = "",
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`rounded-lg border border-white/8 light:border-slate-200 bg-theme-bg-primary/40 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left border-none bg-transparent cursor-pointer hover:bg-white/5 light:hover:bg-black/5 transition-colors rounded-lg"
      >
        <CaretRight
          size={14}
          weight="bold"
          className={`shrink-0 text-white/40 light:text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white light:text-slate-900">{title}</p>
          {subtitle && !open && (
            <p className="text-xs text-white/45 light:text-slate-500 truncate mt-0.5">{subtitle}</p>
          )}
        </div>
        {badge != null && (
          <span className="text-xs text-white/50 light:text-slate-500 tabular-nums shrink-0">{badge}</span>
        )}
      </button>
      {open && <div className="px-4 pb-4 pt-0">{children}</div>}
    </section>
  );
}
