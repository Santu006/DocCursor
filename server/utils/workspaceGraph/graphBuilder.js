const { DocumentIntelligence } = require("../../models/documentIntelligence");
const { clusterDocuments } = require("./clusterDocuments");
const { embedClusterLabels } = require("./labelEmbedding");
const {
  buildTopicDocumentEdges,
  buildTopicMappings,
  buildTopicNodes,
  formatTopicMappings,
  getCategoryDistribution,
  getFileTypeDistribution,
  getMajorTopics,
} = require("./topicGraph");
const {
  DUPLICATE_SIMILARITY_THRESHOLD,
  EMBEDDING_SIMILARITY_THRESHOLD,
  TOPIC_OVERLAP_THRESHOLD,
  evaluateRelationship,
  findDuplicatePairs,
  loadDocumentEmbeddings,
  titleCase,
  topicsFromRecord,
} = require("./similarityGraph");

const GRAPH_CACHE_TTL_MS = 60_000;
const graphCache = new Map();

/**
 * @param {number} workspaceId
 * @returns {string}
 */
function cacheKey(workspaceId) {
  return `workspace-graph:${workspaceId}`;
}

/**
 * @param {number} workspaceId
 */
function invalidateGraphCache(workspaceId) {
  graphCache.delete(cacheKey(workspaceId));
}

/**
 * @param {object} record
 * @param {Record<string, number[]>} embeddingsByDocId
 * @returns {object}
 */
function buildDocumentNode(record, embeddingsByDocId = {}) {
  const documentId = record.docId;
  const hasEmbedding = Boolean(embeddingsByDocId[documentId]);

  return {
    documentId,
    id: documentId,
    type: "document",
    title: record.filename,
    label: record.filename,
    category: record.category || null,
    documentType: record.documentType || null,
    fileType: record.fileType || null,
    topics: topicsFromRecord(record),
    keywords: Array.isArray(record.keywords) ? record.keywords : [],
    summary: record.summary || null,
    confidenceScore:
      typeof record.confidenceScore === "number" ? record.confidenceScore : null,
    embeddingReference: hasEmbedding ? documentId : null,
  };
}

/**
 * @param {object[]} intelligence
 * @param {Record<string, number[]>} [embeddingsByDocId]
 * @returns {{ nodes: object[], edges: object[], clusters: object[], topicMappings: object[], duplicates: object[], meta: object }}
 */
function buildGraphFromDocuments(intelligence = [], embeddingsByDocId = {}) {
  const documents = intelligence.map((record) =>
    buildDocumentNode(record, embeddingsByDocId)
  );

  const topicMappings = buildTopicMappings(documents);
  const documentEdges = [];

  for (let i = 0; i < documents.length; i++) {
    for (let j = i + 1; j < documents.length; j++) {
      const left = documents[i];
      const right = documents[j];
      const evaluation = evaluateRelationship(left, right, embeddingsByDocId);

      if (!evaluation.shouldConnect) continue;

      documentEdges.push({
        source: left.documentId,
        target: right.documentId,
        type: "document-document",
        relationshipType: evaluation.relationshipType,
        similarityScore: evaluation.similarityScore,
        reasons: evaluation.relationshipTypes,
        sharedTopics: evaluation.sharedTopics.map(titleCase),
        topicOverlapRatio: Number(evaluation.topicOverlapRatio.toFixed(4)),
        similarity: evaluation.similarityScore,
      });
    }
  }

  const clusters = clusterDocuments(documents, documentEdges, {
    embeddingsByDocId,
  });
  const docIdToClusterId = {};

  for (const cluster of clusters) {
    for (const docId of cluster.documentIds) {
      docIdToClusterId[docId] = cluster.id;
    }
  }

  const nodes = documents.map((doc) => ({
    ...doc,
    clusterId: docIdToClusterId[doc.documentId] || null,
  }));

  const topicNodes = buildTopicNodes(topicMappings);
  const topicEdges = buildTopicDocumentEdges(topicMappings);
  const duplicates = findDuplicatePairs(documents, embeddingsByDocId);

  const categoryDistribution = getCategoryDistribution(intelligence);
  const fileTypeDistribution = getFileTypeDistribution(intelligence);

  return {
    nodes: [...nodes, ...topicNodes],
    edges: [...documentEdges, ...topicEdges],
    clusters,
    topicMappings: formatTopicMappings(topicMappings),
    duplicates,
    majorTopics: getMajorTopics(documents),
    categoryDistribution: categoryDistribution.items,
    fileTypeDistribution: fileTypeDistribution.items,
    distributions: {
      category: categoryDistribution,
      fileType: fileTypeDistribution,
    },
    meta: {
      documentCount: documents.length,
      clusterCount: clusters.length,
      relationshipCount: documentEdges.length,
      topicCount: Object.keys(topicMappings).length,
      duplicateCount: duplicates.length,
      similarityThreshold: EMBEDDING_SIMILARITY_THRESHOLD,
      topicOverlapThreshold: TOPIC_OVERLAP_THRESHOLD,
      duplicateThreshold: DUPLICATE_SIMILARITY_THRESHOLD,
      rules: [
        "topic-overlap-above-30-percent",
        "embedding-similarity-above-75-percent",
      ],
      cached: false,
      builtAt: new Date().toISOString(),
    },
  };
}

/**
 * Build the workspace knowledge graph from stored intelligence metadata.
 *
 * @param {object} params
 * @param {number} params.workspaceId
 * @param {string} params.workspaceSlug
 * @param {Record<string, number[]>} [params.embeddingsByDocId]
 * @param {boolean} [params.skipCache]
 * @returns {Promise<object>}
 */
async function buildWorkspaceGraph({
  workspaceId,
  workspaceSlug,
  embeddingsByDocId = null,
  skipCache = false,
}) {
  const key = cacheKey(workspaceId);

  if (!skipCache) {
    const cached = graphCache.get(key);
    if (cached && Date.now() - cached.timestamp < GRAPH_CACHE_TTL_MS) {
      return { ...cached.graph, meta: { ...cached.graph.meta, cached: true } };
    }
  }

  const intelligence = await DocumentIntelligence.forWorkspace(workspaceId, {
    status: "complete",
    limit: 500,
  });

  const resolvedEmbeddings =
    embeddingsByDocId ||
    (await loadDocumentEmbeddings(workspaceSlug, intelligence));

  const graph = buildGraphFromDocuments(intelligence, resolvedEmbeddings);

  const labelEmbeddings = await embedClusterLabels(
    graph.clusters.map((cluster) => cluster.label)
  );

  if (Object.keys(labelEmbeddings).length > 0) {
    const documents = intelligence.map((record) =>
      buildDocumentNode(record, resolvedEmbeddings)
    );
    const documentEdges = graph.edges.filter(
      (edge) => edge.type === "document-document"
    );
    graph.clusters = clusterDocuments(documents, documentEdges, {
      embeddingsByDocId: resolvedEmbeddings,
      labelEmbeddings,
    });

    const docIdToClusterId = {};
    for (const cluster of graph.clusters) {
      for (const docId of cluster.documentIds) {
        docIdToClusterId[docId] = cluster.id;
      }
    }
    graph.nodes = graph.nodes.map((node) =>
      node.type === "document"
        ? { ...node, clusterId: docIdToClusterId[node.documentId] || null }
        : node
    );
    graph.meta.clusterCount = graph.clusters.length;
  }

  graphCache.set(key, { graph, timestamp: Date.now() });
  return graph;
}

/** @deprecated Use buildWorkspaceGraph */
async function buildWorkspaceTopicGraph(params) {
  return buildWorkspaceGraph(params);
}

/**
 * @param {object} params
 * @returns {Promise<object[]>}
 */
async function getWorkspaceClusters(params) {
  const graph = await buildWorkspaceGraph(params);
  return graph.clusters;
}

/**
 * @param {object} params
 * @param {string} params.documentId
 * @returns {Promise<object>}
 */
async function getRelatedDocuments({ workspaceId, workspaceSlug, documentId }) {
  const graph = await buildWorkspaceGraph({ workspaceId, workspaceSlug });
  const documentNode = graph.nodes.find(
    (node) => node.type === "document" && node.documentId === documentId
  );

  if (!documentNode) {
    return {
      documentId,
      found: false,
      related: [],
      cluster: null,
    };
  }

  const relatedEdges = graph.edges.filter(
    (edge) =>
      edge.type === "document-document" &&
      (edge.source === documentId || edge.target === documentId)
  );

  const nodesById = Object.fromEntries(
    graph.nodes
      .filter((node) => node.type === "document")
      .map((node) => [node.documentId, node])
  );

  const related = relatedEdges
    .map((edge) => {
      const otherId = edge.source === documentId ? edge.target : edge.source;
      const other = nodesById[otherId];
      if (!other) return null;

      return {
        documentId: other.documentId,
        title: other.title,
        category: other.category,
        documentType: other.documentType,
        relationshipType: edge.relationshipType,
        similarityScore: edge.similarityScore,
        sharedTopics: edge.sharedTopics || [],
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.similarityScore || 0) - (a.similarityScore || 0));

  const cluster =
    graph.clusters.find((item) => item.documentIds.includes(documentId)) ||
    null;

  return {
    documentId,
    found: true,
    title: documentNode.title,
    related,
    cluster: cluster
      ? { id: cluster.id, label: cluster.label, documentCount: cluster.documentCount }
      : null,
  };
}

/**
 * @param {object} params
 * @returns {Promise<object[]>}
 */
async function findNearDuplicates(params) {
  const graph = await buildWorkspaceGraph(params);
  return graph.duplicates;
}

/**
 * Search documents by topic or keyword from intelligence metadata.
 *
 * @param {object} graph
 * @param {string} query
 * @returns {object[]}
 */
function searchDocumentsByTopic(graph, query = "") {
  const normalized = String(query).trim().toLowerCase();
  if (!normalized) return [];

  const documentNodes = graph.nodes.filter((node) => node.type === "document");

  return documentNodes
    .filter((doc) => {
      const haystack = [
        doc.title,
        doc.category,
        doc.documentType,
        ...(doc.topics || []),
        ...(doc.keywords || []),
        doc.summary,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalized);
    })
    .map((doc) => ({
      documentId: doc.documentId,
      title: doc.title,
      category: doc.category,
      documentType: doc.documentType,
      topics: doc.topics,
    }));
}

/**
 * Find similar documents to a given document using graph edges and embeddings.
 *
 * @param {object} graph
 * @param {string} documentId
 * @returns {object[]}
 */
function getSimilarDocuments(graph, documentId) {
  return graph.edges
    .filter(
      (edge) =>
        edge.type === "document-document" &&
        (edge.source === documentId || edge.target === documentId) &&
        ["embedding", "duplicate"].includes(edge.relationshipType)
    )
    .map((edge) => {
      const otherId = edge.source === documentId ? edge.target : edge.source;
      const other = graph.nodes.find(
        (node) => node.type === "document" && node.documentId === otherId
      );
      return other
        ? {
            documentId: other.documentId,
            title: other.title,
            similarityScore: edge.similarityScore,
            relationshipType: edge.relationshipType,
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => (b.similarityScore || 0) - (a.similarityScore || 0));
}

module.exports = {
  GRAPH_CACHE_TTL_MS,
  buildDocumentNode,
  buildGraphFromDocuments,
  buildWorkspaceGraph,
  buildWorkspaceTopicGraph,
  findNearDuplicates,
  getRelatedDocuments,
  getSimilarDocuments,
  invalidateGraphCache,
  searchDocumentsByTopic,
  getWorkspaceClusters,
};
