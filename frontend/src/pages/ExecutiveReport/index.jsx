import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CircleNotch,
  FileText,
  Graph,
  ListNumbers,
  Warning,
} from "@phosphor-icons/react";
import Sidebar from "@/components/Sidebar";
import WorkspaceReport from "@/models/workspaceReport";
import paths from "@/utils/paths";
import { isMobile } from "react-device-detect";

function KpiCard({ label, value, tone = "default" }) {
  const tones = {
    default: "text-white",
    high: "text-red-300",
    medium: "text-yellow-300",
    low: "text-emerald-300",
  };

  return (
    <div className="rounded-xl border border-white/10 bg-theme-bg-primary p-4">
      <p className="text-xs text-white/50 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tones[tone] || tones.default}`}>
        {value}
      </p>
    </div>
  );
}

function SeverityBadge({ severity }) {
  const tone =
    severity === "HIGH"
      ? "bg-red-500/20 text-red-200 border-red-500/30"
      : severity === "MEDIUM"
        ? "bg-yellow-500/20 text-yellow-200 border-yellow-500/30"
        : "bg-white/10 text-white/70 border-white/10";

  return (
    <span className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
      {severity}
    </span>
  );
}

export default function ExecutiveReportPage() {
  const { slug } = useParams();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      const result = await WorkspaceReport.executive(slug);
      if (result.error || !result.report) {
        setError(result.error || "Unable to load executive report.");
        setReport(null);
      } else {
        setReport(result.report);
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
        <div className="p-6 md:p-8 max-w-6xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <Link
              to={paths.workspace.chat(slug)}
              className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm"
            >
              <ArrowLeft size={16} />
              Back to workspace
            </Link>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white">Executive Report</h1>
            <p className="text-white/60 text-sm mt-2 max-w-3xl">
              Workspace intelligence dashboard — metrics, classifications, and
              risk indicators. Factual reporting only; no legal advice.
            </p>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-white/60">
              <CircleNotch className="animate-spin" size={18} />
              Building executive report...
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-200 text-sm">
              {error}
            </div>
          ) : (
            <>
              <section className="mb-8">
                <h2 className="text-lg font-semibold text-white mb-3">
                  Executive Summary
                </h2>
                <div className="rounded-xl border border-white/10 bg-theme-bg-primary p-5">
                  <p className="text-sm text-white/80 leading-relaxed">
                    {report.executiveSummary?.summary}
                  </p>
                </div>
              </section>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
                <KpiCard label="Documents" value={kpis?.documents ?? 0} />
                <KpiCard label="Categories" value={kpis?.categories ?? 0} />
                <KpiCard label="Topics" value={kpis?.topics ?? 0} />
                <KpiCard label="Clusters" value={kpis?.clusters ?? 0} />
                <KpiCard label="Duplicates" value={kpis?.duplicates ?? 0} />
                <KpiCard
                  label="High Risk Docs"
                  value={kpis?.highRiskDocuments ?? 0}
                  tone={(kpis?.highRiskDocuments ?? 0) > 0 ? "high" : "low"}
                />
              </div>

              {report.topTopics?.length > 0 && (
                <section className="mb-8">
                  <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                    <Graph size={18} className="text-white/50" />
                    Top Topics
                  </h2>
                  <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                    {report.topTopics.slice(0, 12).map((topic) => (
                      <div
                        key={topic.topicKey || topic.topic}
                        className="rounded-xl border border-white/10 bg-theme-bg-primary p-4 flex justify-between items-center"
                      >
                        <span className="text-sm text-white">{topic.topic}</span>
                        <span className="text-xs text-white/50">
                          {topic.documentCount ?? topic.count} docs
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {report.categoryDistribution?.length > 0 && (
                <section className="mb-8">
                  <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                    <FileText size={18} className="text-white/50" />
                    Category Distribution
                  </h2>
                  <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                    {report.categoryDistribution.map((item) => (
                      <div
                        key={item.key}
                        className="rounded-xl border border-white/10 bg-theme-bg-primary p-4 flex justify-between"
                      >
                        <div>
                          <p className="text-sm font-medium text-white">{item.label}</p>
                          <p className="text-xs text-white/50">{item.count} documents</p>
                        </div>
                        <p className="text-lg font-bold text-white/80">{item.percentage}%</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {report.fileTypeDistribution?.length > 0 && (
                <section className="mb-8">
                  <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                    <FileText size={18} className="text-white/50" />
                    File Type Distribution
                  </h2>
                  <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                    {report.fileTypeDistribution.map((item) => (
                      <div
                        key={item.key}
                        className="rounded-xl border border-white/10 bg-theme-bg-primary p-4 flex justify-between"
                      >
                        <div>
                          <p className="text-sm font-medium text-white">{item.label}</p>
                          <p className="text-xs text-white/50">{item.count} documents</p>
                        </div>
                        <p className="text-lg font-bold text-white/80">{item.percentage}%</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {report.riskTable?.length > 0 && (
                <section className="mb-8">
                  <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                    <Warning size={18} className="text-yellow-400/80" />
                    Risk Indicators
                  </h2>
                  <div className="overflow-x-auto rounded-xl border border-white/10">
                    <table className="min-w-full text-sm">
                      <thead className="bg-theme-bg-primary text-white/50 text-left">
                        <tr>
                          <th className="px-4 py-3 font-medium">Document</th>
                          <th className="px-4 py-3 font-medium">Risk Reason</th>
                          <th className="px-4 py-3 font-medium">Severity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.riskTable.map((row) => (
                          <tr
                            key={row.id}
                            className="border-t border-white/10 bg-theme-bg-primary/60"
                          >
                            <td className="px-4 py-3 text-white">{row.document}</td>
                            <td className="px-4 py-3 text-white/70">{row.riskReason}</td>
                            <td className="px-4 py-3">
                              <SeverityBadge severity={row.severity} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {report.reviewOrder?.length > 0 && (
                <section className="mb-8">
                  <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                    <ListNumbers size={18} className="text-white/50" />
                    Recommended Review Order
                  </h2>
                  <ol className="rounded-xl border border-white/10 bg-theme-bg-primary divide-y divide-white/10">
                    {report.reviewOrder.map((item) => (
                      <li
                        key={item.rank}
                        className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                      >
                        <span className="text-white font-medium">
                          {item.rank}. {item.document}
                        </span>
                        <span className="text-white/40 text-xs shrink-0">
                          Risk score {item.riskScore}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {report.clusters?.length > 0 && (
                <section className="mb-8">
                  <h2 className="text-lg font-semibold text-white mb-3">
                    Document Clusters
                  </h2>
                  <div className="space-y-3">
                    {report.clusters.map((cluster) => (
                      <div
                        key={cluster.id}
                        className="rounded-xl border border-white/10 bg-theme-bg-primary p-4"
                      >
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <p className="text-sm font-semibold text-white">{cluster.label}</p>
                          {cluster.confidence != null && (
                            <span className="text-xs text-emerald-300/80">
                              Confidence: {cluster.confidence}%
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-white/50 mb-2">
                          {cluster.documentCount} document
                          {cluster.documentCount === 1 ? "" : "s"}
                        </p>
                        <ul className="text-xs text-white/70 space-y-1">
                          {(cluster.documents || []).map((doc) => (
                            <li key={doc.documentId}>• {doc.title}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {report.duplicates?.length > 0 && (
                <section>
                  <h2 className="text-lg font-semibold text-white mb-3">
                    Duplicate Files
                  </h2>
                  <div className="space-y-2">
                    {report.duplicates.map((pair) => (
                      <div
                        key={`${pair.source}-${pair.target}`}
                        className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-white/80"
                      >
                        {pair.titles?.[0]} ↔ {pair.titles?.[1]}
                        <span className="text-amber-200/70 ml-2">
                          {Math.round((pair.similarityScore || 0) * 100)}% similar
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
