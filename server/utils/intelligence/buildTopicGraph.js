/**
 * Backward-compatible shim — delegates to workspaceGraph module (Phase 7.2).
 */
const {
  EMBEDDING_SIMILARITY_THRESHOLD,
  cosineSimilarity,
  getTopicOverlap,
  hasCategoryOverlap,
  normalizeLabel,
} = require("../workspaceGraph/similarityGraph");
const {
  deriveClusterLabel,
} = require("../workspaceGraph/clusterDocuments");
const {
  buildWorkspaceGraph,
  buildWorkspaceTopicGraph,
} = require("../workspaceGraph/graphBuilder");

module.exports = {
  EMBEDDING_SIMILARITY_THRESHOLD,
  buildWorkspaceTopicGraph,
  buildWorkspaceGraph,
  cosineSimilarity,
  deriveClusterLabel,
  getTopicOverlap,
  hasCategoryOverlap,
  normalizeLabel,
};
