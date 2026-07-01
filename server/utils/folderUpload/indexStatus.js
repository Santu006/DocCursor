const { Document } = require("../../models/documents");
const { DocumentIntelligence } = require("../../models/documentIntelligence");
const { DocumentVectors } = require("../../models/vectors");
const { getActiveJobForWorkspace } = require("./jobManager");

/**
 * Build workspace index status for dashboard display.
 *
 * @param {object} workspace
 * @returns {Promise<object>}
 */
async function getWorkspaceIndexStatus(workspace) {
  const documents = await Document.forWorkspace(workspace.id);
  const intelligence = await DocumentIntelligence.forWorkspace(workspace.id, {
    status: "complete",
    limit: 5000,
  });
  const statusCounts = await DocumentIntelligence.statusCounts(workspace.id);
  const docIds = [...new Set(documents.map((doc) => doc.docId))];
  const vectorCount = docIds.length
    ? await DocumentVectors.where({ docId: { in: docIds } })
    : [];

  const totalDocuments = documents.length;
  const enrichedCount = intelligence.length;
  const indexedPercent =
    totalDocuments > 0 ? Math.round((enrichedCount / totalDocuments) * 100) : 0;

  let graphMeta = null;
  try {
    const { buildWorkspaceGraph } = require("../workspaceGraph/graphBuilder");
    const graph = await buildWorkspaceGraph({
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
    });
    graphMeta = {
      clusterCount: graph.meta?.clusterCount ?? 0,
      topicCount: graph.meta?.topicCount ?? 0,
      duplicateCount: graph.meta?.duplicateCount ?? 0,
      categoryCount: graph.distributions?.category?.items?.length ?? 0,
    };
  } catch {
    graphMeta = {
      clusterCount: 0,
      topicCount: 0,
      duplicateCount: 0,
      categoryCount: 0,
    };
  }

  const activeUpload = getActiveJobForWorkspace(workspace.slug);
  const embeddingsReady =
    !activeUpload &&
    totalDocuments > 0 &&
    enrichedCount >= totalDocuments &&
    statusCounts.pending === 0 &&
    statusCounts.processing === 0;

  return {
    documents: totalDocuments,
    chunks: vectorCount.length,
    embeddings: embeddingsReady ? "Ready" : activeUpload ? "Indexing" : "Pending",
    indexedPercent,
    intelligence: {
      complete: statusCounts.complete ?? enrichedCount,
      pending: statusCounts.pending ?? 0,
      processing: statusCounts.processing ?? 0,
      failed: statusCounts.failed ?? 0,
    },
    graph: graphMeta,
    activeUpload,
    status: activeUpload
      ? activeUpload.status
      : embeddingsReady
        ? "ready"
        : totalDocuments > 0
          ? "partial"
          : "empty",
  };
}

module.exports = {
  getWorkspaceIndexStatus,
};
