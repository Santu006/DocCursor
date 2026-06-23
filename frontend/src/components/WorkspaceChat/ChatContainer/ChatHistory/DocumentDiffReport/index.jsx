import { useState } from "react";
import { Link } from "react-router-dom";
import {
  CaretDown,
  CaretUp,
  DownloadSimple,
  ShareNetwork,
} from "@phosphor-icons/react";
import Reviews from "@/models/reviews";
import paths from "@/utils/paths";
import showToast from "@/utils/toast";

function SeverityBadge({ severity = "LOW" }) {
  const colors = {
    HIGH: "bg-red-500/20 text-red-300 border-red-500/30",
    MEDIUM: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    LOW: "bg-green-500/20 text-green-300 border-green-500/30",
  };

  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${colors[severity] || colors.LOW}`}
    >
      {severity}
    </span>
  );
}

function RiskScoreBadge({ score }) {
  if (score == null) return null;
  const tone =
    score >= 75 ? "text-red-300" : score >= 45 ? "text-yellow-300" : "text-green-300";

  return (
    <div className="rounded-lg bg-black/25 px-3 py-2 text-center min-w-[88px]">
      <div className={`text-lg font-bold ${tone}`}>{score}</div>
      <div className="text-[10px] uppercase tracking-wide text-white/45">Risk Score</div>
    </div>
  );
}

function EvidenceBlock({ evidence = [], confidence = null }) {
  const [open, setOpen] = useState(false);
  const items = evidence?.length
    ? evidence
    : confidence != null
      ? [{ confidence }]
      : [];

  if (!items.length) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="text-[11px] font-medium text-blue-300 hover:text-blue-200"
      >
        {open ? "Hide Evidence" : "View Evidence"}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {items.map((item, index) => {
            const score = item.similarityScore ?? item.confidence ?? confidence;
            return (
              <div
                key={`${item.documentName || "evidence"}-${index}`}
                className="rounded border border-white/10 bg-black/15 px-2.5 py-2 text-[11px] text-white/70"
              >
                {item.documentName && (
                  <div>
                    <span className="text-white/45">Document:</span>{" "}
                    {item.documentName}
                  </div>
                )}
                {item.sectionTitle && (
                  <div>
                    <span className="text-white/45">Section:</span>{" "}
                    {item.sectionTitle}
                  </div>
                )}
                {item.pageNumber != null && (
                  <div>
                    <span className="text-white/45">Page:</span> {item.pageNumber}
                  </div>
                )}
                {score != null && (
                  <div>
                    <span className="text-white/45">Confidence:</span>{" "}
                    {Math.round(score * 100)}%
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ClauseList({
  title,
  items,
  emptyText,
  prefix = "",
  showPreviousNext = false,
}) {
  if (!items?.length) {
    return (
      <section className="mb-4">
        <h4 className="text-white text-sm font-semibold mb-2">{title}</h4>
        <p className="text-white/50 text-xs italic">{emptyText}</p>
      </section>
    );
  }

  return (
    <section className="mb-4">
      <h4 className="text-white text-sm font-semibold mb-2">{title}</h4>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li
            key={`${title}-${index}`}
            className="rounded-lg bg-theme-settings-input-bg px-3 py-2 text-white/80 text-xs"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium text-white">
                {prefix && <span className="text-white/50 mr-1">{prefix}</span>}
                {item.summary || item.title || item.section || item}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {item.confidence != null && (
                  <span className="text-[10px] text-white/40">
                    {Math.round(item.confidence * 100)}%
                  </span>
                )}
                {item.severity && <SeverityBadge severity={item.severity} />}
              </div>
            </div>

            {item.description &&
              item.description !== (item.summary || item.title) && (
                <p className="mt-1 text-white/55">{item.description}</p>
              )}

            {showPreviousNext && (item.before || item.after) && (
              <div className="mt-2 space-y-1 text-white/60">
                {item.before && (
                  <p>
                    <span className="text-white/40">Previous:</span> {truncate(item.before)}
                  </p>
                )}
                {item.after && (
                  <p>
                    <span className="text-white/40">New:</span> {truncate(item.after)}
                  </p>
                )}
              </div>
            )}

            {item.financialImpact &&
              !/not specified/i.test(
                `${item.financialImpact.previous} ${item.financialImpact.next}`
              ) && (
                <p className="mt-1 text-white/60">
                  Previous: {item.financialImpact.previous} → New:{" "}
                  {item.financialImpact.next}
                </p>
              )}

            <EvidenceBlock
              evidence={item.evidence}
              confidence={item.confidence}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function truncate(text = "", max = 180) {
  const value = String(text).replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function ReviewActions({ reviewId, workspaceSlug, readOnly = false }) {
  const [sharing, setSharing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  if (readOnly || !reviewId || !workspaceSlug) return null;

  async function handleExport(type) {
    try {
      const { blob, filename } = await Reviews.export(workspaceSlug, {
        reviewId,
        type,
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setMenuOpen(false);
    } catch (e) {
      showToast("Export failed", "error");
    }
  }

  async function handleShare() {
    setSharing(true);
    const data = await Reviews.share(workspaceSlug, reviewId);
    setSharing(false);
    if (!data?.sharePath) {
      showToast("Could not create share link", "error");
      return;
    }
    const url = `${window.location.origin}${data.sharePath}`;
    await navigator.clipboard.writeText(url);
    showToast("Share link copied to clipboard", "success");
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <Link
        to={paths.workspace.review(workspaceSlug, reviewId)}
        className="text-xs text-sky-300 hover:text-sky-200"
      >
        Open saved review
      </Link>
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-white/80 hover:text-white"
        >
          <DownloadSimple size={14} />
          Export
        </button>
        {menuOpen && (
          <div className="absolute z-10 mt-1 min-w-[140px] rounded-lg border border-white/10 bg-zinc-900 p-1 shadow-lg">
            {["pdf", "docx", "markdown"].map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => handleExport(type)}
                className="block w-full text-left px-2 py-1.5 text-xs text-white/80 hover:bg-white/5 rounded"
              >
                Export {type.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={handleShare}
        disabled={sharing}
        className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-white/80 hover:text-white disabled:opacity-50"
      >
        <ShareNetwork size={14} />
        {sharing ? "Sharing…" : "Copy Share Link"}
      </button>
    </div>
  );
}

export default function DocumentDiffReport({
  report,
  reviewId = null,
  workspaceSlug = null,
  readOnly = false,
  title = null,
}) {
  const [showRawDiff, setShowRawDiff] = useState(false);

  if (!report) return null;

  const rawDiff = report.rawGitStyleDiff || report.gitStyleDiff;

  return (
    <div className="my-3 rounded-xl border border-white/10 bg-theme-bg-secondary p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-white text-sm font-bold">
            {title || "Document Comparison Report"}
          </h3>
          <p className="text-white/50 text-xs mt-1">
            AI-powered legal contract review
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RiskScoreBadge score={report.riskScore} />
          {report.overallChangeLevel && (
            <SeverityBadge severity={report.overallChangeLevel} />
          )}
        </div>
      </div>

      <ReviewActions
        reviewId={reviewId}
        workspaceSlug={workspaceSlug}
        readOnly={readOnly}
      />

      <section className="mb-4">
        <h4 className="text-white text-sm font-semibold mb-2">1. Executive Summary</h4>
        <p className="text-white/80 text-xs leading-relaxed">
          {report.executiveSummary || report.summary}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {report.financialImpactLevel && (
            <div className="rounded-lg bg-black/20 px-2 py-1 text-[11px] text-white/70">
              Financial Impact:{" "}
              <SeverityBadge severity={report.financialImpactLevel} />
            </div>
          )}
          {report.legalRiskLevel && (
            <div className="rounded-lg bg-black/20 px-2 py-1 text-[11px] text-white/70">
              Legal Risk: <SeverityBadge severity={report.legalRiskLevel} />
            </div>
          )}
        </div>

        {report.keyChanges?.length > 0 && (
          <ul className="mt-3 space-y-1">
            {report.keyChanges.map((change, index) => (
              <li key={index} className="text-white/70 text-xs">
                • {change}
              </li>
            ))}
          </ul>
        )}

        {report.businessImpact && (
          <p className="text-white/60 text-xs mt-2">
            <span className="font-medium text-white/80">Business impact:</span>{" "}
            {report.businessImpact}
          </p>
        )}
        {report.legalImpact && (
          <p className="text-white/60 text-xs mt-2">
            <span className="font-medium text-white/80">Legal impact:</span>{" "}
            {report.legalImpact}
          </p>
        )}
      </section>

      <ClauseList
        title="2. Added Clauses"
        items={report.added}
        emptyText="No added clauses detected."
        prefix="+"
      />
      <ClauseList
        title="3. Removed Clauses"
        items={report.removed}
        emptyText="No removed clauses detected."
        prefix="-"
      />
      <ClauseList
        title="4. Modified Clauses"
        items={report.modified}
        emptyText="No modified clauses detected."
        prefix="~"
        showPreviousNext
      />

      <ClauseList
        title="5. Financial Impact"
        items={report.financialChanges}
        emptyText="No payment or billing changes detected."
      />
      <ClauseList
        title="6. Legal Risk Analysis"
        items={report.riskChanges}
        emptyText="No significant legal risk changes detected."
      />
      <ClauseList
        title="7. Operational Impact"
        items={report.operationalChanges}
        emptyText="No operational changes detected."
      />

      {rawDiff && (
        <section className="mt-2">
          <button
            type="button"
            onClick={() => setShowRawDiff((prev) => !prev)}
            className="flex items-center gap-1 text-white/70 text-xs hover:text-white transition-colors"
          >
            {showRawDiff ? <CaretUp size={14} /> : <CaretDown size={14} />}
            Show Raw Diff
          </button>
          {showRawDiff && (
            <pre className="mt-2 overflow-x-auto rounded-lg bg-black/30 p-3 text-[11px] leading-5">
              {rawDiff.split("\n").map((line, index) => (
                <div
                  key={index}
                  className={
                    line.startsWith("+")
                      ? "text-green-300"
                      : line.startsWith("-")
                        ? "text-red-300"
                        : line.startsWith("~")
                          ? "text-yellow-300"
                          : "text-white/70"
                  }
                >
                  {line}
                </div>
              ))}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}
