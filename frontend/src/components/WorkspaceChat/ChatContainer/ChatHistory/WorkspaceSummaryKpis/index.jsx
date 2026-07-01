function KpiCard({ label, value }) {
  return (
    <div className="rounded-lg border border-white/8 light:border-slate-200 bg-theme-bg-primary/50 px-3 py-2.5 min-w-[88px]">
      <p className="text-[10px] text-white/45 light:text-slate-500 uppercase tracking-wide">
        {label}
      </p>
      <p className="text-lg font-semibold mt-0.5 tabular-nums text-white light:text-slate-900">
        {value}
      </p>
    </div>
  );
}

export default function WorkspaceSummaryKpis({ metadata }) {
  if (!metadata) return null;

  const cards = [
    { label: "Documents", value: metadata.documents ?? 0 },
    { label: "Types", value: metadata.documentTypes ?? 0 },
    { label: "Topics", value: metadata.topics ?? 0 },
    { label: "Categories", value: metadata.categories ?? 0 },
    { label: "Duplicates", value: metadata.duplicates ?? 0 },
  ].filter((card) => card.value !== undefined && card.value !== null);

  if (!cards.length) return null;

  return (
    <div className="mb-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
      {cards.map((card) => (
        <KpiCard key={card.label} label={card.label} value={card.value} />
      ))}
    </div>
  );
}
