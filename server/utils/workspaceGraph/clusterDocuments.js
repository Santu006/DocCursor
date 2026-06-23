const { normalizeLabel, titleCase } = require("./similarityGraph");
const {
  computeDominantTopics,
  consolidateClusters,
} = require("./consolidateClusters");

/** Categories that describe file format — never used alone for clustering or labels. */
const FILE_FORMAT_CATEGORIES = new Set(["spreadsheet", "presentation"]);

/** Labels derived from PDF metadata — never used as cluster names. */
const UNWANTED_LABEL_PATTERNS = [
  /^pdf\s+bookmarks?$/i,
  /^pdf\s+functionality$/i,
  /^pdf\s+features?$/i,
];

const CATEGORY_CLUSTER_LABELS = {
  agreement: "Legal Agreements",
  contract: "Legal Agreements",
  legal_document: "Legal Documents",
  policy: "Policies",
  invoice: "Invoices",
  resume: "Resumes",
  research_paper: "Research Papers",
  technical_documentation: "Technical Documentation",
  financial_report: "Financial Reports",
  general: "General Documents",
};

const GENERIC_TOPIC_LABELS = new Set([
  "billing",
  "fees",
  "legal fees",
  "retainer",
  "retainer funds",
  "payment",
  "payments",
]);

/** Topic-derived labels that should roll up to Legal Agreements for agreement-category docs. */
const AGREEMENT_FRAGMENT_TOPIC_LABELS = new Set([
  "confidentiality",
  "legal representation",
  "legal services",
  "limited legal services",
  "arbitration",
  "termination",
]);

class UnionFind {
  constructor(ids = []) {
    this.parent = new Map(ids.map((id) => [id, id]));
  }

  find(id) {
    const parent = this.parent.get(id);
    if (parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(a, b) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    this.parent.set(rootB, rootA);
  }

  groups() {
    const grouped = new Map();
    for (const id of this.parent.keys()) {
      const root = this.find(id);
      if (!grouped.has(root)) grouped.set(root, []);
      grouped.get(root).push(id);
    }
    return [...grouped.values()];
  }
}

const TOPIC_FALLBACK_SCORE = 0.3;

/**
 * @param {string} label
 * @returns {boolean}
 */
function isUnwantedClusterLabel(label = "") {
  const normalized = normalizeLabel(label);
  return UNWANTED_LABEL_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * @param {string} topic
 * @returns {string|null}
 */
function topicToClusterLabel(topic = "") {
  const topicLabel = titleCase(topic);
  if (/harassment/i.test(topicLabel)) return "Harassment Reports";
  if (/sec\s+filings?/i.test(topicLabel)) return "SEC Filings";
  if (/pdf/i.test(topicLabel) && /documentation|document/i.test(topicLabel)) {
    return "PDF Documentation";
  }
  if (isUnwantedClusterLabel(topicLabel)) return null;
  if (/report/i.test(topicLabel)) {
    return topicLabel.endsWith("s") ? topicLabel : `${topicLabel}s`;
  }
  return topicLabel;
}

/**
 * @param {string} documentType
 * @returns {string|null}
 */
function documentTypeToClusterLabel(documentType = "") {
  const typeLabel = titleCase(documentType);
  if (/harassment/i.test(typeLabel)) return "Harassment Reports";
  if (/sec\s+filings?/i.test(typeLabel)) return "SEC Filings";
  if (/pdf/i.test(typeLabel) && /documentation|document/i.test(typeLabel)) {
    return "PDF Documentation";
  }
  if (isUnwantedClusterLabel(typeLabel)) return null;
  return typeLabel;
}

/**
 * @param {object} edge
 * @returns {number}
 */
function scoreEdgeForConfidence(edge) {
  if (edge.relationshipType === "duplicate") {
    return edge.similarityScore ?? 0.99;
  }
  if (edge.relationshipType === "embedding") {
    return edge.similarityScore ?? 0.75;
  }
  if (edge.relationshipType === "topic") {
    return edge.topicOverlapRatio ?? edge.similarityScore ?? TOPIC_FALLBACK_SCORE;
  }
  return edge.similarityScore ?? 0;
}

/**
 * Compute how confident we are in a cluster grouping (0–100).
 *
 * @param {object[]} clusterDocs
 * @param {object[]} clusterEdges
 * @returns {number}
 */
function computeClusterConfidence(clusterDocs = [], clusterEdges = []) {
  if (clusterDocs.length <= 1) {
    const intelligenceScores = clusterDocs
      .map((doc) => doc.confidenceScore)
      .filter((score) => typeof score === "number" && !Number.isNaN(score));

    if (intelligenceScores.length) {
      const avg =
        intelligenceScores.reduce((sum, score) => sum + score, 0) /
        intelligenceScores.length;
      return Math.min(100, Math.max(0, Math.round(avg * 100)));
    }
    return 100;
  }

  if (!clusterEdges.length) return 50;

  const edgeScores = clusterEdges.map(scoreEdgeForConfidence);
  const avg =
    edgeScores.reduce((sum, score) => sum + score, 0) / edgeScores.length;
  return Math.min(100, Math.max(0, Math.round(avg * 100)));
}

/**
 * Derive a human-readable cluster label from semantic signals.
 * Priority: common topics → common category → document type.
 *
 * @param {object[]} documents
 * @returns {string}
 */
function deriveClusterLabel(documents = []) {
  if (!documents.length) return "Empty Cluster";

  const categoryCounts = {};
  const topicCounts = {};
  const typeCounts = {};

  for (const doc of documents) {
    const category = normalizeLabel(doc.category || "");
    if (category) {
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    }

    const documentType = normalizeLabel(doc.documentType || "");
    if (documentType) {
      typeCounts[documentType] = (typeCounts[documentType] || 0) + 1;
    }

    for (const topic of doc.topics || []) {
      const normalizedTopic = normalizeLabel(topic);
      if (normalizedTopic) {
        topicCounts[normalizedTopic] = (topicCounts[normalizedTopic] || 0) + 1;
      }
    }
  }

  const dominantCategory = Object.entries(categoryCounts).sort(
    (a, b) => b[1] - a[1]
  )[0];
  const dominantTopic = Object.entries(topicCounts).sort(
    (a, b) => b[1] - a[1]
  )[0];
  const dominantType = Object.entries(typeCounts).sort(
    (a, b) => b[1] - a[1]
  )[0];

  const majorityTopicThreshold = Math.ceil(documents.length / 2);
  const majorityCategoryThreshold = Math.ceil(documents.length / 2);

  if (dominantTopic && dominantTopic[1] >= majorityTopicThreshold) {
    const topicLabel = topicToClusterLabel(dominantTopic[0]);
    const topicIsGeneric = GENERIC_TOPIC_LABELS.has(dominantTopic[0]);
    const topicIsAgreementFragment = AGREEMENT_FRAGMENT_TOPIC_LABELS.has(
      dominantTopic[0]
    );
    const categoryMapsToLegal =
      dominantCategory &&
      ["agreement", "contract"].includes(dominantCategory[0]) &&
      dominantCategory[1] >= majorityCategoryThreshold;

    if (
      topicLabel &&
      !(
        categoryMapsToLegal &&
        (topicIsGeneric || topicIsAgreementFragment)
      )
    ) {
      return topicLabel;
    }
  }

  if (
    dominantCategory &&
    dominantCategory[1] >= majorityCategoryThreshold &&
    !FILE_FORMAT_CATEGORIES.has(dominantCategory[0]) &&
    CATEGORY_CLUSTER_LABELS[dominantCategory[0]]
  ) {
    return CATEGORY_CLUSTER_LABELS[dominantCategory[0]];
  }

  if (dominantType) {
    const typeLabel = documentTypeToClusterLabel(dominantType[0]);
    if (
      typeLabel &&
      (documents.length === 1 || dominantType[1] >= majorityTopicThreshold)
    ) {
      return typeLabel;
    }
  }

  if (documents.length === 1 && dominantTopic) {
    const topicLabel = topicToClusterLabel(dominantTopic[0]);
    const categoryMapsToLegal =
      dominantCategory &&
      ["agreement", "contract"].includes(dominantCategory[0]);
    const topicIsAgreementFragment = AGREEMENT_FRAGMENT_TOPIC_LABELS.has(
      dominantTopic[0]
    );

    if (categoryMapsToLegal && (topicIsAgreementFragment || GENERIC_TOPIC_LABELS.has(dominantTopic[0]))) {
      return CATEGORY_CLUSTER_LABELS[dominantCategory[0]];
    }
    if (topicLabel) return topicLabel;
  }

  if (documents.length === 1) {
    const stem = String(documents[0].title || documents[0].filename || "document")
      .replace(/\.[^.]+$/, "")
      .slice(0, 40);
    const stemLabel = titleCase(stem);
    if (!isUnwantedClusterLabel(stemLabel)) return stemLabel;
  }

  return "Related Documents";
}

/**
 * Build initial clusters from union-find on semantic document-document edges.
 *
 * @param {object[]} documents
 * @param {object[]} documentEdges
 * @returns {object[]}
 */
function buildInitialClusters(documents = [], documentEdges = []) {
  const docIds = documents.map((doc) => doc.documentId || doc.docId);
  const unionFind = new UnionFind(docIds);

  const semanticEdges = documentEdges.filter(
    (edge) =>
      edge.type !== "document-document" ||
      ["topic", "embedding", "duplicate"].includes(edge.relationshipType)
  );

  for (const edge of semanticEdges) {
    if (edge.source && edge.target) {
      unionFind.union(edge.source, edge.target);
    }
  }

  const docsById = Object.fromEntries(
    documents.map((doc) => [doc.documentId || doc.docId, doc])
  );
  const componentGroups = unionFind.groups();

  return componentGroups.map((ids, index) => {
    const clusterDocs = ids.map((docId) => docsById[docId]).filter(Boolean);
    const topicSet = new Set();
    for (const doc of clusterDocs) {
      for (const topic of doc.topics || []) topicSet.add(topic);
    }

    const clusterEdges = semanticEdges.filter(
      (edge) =>
        edge.type === "document-document" &&
        ids.includes(edge.source) &&
        ids.includes(edge.target)
    );

    const confidence = computeClusterConfidence(clusterDocs, clusterEdges);
    const dominantTopics = computeDominantTopics(clusterDocs);

    return {
      id: `cluster-${index + 1}`,
      label: deriveClusterLabel(clusterDocs),
      documentIds: ids,
      documents: clusterDocs.map((doc) => ({
        documentId: doc.documentId || doc.docId,
        title: doc.title || doc.filename,
        category: doc.category,
        documentType: doc.documentType,
      })),
      topics: [...topicSet].sort().map(titleCase),
      dominantTopics,
      documentCount: ids.length,
      confidence,
      confidenceScore: confidence / 100,
    };
  });
}

/**
 * Cluster documents using union-find, then consolidate over-segmented groups.
 *
 * @param {object[]} documents
 * @param {object[]} documentEdges
 * @param {object} [options]
 * @param {Record<string, number[]>} [options.embeddingsByDocId]
 * @param {Record<string, number[]>} [options.labelEmbeddings]
 * @returns {object[]}
 */
function clusterDocuments(documents = [], documentEdges = [], options = {}) {
  const { embeddingsByDocId = {}, labelEmbeddings = {} } = options;
  const initialClusters = buildInitialClusters(documents, documentEdges);

  return consolidateClusters(
    initialClusters,
    documents,
    documentEdges,
    embeddingsByDocId,
    labelEmbeddings
  );
}

module.exports = {
  UnionFind,
  CATEGORY_CLUSTER_LABELS,
  FILE_FORMAT_CATEGORIES,
  GENERIC_TOPIC_LABELS,
  AGREEMENT_FRAGMENT_TOPIC_LABELS,
  UNWANTED_LABEL_PATTERNS,
  buildInitialClusters,
  clusterDocuments,
  computeClusterConfidence,
  deriveClusterLabel,
  isUnwantedClusterLabel,
  scoreEdgeForConfidence,
};
