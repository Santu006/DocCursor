const { cosineSimilarity, normalizeLabel } = require("./similarityGraph");

const LABEL_EMBED_DIM = 256;

/**
 * Deterministic trigram hash embedding for short cluster labels.
 * Used when real embedder vectors are unavailable (sync graph build / tests).
 *
 * @param {string} label
 * @returns {number[]}
 */
function hashEmbedLabel(label = "") {
  const normalized = normalizeLabel(label);
  const vec = new Float64Array(LABEL_EMBED_DIM);

  for (let i = 0; i <= normalized.length - 3; i++) {
    const tri = normalized.slice(i, i + 3);
    let hash = 0;
    for (let j = 0; j < tri.length; j++) {
      hash = (hash * 31 + tri.charCodeAt(j)) % LABEL_EMBED_DIM;
    }
    vec[hash] += 1;
  }

  for (const word of normalized.split(/\s+/).filter(Boolean)) {
    let hash = 0;
    for (let j = 0; j < word.length; j++) {
      hash = (hash * 37 + word.charCodeAt(j)) % LABEL_EMBED_DIM;
    }
    vec[hash] += 2;
  }

  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;

  return Array.from(vec, (value) => value / norm);
}

/**
 * Cosine similarity between cluster labels using provided embeddings or hash fallback.
 *
 * @param {string} labelA
 * @param {string} labelB
 * @param {Record<string, number[]>} [labelEmbeddings]
 * @returns {number}
 */
function getLabelSimilarity(labelA, labelB, labelEmbeddings = {}) {
  const keyA = normalizeLabel(labelA);
  const keyB = normalizeLabel(labelB);
  if (!keyA || !keyB) return 0;
  if (keyA === keyB) return 1;

  const vecA = labelEmbeddings[keyA] || labelEmbeddings[labelA];
  const vecB = labelEmbeddings[keyB] || labelEmbeddings[labelB];

  if (vecA && vecB) {
    return cosineSimilarity(vecA, vecB);
  }

  return cosineSimilarity(hashEmbedLabel(labelA), hashEmbedLabel(labelB));
}

/**
 * Embed a list of unique cluster labels with the configured embedder.
 *
 * @param {string[]} labels
 * @returns {Promise<Record<string, number[]>>}
 */
async function embedClusterLabels(labels = []) {
  const unique = [...new Set(labels.map((label) => String(label).trim()).filter(Boolean))];
  if (!unique.length) return {};

  try {
    const { getEmbeddingEngineSelection } = require("../helpers");
    const embedder = getEmbeddingEngineSelection();
    if (typeof embedder.embedChunks !== "function") return {};

    const vectors = await embedder.embedChunks(unique);
    if (!Array.isArray(vectors) || vectors.length !== unique.length) return {};

    const embeddings = {};
    unique.forEach((label, index) => {
      if (vectors[index]?.length) {
        embeddings[normalizeLabel(label)] = vectors[index];
      }
    });
    return embeddings;
  } catch (error) {
    console.error("[workspaceGraph] embedClusterLabels failed:", error.message);
    return {};
  }
}

module.exports = {
  LABEL_EMBED_DIM,
  embedClusterLabels,
  getLabelSimilarity,
  hashEmbedLabel,
};
