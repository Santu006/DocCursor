const {
  buildWorkspaceGraph,
  findNearDuplicates,
  getRelatedDocuments,
  getSimilarDocuments,
  searchDocumentsByTopic,
} = require("../workspaceGraph/graphBuilder");

/**
 * Patterns for workspace knowledge graph queries.
 */
const WORKSPACE_GRAPH_PATTERNS = [
  /\b(major|main|top)\s+topics?\b/i,
  /\bwhich\s+documents?\s+(are\s+)?related\b/i,
  /\brelated\s+documents?\b/i,
  /\bwhich\s+(agreements?|contracts?|documents?|files?)\s+(discuss|mention|cover|address)\b/i,
  /\b(similar|like)\s+(documents?|files?)\b/i,
  /\b(show|list|display)\s+(document\s+)?clusters?\b/i,
  /\b(document\s+)?clusters?\b/i,
  /\b(duplicate|near[- ]duplicate|identical)\s+(documents?|files?)\b/i,
  /\bfind\s+duplicates?\b/i,
];

/**
 * @param {string} message
 * @returns {boolean}
 */
function isWorkspaceGraphQuery(message = "") {
  if (!message || typeof message !== "string") return false;
  const normalized = message.trim();
  if (!normalized) return false;

  if (/@document\//i.test(normalized)) return false;

  return WORKSPACE_GRAPH_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * @param {string} message
 * @returns {"major-topics"|"related-documents"|"topic-search"|"similar-documents"|"clusters"|"duplicates"|"general-graph"}
 */
function classifyGraphQuery(message = "") {
  const normalized = message.trim();

  if (/\b(duplicate|near[- ]duplicate|identical)\s+(documents?|files?)\b/i.test(normalized) || /\bfind\s+duplicates?\b/i.test(normalized)) {
    return "duplicates";
  }

  if (/\b(similar|like)\s+(documents?|files?)\b/i.test(normalized)) {
    return "similar-documents";
  }

  if (/\b(show|list|display)\s+(document\s+)?clusters?\b/i.test(normalized) || /\bwhich\s+documents?\s+(are\s+)?related\b/i.test(normalized)) {
    return "clusters";
  }

  if (/\bwhich\s+(agreements?|contracts?|documents?|files?)\s+(discuss|mention|cover|address)\b/i.test(normalized)) {
    return "topic-search";
  }

  if (/\b(major|main|top)\s+topics?\b/i.test(normalized)) {
    return "major-topics";
  }

  if (/\brelated\s+documents?\b/i.test(normalized)) {
    return "related-documents";
  }

  return "general-graph";
}

/**
 * Extract a search term from topic-search queries like "which agreements discuss billing".
 *
 * @param {string} message
 * @returns {string|null}
 */
function extractTopicSearchTerm(message = "") {
  const match = message.match(
    /\b(?:discuss|mention|cover|address|about|on)\s+(.+?)(?:\?|$)/i
  );
  if (match) return match[1].trim().replace(/[?.!]+$/, "");

  const keywordMatch = message.match(
    /\bwhich\s+(?:agreements?|contracts?|documents?|files?)\s+(?:discuss|mention|cover|address)\s+(.+?)(?:\?|$)/i
  );
  if (keywordMatch) return keywordMatch[1].trim().replace(/[?.!]+$/, "");

  return null;
}

/**
 * @param {object} graph
 * @param {string} message
 * @returns {string}
 */
function formatGraphContext(graph, message) {
  const queryType = classifyGraphQuery(message);
  const lines = [
    "## Workspace Knowledge Graph (deterministic — no LLM speculation)",
    "",
    `Documents analyzed: ${graph.meta.documentCount}`,
    `Clusters: ${graph.meta.clusterCount}`,
    `Relationships: ${graph.meta.relationshipCount}`,
    "",
    "Relationship rules: topic overlap > 30% or embedding similarity > 75% (file type never clusters alone).",
    "",
  ];

  switch (queryType) {
    case "major-topics": {
      lines.push("### Major topics");
      if (!graph.majorTopics?.length) {
        lines.push("No topics found in document intelligence metadata.");
      } else {
        for (const topic of graph.majorTopics) {
          lines.push(`- **${topic.topic}** (${topic.documentCount} document${topic.documentCount === 1 ? "" : "s"})`);
        }
      }
      break;
    }

    case "clusters": {
      lines.push("### Document clusters");
      if (!graph.clusters?.length) {
        lines.push("No clusters found.");
      } else {
        for (const cluster of graph.clusters) {
          lines.push(`\n#### ${cluster.label} (${cluster.documentCount} documents)`);
          for (const doc of cluster.documents || []) {
            lines.push(`- ${doc.title}`);
          }
        }
      }
      break;
    }

    case "duplicates": {
      lines.push("### Near-duplicate documents");
      if (!graph.duplicates?.length) {
        lines.push("No near-duplicate files detected (embedding similarity ≥ 95%).");
      } else {
        for (const pair of graph.duplicates) {
          lines.push(
            `- **${pair.titles[0]}** ↔ **${pair.titles[1]}** (similarity: ${Math.round(pair.similarityScore * 100)}%)`
          );
        }
      }
      break;
    }

    case "topic-search": {
      const term = extractTopicSearchTerm(message);
      lines.push(`### Documents matching "${term || "query"}"`);
      const matches = searchDocumentsByTopic(graph, term || message);
      if (!matches.length) {
        lines.push("No documents found matching that topic or keyword in intelligence metadata.");
      } else {
        for (const doc of matches) {
          lines.push(
            `- **${doc.title}** (${doc.documentType || doc.category || "unknown"}) — topics: ${(doc.topics || []).join(", ") || "none"}`
          );
        }
      }
      break;
    }

    case "similar-documents": {
      lines.push("### Similar document pairs (embedding similarity > 75%)");
      const similarEdges = graph.edges.filter(
        (edge) =>
          edge.type === "document-document" &&
          ["embedding", "duplicate"].includes(edge.relationshipType)
      );
      if (!similarEdges.length) {
        lines.push("No high-similarity document pairs found.");
      } else {
        const nodesById = Object.fromEntries(
          graph.nodes
            .filter((node) => node.type === "document")
            .map((node) => [node.documentId, node])
        );
        for (const edge of similarEdges) {
          const left = nodesById[edge.source];
          const right = nodesById[edge.target];
          if (!left || !right) continue;
          lines.push(
            `- **${left.title}** ↔ **${right.title}** (${edge.relationshipType}, ${Math.round((edge.similarityScore || 0) * 100)}%)`
          );
        }
      }
      break;
    }

  default: {
      lines.push("### Category distribution");
      for (const item of graph.categoryDistribution || []) {
        lines.push(`- ${item.label}: ${item.count} (${item.percentage}%)`);
      }

      lines.push("\n### Clusters");
      for (const cluster of graph.clusters || []) {
        lines.push(`\n#### ${cluster.label}`);
        for (const doc of cluster.documents || []) {
          lines.push(`- ${doc.title}`);
        }
      }
      break;
    }
  }

  return lines.join("\n");
}

/**
 * Run workspace graph analysis for chat and return context injection.
 * Uses stored intelligence metadata and embeddings — no LLM calls.
 *
 * @param {object} params
 * @param {string} params.message
 * @param {object} params.workspace
 * @returns {Promise<{ handled: boolean, context?: string, graph?: object, error?: string }>}
 */
async function performWorkspaceGraphQuery({ message, workspace }) {
  if (!isWorkspaceGraphQuery(message)) {
    return { handled: false };
  }

  try {
    const graph = await buildWorkspaceGraph({
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
    });

    if (!graph.meta.documentCount) {
      return {
        handled: true,
        context:
          "No enriched documents found in this workspace. Upload and index documents, then wait for intelligence enrichment to complete before using the knowledge graph.",
      };
    }

    return {
      handled: true,
      graph,
      context: `${formatGraphContext(graph, message)}

Workspace graph instructions:
- Answer using only the knowledge graph data above
- Do not invent document relationships not listed in the graph
- Cite document titles when listing related files
- If no matches exist for the query, say so explicitly`,
    };
  } catch (error) {
    console.error("[workspaceGraphRetrieval]", error);
    return {
      handled: true,
      error: `Workspace graph query failed: ${error.message}`,
    };
  }
}

const WORKSPACE_GRAPH_SYSTEM_PROMPT = `You are a workspace knowledge graph assistant.
When workspace graph context is provided, answer ONLY from that deterministic graph data.

Rules:
- Never speculate about document relationships
- Only cite connections explicitly listed (topic overlap > 30%, embedding similarity > 75%)
- File type or category alone does not imply a relationship
- Unrelated documents in separate clusters are NOT related
- For duplicate detection, only report pairs with ≥ 95% embedding similarity
- Use document titles from the graph context`;

module.exports = {
  WORKSPACE_GRAPH_PATTERNS,
  WORKSPACE_GRAPH_SYSTEM_PROMPT,
  classifyGraphQuery,
  extractTopicSearchTerm,
  formatGraphContext,
  isWorkspaceGraphQuery,
  performWorkspaceGraphQuery,
};
