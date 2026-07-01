import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CircleNotch,
} from "@phosphor-icons/react";
import Sidebar from "@/components/Sidebar";
import WorkspaceReport from "@/models/workspaceReport";
import FolderUpload from "@/models/folderUpload";
import paths from "@/utils/paths";
import { isMobile } from "react-device-detect";
import CollapsibleSection from "@/components/lib/MinimalUI/CollapsibleSection";
import CompactError from "@/components/lib/MinimalUI/CompactError";

function KpiCard({ label, value, tone = "default" }) {
  const tones = {
    default: "text-white light:text-slate-900",
    high: "text-red-400",
    medium: "text-amber-400",
    low: "text-emerald-400",
  };

  return (
    <div className="rounded-lg border border-white/8 light:border-slate-200 bg-theme-bg-primary/50 px-3 py-2.5">
      <p className="text-[10px] text-white/45 light:text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-semibold mt-0.5 tabular-nums ${tones[tone] || tones.default}`}>
        {value}
      </p>
    </div>
  );
}

function SeverityBadge({ severity }) {
  const tone =
    severity === "HIGH"
      ? "bg-red-500/15 text-red-300"
      : severity === "MEDIUM"
        ? "bg-amber-500/15 text-amber-300"
        : "bg-white/8 text-white/60";

  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>
      {severity}
    </span>
  );
}

export default function ExecutiveReportPage() {
  const { slug } = useParams();
  const [report, setReport] = useState(null);
  const [indexStatus, setIndexStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      const [result, statusResult] = await Promise.all([
        WorkspaceReport.executive(slug),
        FolderUpload.getIndexStatus(slug),
      ]);
      if (result.error || !result.report) {
        setError(result.error || "Unable to load report.");
        setReport(null);
      } else {
        setReport(result.report);
      }
      if (statusResult.success) {
        setIndexStatus(statusResult.status);
      }
      setLoading(false);
    }
    if (slug) load();
  }, [slug]);

  const kpis = report?.executiveSummary?.kpis;

  return (
    <div className="w-screen h-screen overflow-hidden bg-theme-bg-container flex">
      {!isMobile && <Sidebar />}
      <div
        style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
        className="relative md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-[16px] bg-theme-bg-secondary w-full h-full overflow-y-auto"
      >
        <div className="p-6 md:p-8 max-w-5xl mx-auto">
          <div className="flex items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-lg font-medium text-white light:text-slate-900">Executive Report</h1>
              <p className="text-xs text-white/45 light:text-slate-500 mt-1">Workspace metrics and risk overview</p>
            </div>
            <Link
              to={paths.workspace.chat(slug)}
              className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white light:text-slate-500 light:hover:text-slate-900 transition-colors"
            >
              <ArrowLeft size={14} />
              Back
            </Link>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-white/50 text-sm">
              <CircleNotch className="animate-spin" size={16} />
              Loading…
            </div>
          ) : error ? (
            <CompactError message={error} onRetry={() => window.location.reload()} />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                <KpiCard label="Documents" value={indexStatus?.documents ?? kpis?.documents ?? 0} />
                <KpiCard label="Indexed" value={`${indexStatus?.indexedPercent ?? 0}%`} />
                <KpiCard label="Categories" value={indexStatus?.graph?.categoryCount ?? kpis?.categories ?? 0} />
                <KpiCard label="Topics" value={indexStatus?.graph?.topicCount ?? kpis?.topics ?? 0} />
                <KpiCard label="Clusters" value={indexStatus?.graph?.clusterCount ?? kpis?.clusters ?? 0} />
                <KpiCard
                  label="High risk"
                  value={kpis?.highRiskDocuments ?? 0}
                  tone={(kpis?.highRiskDocuments ?? 0) > 0 ? "high" : "low"}
                />
              </div>

              {report.executiveSummary?.summary && (
                <CollapsibleSection title="Summary" defaultOpen={true}>
                  <p className="text-sm text-white/75 light:text-slate-700 leading-relaxed">
                    {report.executiveSummary.summary}
                  </p>
                </CollapsibleSection>
              )}

              {report.topTopics?.length > 0 && (
                <CollapsibleSection
                  title="Top topics"
                  badge={report.topTopics.length}
                  subtitle={report.topTopics[0]?.topic}
                >
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {report.topTopics.slice(0, 12).map((topic) => (
                      <div
                        key={topic.topicKey || topic.topic}
                        className="flex justify-between gap-2 text-sm py-1.5 border-b border-white/5 last:border-0"
                      >
                        <span className="text-white/80 light:text-slate-800 truncate">{topic.topic}</span>
                        <span className="text-white/40 text-xs shrink-0">
                          {topic.documentCount ?? topic.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </CollapsibleSection>
              )}

              {report.categoryDistribution?.length > 0 && (
                <CollapsibleSection
                  title="Categories"
                  badge={report.categoryDistribution.length}
                >
                  <div className="space-y-1">
                    {report.categoryDistribution.map((item) => (
                      <div key={item.key} className="flex justify-between text-sm py-1">
                        <span className="text-white/75 light:text-slate-700">{item.label}</span>
                        <span className="text-white/45 tabular-nums">{item.percentage}%</span>
                      </div>
                    ))}
                  </div>
                </CollapsibleSection>
              )}

              {report.fileTypeDistribution?.length > 0 && (
                <CollapsibleSection title="File types" badge={report.fileTypeDistribution.length}>
                  <div className="space-y-1">
                    {report.fileTypeDistribution.map((item) => (
                      <div key={item.key} className="flex justify-between text-sm py-1">
                        <span className="text-white/75 light:text-slate-700">{item.label}</span>
                        <span className="text-white/45 tabular-nums">{item.percentage}%</span>
                      </div>
                    ))}
                  </div>
                </CollapsibleSection>
              )}

              {report.riskTable?.length > 0 && (
                <CollapsibleSection
                  title="Risk indicators"
                  badge={report.riskTable.length}
                  defaultOpen={(kpis?.highRiskDocuments ?? 0) > 0}
                >
                  <div className="overflow-x-auto -mx-1">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="text-white/40 text-left">
                          <th className="py-2 pr-3 font-medium">Document</th>
                          <th className="py-2 pr-3 font-medium">Reason</th>
                          <th className="py-2 font-medium">Severity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.riskTable.map((row) => (
                          <tr key={row.id} className="border-t border-white/5">
                            <td className="py-2 pr-3 text-white/80">{row.document}</td>
                            <td className="py-2 pr-3 text-white/55">{row.riskReason}</td>
                            <td className="py-2">
                              <SeverityBadge severity={row.severity} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CollapsibleSection>
              )}

              {report.reviewOrder?.length > 0 && (
                <CollapsibleSection title="Review order" badge={report.reviewOrder.length}>
                  <ol className="space-y-1 text-sm">
                    {report.reviewOrder.map((item) => (
                      <li key={item.rank} className="flex justify-between gap-2 py-1">
                        <span className="text-white/80">{item.rank}. {item.document}</span>
                        <span className="text-white/40 text-xs">Score {item.riskScore}</span>
                      </li>
                    ))}
                  </ol>
                </CollapsibleSection>
              )}

              {report.clusters?.length > 0 && (
                <CollapsibleSection title="Clusters" badge={report.clusters.length}>
                  <div className="space-y-2">
                    {report.clusters.map((cluster) => (
                      <div key={cluster.id} className="text-sm border-b border-white/5 pb-2 last:border-0">
                        <p className="font-medium text-white/85">{cluster.label}</p>
                        <p className="text-xs text-white/45 mt-0.5">
                          {cluster.documentCount} docs
                          {cluster.confidence != null ? ` · ${cluster.confidence}% confidence` : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                </CollapsibleSection>
              )}

              {report.duplicates?.length > 0 && (
                <CollapsibleSection title="Duplicates" badge={report.duplicates.length}>
                  <ul className="space-y-1 text-sm text-white/70">
                    {report.duplicates.map((pair) => (
                      <li key={`${pair.source}-${pair.target}`}>
                        {pair.titles?.[0]} ↔ {pair.titles?.[1]}
                        <span className="text-amber-300/70 ml-1 text-xs">
                          {Math.round((pair.similarityScore || 0) * 100)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </CollapsibleSection>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
