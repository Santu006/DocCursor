import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CircleNotch,
  Graph,
  LinkSimple,
  Tag,
} from "@phosphor-icons/react";
import Sidebar from "@/components/Sidebar";
import Intelligence from "@/models/intelligence";
import paths from "@/utils/paths";
import { isMobile } from "react-device-detect";

function ReasonBadge({ reason }) {
  const tones = {
    category: "bg-blue-500/20 text-blue-200 border-blue-500/30",
    topic: "bg-purple-500/20 text-purple-200 border-purple-500/30",
    embedding: "bg-emerald-500/20 text-emerald-200 border-emerald-500/30",
    duplicate: "bg-amber-500/20 text-amber-200 border-amber-500/30",
  };

  return (
    <span
      className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-medium capitalize ${
        tones[reason] || "bg-white/10 text-white/70 border-white/10"
      }`}
    >
      {reason}
    </span>
  );
}

function DocumentCard({ document, topics = [] }) {
  return (
    <div className="rounded-lg border border-white/10 bg-theme-bg-primary p-3">
      <p className="text-sm font-semibold text-white truncate">{document.label}</p>
      {document.category && (
        <p className="text-xs text-white/50 mt-1 capitalize">
          Category: {document.category}
        </p>
      )}
      {topics.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {topics.map((topic) => (
            <span
              key={topic}
              className="inline-flex items-center gap-1 rounded bg-white/5 px-2 py-0.5 text-[11px] text-white/70"
            >
              <Tag size={10} />
              {topic}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ClusterPanel({ cluster, documentsById, edges }) {
  const clusterDocs = cluster.documentIds
    .map((docId) => documentsById[docId])
    .filter(Boolean);

  const clusterEdges = edges.filter(
    (edge) =>
      edge.type === "document-document" &&
      cluster.documentIds.includes(edge.source) &&
      cluster.documentIds.includes(edge.target)
  );

  return (
    <section className="rounded-2xl border border-white/10 bg-theme-bg-secondary p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-bold text-white">{cluster.label}</h2>
          <p className="text-xs text-white/50 mt-1">
            {cluster.documentCount} document{cluster.documentCount === 1 ? "" : "s"}
            {cluster.confidence != null && (
              <span className="text-emerald-300/80">
                {" "}
                · Confidence: {cluster.confidence}%
              </span>
            )}
            {cluster.topics.length > 0
              ? ` · ${cluster.topics.length} shared topic${
                  cluster.topics.length === 1 ? "" : "s"
                }`
              : ""}
          </p>
        </div>
        <Graph size={22} className="text-white/40 shrink-0" />
      </div>

      {cluster.topics.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {cluster.topics.map((topic) => (
            <span
              key={topic}
              className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-1 text-xs text-purple-200"
            >
              {topic}
            </span>
          ))}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {clusterDocs.map((doc) => (
          <DocumentCard
            key={doc.id}
            document={doc}
            topics={doc.topics || []}
          />
        ))}
      </div>

      {clusterEdges.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs uppercase tracking-wide text-white/40">
            Document relationships
          </p>
          {clusterEdges.map((edge) => {
            const left = documentsById[edge.source];
            const right = documentsById[edge.target];
            if (!left || !right) return null;

            return (
              <div
                key={`${edge.source}-${edge.target}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-white/5 bg-black/10 px-3 py-2 text-xs text-white/80"
              >
                <LinkSimple size={14} className="text-white/40" />
                <span className="truncate max-w-[140px]">{left.label}</span>
                <span className="text-white/30">↔</span>
                <span className="truncate max-w-[140px]">{right.label}</span>
                <div className="flex flex-wrap gap-1 ml-auto">
                  {(edge.reasons || [edge.relationshipType]).filter(Boolean).map((reason) => (
                    <ReasonBadge key={reason} reason={reason} />
                  ))}
                  {(edge.similarityScore ?? edge.similarity) != null && (
                    <span className="text-white/50">
                      sim {Math.round((edge.similarityScore ?? edge.similarity) * 100)}%
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function TopicGraphPage() {
  const { slug } = useParams();
  const [graph, setGraph] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      const result = await Intelligence.topicGraph(slug);
      if (result.error || !result.graph) {
        setError(result.error || "Unable to load topic graph.");
        setGraph(null);
      } else {
        setGraph(result.graph);
      }
      setLoading(false);
    }
    if (slug) load();
  }, [slug]);

  const documentsById = useMemo(() => {
    if (!graph?.nodes) return {};
    return Object.fromEntries(
      graph.nodes
        .filter((node) => node.type === "document")
        .map((node) => [node.id, node])
    );
  }, [graph]);

  const documentEdges = useMemo(
    () =>
      (graph?.edges || []).filter((edge) => edge.type === "document-document"),
    [graph]
  );

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
            <h1 className="text-2xl font-bold text-white">Topic Graph</h1>
            <p className="text-white/60 text-sm mt-2 max-w-3xl">
              Semantic document clusters built from topic overlap and embedding
              similarity — not file type. Relationships require &gt;30% topic overlap
              or &gt;75% embedding similarity. Unrelated documents stay in separate
              clusters.
            </p>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-white/60">
              <CircleNotch className="animate-spin" size={18} />
              Building topic graph...
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-200 text-sm">
              {error}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
                <div className="rounded-xl border border-white/10 bg-theme-bg-primary p-4">
                  <p className="text-xs text-white/50 uppercase">Documents</p>
                  <p className="text-2xl font-bold text-white mt-1">
                    {graph.meta.documentCount}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-theme-bg-primary p-4">
                  <p className="text-xs text-white/50 uppercase">Clusters</p>
                  <p className="text-2xl font-bold text-white mt-1">
                    {graph.meta.clusterCount}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-theme-bg-primary p-4">
                  <p className="text-xs text-white/50 uppercase">Topics</p>
                  <p className="text-2xl font-bold text-white mt-1">
                    {graph.meta.topicCount}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-theme-bg-primary p-4">
                  <p className="text-xs text-white/50 uppercase">Relationships</p>
                  <p className="text-2xl font-bold text-white mt-1">
                    {graph.meta.relationshipCount}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-theme-bg-primary p-4">
                  <p className="text-xs text-white/50 uppercase">Duplicates</p>
                  <p className="text-2xl font-bold text-white mt-1">
                    {graph.meta.duplicateCount ?? 0}
                  </p>
                </div>
              </div>

              {graph.categoryDistribution?.length > 0 && (
                <section className="mb-8">
                  <h2 className="text-lg font-semibold text-white mb-3">
                    Category Distribution
                  </h2>
                  <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                    {graph.categoryDistribution.map((item) => (
                      <div
                        key={item.key}
                        className="rounded-xl border border-white/10 bg-theme-bg-primary p-4 flex items-center justify-between"
                      >
                        <div>
                          <p className="text-sm font-medium text-white">
                            {item.label}
                          </p>
                          <p className="text-xs text-white/50 mt-0.5">
                            {item.count} document{item.count === 1 ? "" : "s"}
                          </p>
                        </div>
                        <p className="text-lg font-bold text-white/80">
                          {item.percentage}%
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {graph.fileTypeDistribution?.length > 0 && (
                <section className="mb-8">
                  <h2 className="text-lg font-semibold text-white mb-3">
                    File Type Distribution
                  </h2>
                  <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                    {graph.fileTypeDistribution.map((item) => (
                      <div
                        key={item.key}
                        className="rounded-xl border border-white/10 bg-theme-bg-primary p-4 flex items-center justify-between"
                      >
                        <div>
                          <p className="text-sm font-medium text-white">
                            {item.label}
                          </p>
                          <p className="text-xs text-white/50 mt-0.5">
                            {item.count} document{item.count === 1 ? "" : "s"}
                          </p>
                        </div>
                        <p className="text-lg font-bold text-white/80">
                          {item.percentage}%
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {graph.duplicates?.length > 0 && (
                <section className="mb-8">
                  <h2 className="text-lg font-semibold text-white mb-3">
                    Near-duplicate files
                  </h2>
                  <div className="space-y-2">
                    {graph.duplicates.map((pair) => (
                      <div
                        key={`${pair.source}-${pair.target}`}
                        className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-white/80"
                      >
                        <span className="truncate">{pair.titles?.[0] || pair.source}</span>
                        <span className="text-white/30 mx-2">↔</span>
                        <span className="truncate">{pair.titles?.[1] || pair.target}</span>
                        <span className="text-amber-200/70 ml-2">
                          {Math.round(pair.similarityScore * 100)}% similar
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {graph.clusters.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-theme-bg-primary p-6 text-white/60 text-sm">
                  No enriched documents found. Upload and index documents, then wait
                  for intelligence enrichment to complete.
                </div>
              ) : (
                <div className="space-y-6">
                  {graph.clusters.map((cluster) => (
                    <ClusterPanel
                      key={cluster.id}
                      cluster={cluster}
                      documentsById={documentsById}
                      edges={documentEdges}
                    />
                  ))}
                </div>
              )}

              {graph.topicMappings?.length > 0 && (
                <section className="mt-10">
                  <h2 className="text-lg font-semibold text-white mb-3">
                    Topic-to-document mappings
                  </h2>
                  <div className="grid gap-3 md:grid-cols-2">
                    {graph.topicMappings.map((mapping) => (
                      <div
                        key={mapping.topicKey}
                        className="rounded-xl border border-white/10 bg-theme-bg-primary p-4"
                      >
                        <p className="text-sm font-semibold text-white">
                          {mapping.topic}
                        </p>
                        <ul className="mt-2 space-y-1 text-xs text-white/60">
                          {mapping.documentIds.map((docId) => (
                            <li key={docId}>
                              {documentsById[docId]?.label || docId}
                            </li>
                          ))}
                        </ul>
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
