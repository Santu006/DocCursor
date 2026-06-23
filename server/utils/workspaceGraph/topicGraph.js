const path = require("path");
const { normalizeLabel, titleCase } = require("./similarityGraph");
const { CATEGORY_CLUSTER_LABELS } = require("./clusterDocuments");

/**
 * Human-readable label for a document_intelligence.category value only.
 *
 * @param {string} category
 * @returns {string}
 */
function getCategoryDisplayLabel(category = "") {
  const key = normalizeLabel(category);
  if (!key || key === "uncategorized") return "Uncategorized";
  return CATEGORY_CLUSTER_LABELS[key] || titleCase(key.replace(/_/g, " "));
}

/**
 * Human-readable label for a document_intelligence.fileType value only.
 *
 * @param {string} fileType
 * @returns {string}
 */
function getFileTypeDisplayLabel(fileType = "") {
  const key = normalizeLabel(fileType);
  if (!key || key === "unknown") return "Unknown";
  return key.toUpperCase();
}

/**
 * @param {string} filename
 * @returns {string}
 */
function fileTypeFromFilename(filename = "") {
  const ext = path.extname(String(filename)).toLowerCase().replace(/^\./, "");
  return ext || "unknown";
}

/**
 * @param {Record<string, number>} counts
 * @param {number} totalDocuments
 * @param {(key: string) => string} labelFn
 * @returns {object}
 */
function buildDistributionResult(counts, totalDocuments, labelFn) {
  const items = Object.entries(counts)
    .map(([key, count]) => ({
      key,
      label: labelFn(key),
      count,
      percentage:
        totalDocuments > 0
          ? Number(((count / totalDocuments) * 100).toFixed(1))
          : 0,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const sumCounts = items.reduce((sum, item) => sum + item.count, 0);

  return {
    items,
    totalDocuments,
    sumCounts,
  };
}

/**
 * Category distribution — one bucket per document using document_intelligence.category only.
 *
 * @param {object[]} records
 * @returns {{ items: object[], totalDocuments: number, sumCounts: number }}
 */
function getCategoryDistribution(records = []) {
  const counts = {};

  for (const record of records) {
    const category = normalizeLabel(record.category || "uncategorized");
    counts[category] = (counts[category] || 0) + 1;
  }

  return buildDistributionResult(
    counts,
    records.length,
    getCategoryDisplayLabel
  );
}

/**
 * File type distribution — one bucket per document using document_intelligence.fileType only.
 *
 * @param {object[]} records
 * @returns {{ items: object[], totalDocuments: number, sumCounts: number }}
 */
function getFileTypeDistribution(records = []) {
  const counts = {};

  for (const record of records) {
    const fileType = normalizeLabel(
      record.fileType ||
        fileTypeFromFilename(record.filename || record.title || "")
    );
    counts[fileType] = (counts[fileType] || 0) + 1;
  }

  return buildDistributionResult(counts, records.length, getFileTypeDisplayLabel);
}

/**
 * @param {{ items: object[] }} distribution
 * @returns {number}
 */
function sumDistributionCounts(distribution = {}) {
  return (distribution.items || []).reduce((sum, item) => sum + item.count, 0);
}

/**
 * Build topic → documentId mappings from document records.
 *
 * @param {object[]} documents
 * @returns {Record<string, string[]>}
 */
function buildTopicMappings(documents = []) {
  const topicMappings = {};

  for (const doc of documents) {
    const docId = doc.documentId || doc.docId;
    for (const topic of topicsFromRecord(doc)) {
      if (!topicMappings[topic]) topicMappings[topic] = [];
      topicMappings[topic].push(docId);
    }
  }

  return topicMappings;
}

/**
 * @param {object} record
 * @returns {string[]}
 */
function topicsFromRecord(record) {
  const topics = Array.isArray(record?.keyTopics)
    ? record.keyTopics
    : Array.isArray(record?.topics)
      ? record.topics
      : [];
  return [
    ...new Set(
      topics.map((topic) => normalizeLabel(topic)).filter(Boolean)
    ),
  ];
}

/**
 * @param {Record<string, string[]>} topicMappings
 * @returns {object[]}
 */
function formatTopicMappings(topicMappings = {}) {
  return Object.entries(topicMappings)
    .map(([topic, documentIds]) => ({
      topic: titleCase(topic),
      topicKey: topic,
      documentIds: [...new Set(documentIds)],
      documentCount: new Set(documentIds).size,
    }))
    .sort((a, b) => b.documentCount - a.documentCount || a.topic.localeCompare(b.topic));
}

/**
 * @param {Record<string, string[]>} topicMappings
 * @returns {object[]}
 */
function buildTopicNodes(topicMappings = {}) {
  return Object.entries(topicMappings).map(([topic, documentIds]) => ({
    id: `topic:${topic}`,
    type: "topic",
    label: titleCase(topic),
    topicKey: topic,
    documentIds: [...new Set(documentIds)],
  }));
}

/**
 * @param {Record<string, string[]>} topicMappings
 * @returns {object[]}
 */
function buildTopicDocumentEdges(topicMappings = {}) {
  const edges = [];

  for (const [topic, documentIds] of Object.entries(topicMappings)) {
    const topicId = `topic:${topic}`;
    for (const docId of new Set(documentIds)) {
      edges.push({
        source: topicId,
        target: docId,
        type: "topic-document",
        relationshipType: "topic-mapping",
        similarityScore: null,
      });
    }
  }

  return edges;
}

/**
 * @param {object[]} documents
 * @returns {object[]}
 */
function getMajorTopics(documents = [], limit = 20) {
  const topicCounts = {};

  for (const doc of documents) {
    for (const topic of topicsFromRecord(doc)) {
      topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    }
  }

  return Object.entries(topicCounts)
    .map(([topic, count]) => ({
      topic: titleCase(topic),
      topicKey: topic,
      documentCount: count,
    }))
    .sort((a, b) => b.documentCount - a.documentCount)
    .slice(0, limit);
}

module.exports = {
  buildTopicDocumentEdges,
  buildTopicMappings,
  buildTopicNodes,
  formatTopicMappings,
  getCategoryDistribution,
  getCategoryDisplayLabel,
  getFileTypeDistribution,
  getFileTypeDisplayLabel,
  getMajorTopics,
  sumDistributionCounts,
};
