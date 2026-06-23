const { getVectorDbClass } = require("../helpers");

const EMBEDDING_SIMILARITY_THRESHOLD = 0.75;
const TOPIC_OVERLAP_THRESHOLD = 0.3;
const DUPLICATE_SIMILARITY_THRESHOLD = 0.95;

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeLabel(value = "") {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * @param {string} value
 * @returns {string}
 */
function titleCase(value = "") {
  return normalizeLabel(value)
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function cosineSimilarity(a = [], b = []) {
  if (!a.length || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
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
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
function hasCategoryOverlap(a, b) {
  const categoryA = normalizeLabel(a?.category || "");
  const categoryB = normalizeLabel(b?.category || "");
  return Boolean(categoryA && categoryB && categoryA === categoryB);
}

/**
 * Topic overlap ratio using Jaccard similarity on normalized topic sets.
 *
 * @param {object} a
 * @param {object} b
 * @returns {{ ratio: number, sharedTopics: string[] }}
 */
function getTopicOverlap(a, b) {
  const topicsA = new Set(topicsFromRecord(a));
  const topicsB = new Set(topicsFromRecord(b));
  const sharedTopics = [...topicsA].filter((topic) => topicsB.has(topic));

  if (!topicsA.size || !topicsB.size || !sharedTopics.length) {
    return { ratio: 0, sharedTopics: [] };
  }

  const unionSize = new Set([...topicsA, ...topicsB]).size;
  return {
    ratio: sharedTopics.length / unionSize,
    sharedTopics,
  };
}

/**
 * @param {Record<string, number[]>} embeddingsByDocId
 * @param {string} docIdA
 * @param {string} docIdB
 * @returns {number|null}
 */
function getEmbeddingSimilarity(embeddingsByDocId, docIdA, docIdB) {
  const vectorA = embeddingsByDocId[docIdA];
  const vectorB = embeddingsByDocId[docIdB];
  if (!vectorA || !vectorB) return null;
  return cosineSimilarity(vectorA, vectorB);
}

/**
 * Evaluate whether two documents should be connected in the knowledge graph.
 * Uses deterministic rules only — never LLM speculation.
 *
 * @param {object} left
 * @param {object} right
 * @param {Record<string, number[]>} embeddingsByDocId
 * @returns {{
 *   shouldConnect: boolean,
 *   relationshipTypes: string[],
 *   relationshipType: string|null,
 *   similarityScore: number|null,
 *   sharedTopics: string[],
 *   topicOverlapRatio: number
 * }}
 */
function evaluateRelationship(left, right, embeddingsByDocId = {}) {
  const relationshipTypes = [];
  const { ratio: topicOverlapRatio, sharedTopics } = getTopicOverlap(left, right);

  const embeddingSimilarity = getEmbeddingSimilarity(
    embeddingsByDocId,
    left.documentId || left.docId,
    right.documentId || right.docId
  );

  const hasTopicOverlap = topicOverlapRatio > TOPIC_OVERLAP_THRESHOLD;
  const hasEmbeddingSimilarity =
    embeddingSimilarity != null &&
    embeddingSimilarity > EMBEDDING_SIMILARITY_THRESHOLD;
  const isDuplicate =
    embeddingSimilarity != null &&
    embeddingSimilarity >= DUPLICATE_SIMILARITY_THRESHOLD;

  if (hasTopicOverlap) {
    relationshipTypes.push("topic");
  }

  if (hasEmbeddingSimilarity) {
    relationshipTypes.push("embedding");
  }

  if (isDuplicate) {
    relationshipTypes.push("duplicate");
  }

  // Category is tracked for labeling only — never creates clusters by itself.
  const sharesCategory = hasCategoryOverlap(left, right);

  const relationshipType = isDuplicate
    ? "duplicate"
    : hasEmbeddingSimilarity
      ? "embedding"
      : hasTopicOverlap
        ? "topic"
        : null;

  const shouldConnect = hasTopicOverlap || hasEmbeddingSimilarity;

  return {
    shouldConnect,
    relationshipTypes,
    relationshipType,
    sharesCategory,
    similarityScore:
      embeddingSimilarity != null
        ? Number(embeddingSimilarity.toFixed(4))
        : hasTopicOverlap
          ? Number(topicOverlapRatio.toFixed(4))
          : null,
    sharedTopics,
    topicOverlapRatio,
  };
}

/**
 * Load mean chunk embeddings per document from the workspace vector namespace.
 *
 * @param {string} workspaceSlug
 * @param {{ documentId?: string, docId?: string, title?: string, filename?: string }[]} documents
 * @returns {Promise<Record<string, number[]>>}
 */
async function loadDocumentEmbeddings(workspaceSlug, documents = []) {
  if (!workspaceSlug || !documents.length) return {};

  try {
    const VectorDb = getVectorDbClass();
    if (typeof VectorDb.getDocumentCentroidVectors !== "function") {
      return {};
    }

    const centroidsByTitle = await VectorDb.getDocumentCentroidVectors(
      workspaceSlug
    );
    const embeddingsByDocId = {};

    for (const doc of documents) {
      const docId = doc.documentId || doc.docId;
      const filename = doc.title || doc.filename || "";
      const filenameKey = normalizeLabel(filename);
      const centroid =
        centroidsByTitle[filename] ||
        centroidsByTitle[filenameKey] ||
        Object.entries(centroidsByTitle).find(
          ([title]) => normalizeLabel(title) === filenameKey
        )?.[1];

      if (centroid) embeddingsByDocId[docId] = centroid;
    }

    return embeddingsByDocId;
  } catch (error) {
    console.error(
      "[workspaceGraph] loadDocumentEmbeddings failed:",
      error.message
    );
    return {};
  }
}

/**
 * Find near-duplicate document pairs by embedding similarity.
 *
 * @param {object[]} documents
 * @param {Record<string, number[]>} embeddingsByDocId
 * @param {number} [threshold]
 * @returns {object[]}
 */
function findDuplicatePairs(
  documents = [],
  embeddingsByDocId = {},
  threshold = DUPLICATE_SIMILARITY_THRESHOLD
) {
  const pairs = [];

  for (let i = 0; i < documents.length; i++) {
    for (let j = i + 1; j < documents.length; j++) {
      const left = documents[i];
      const right = documents[j];
      const docIdA = left.documentId || left.docId;
      const docIdB = right.documentId || right.docId;
      const similarity = getEmbeddingSimilarity(
        embeddingsByDocId,
        docIdA,
        docIdB
      );

      if (similarity != null && similarity >= threshold) {
        pairs.push({
          source: docIdA,
          target: docIdB,
          relationshipType: "duplicate",
          similarityScore: Number(similarity.toFixed(4)),
          titles: [left.title || left.filename, right.title || right.filename],
        });
      }
    }
  }

  return pairs.sort((a, b) => b.similarityScore - a.similarityScore);
}

module.exports = {
  DUPLICATE_SIMILARITY_THRESHOLD,
  EMBEDDING_SIMILARITY_THRESHOLD,
  TOPIC_OVERLAP_THRESHOLD,
  cosineSimilarity,
  evaluateRelationship,
  findDuplicatePairs,
  getEmbeddingSimilarity,
  getTopicOverlap,
  hasCategoryOverlap,
  loadDocumentEmbeddings,
  normalizeLabel,
  titleCase,
  topicsFromRecord,
};
