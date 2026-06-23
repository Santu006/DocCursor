const {
  evaluateRelationship,
  getEmbeddingSimilarity,
  normalizeLabel,
  titleCase,
} = require("./similarityGraph");
const { getLabelSimilarity } = require("./labelEmbedding");

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

const LABEL_SIMILARITY_THRESHOLD = 0.8;
const CLUSTER_TOPIC_OVERLAP_THRESHOLD = 0.5;
const AGREEMENT_TOPIC_OVERLAP_THRESHOLD = 0.3;
const SINGLETON_EMBEDDING_THRESHOLD = 0.75;

const AGREEMENT_CATEGORIES = new Set(["agreement", "contract"]);

const LEGAL_AGREEMENT_CLUSTER_ALIASES = new Set([
  "confidentiality",
  "legal representation",
  "legal services",
  "limited legal services",
  "legal agreements",
  "fee agreement",
  "retainer agreement",
]);

/**
 * @param {object[]} clusterDocs
 * @returns {Set<string>}
 */
function getClusterTopicSet(clusterDocs = []) {
  const topics = new Set();
  for (const doc of clusterDocs) {
    for (const topic of doc.topics || []) {
      const normalized = normalizeLabel(topic);
      if (normalized) topics.add(normalized);
    }
  }
  return topics;
}

/**
 * Shared-topic ratio: |intersection| / min(|A|, |B|).
 *
 * @param {Set<string>} topicsA
 * @param {Set<string>} topicsB
 * @returns {number}
 */
function getClusterTopicOverlapRatio(topicsA, topicsB) {
  if (!topicsA.size || !topicsB.size) return 0;
  const shared = [...topicsA].filter((topic) => topicsB.has(topic));
  if (!shared.length) return 0;
  return shared.length / Math.min(topicsA.size, topicsB.size);
}

/**
 * Jaccard topic overlap — matches document-document relationship rules.
 *
 * @param {Set<string>} topicsA
 * @param {Set<string>} topicsB
 * @returns {number}
 */
function getClusterTopicJaccardOverlap(topicsA, topicsB) {
  if (!topicsA.size || !topicsB.size) return 0;
  const shared = [...topicsA].filter((topic) => topicsB.has(topic));
  if (!shared.length) return 0;
  const unionSize = new Set([...topicsA, ...topicsB]).size;
  return shared.length / unionSize;
}

/**
 * @param {object[]} clusterDocs
 * @returns {string|null}
 */
function getClusterMajorityCategory(clusterDocs = []) {
  const categoryCounts = {};
  for (const doc of clusterDocs) {
    const category = normalizeLabel(doc.category || "");
    if (!category) continue;
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
  }

  const sorted = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return null;

  const [category, count] = sorted[0];
  if (count >= Math.ceil(clusterDocs.length / 2)) return category;
  return null;
}

/**
 * @param {object[]} clusterDocs
 * @returns {boolean}
 */
function isAgreementMajorityCluster(clusterDocs = []) {
  const majorityCategory = getClusterMajorityCategory(clusterDocs);
  return AGREEMENT_CATEGORIES.has(majorityCategory);
}

/**
 * @param {object} cluster
 * @returns {boolean}
 */
function isLegalAgreementAliasCluster(cluster) {
  return LEGAL_AGREEMENT_CLUSTER_ALIASES.has(normalizeLabel(cluster.label || ""));
}

/**
 * @param {object} clusterA
 * @param {object} clusterB
 * @param {Set<string>} topicsA
 * @param {Set<string>} topicsB
 * @returns {boolean}
 */
function shouldMergeAgreementClusters(clusterA, clusterB, topicsA, topicsB) {
  const docsA = clusterA._docs || [];
  const docsB = clusterB._docs || [];
  if (!docsA.length || !docsB.length) return false;

  const aAgreement = isAgreementMajorityCluster(docsA);
  const bAgreement = isAgreementMajorityCluster(docsB);
  const aAlias = isLegalAgreementAliasCluster(clusterA);
  const bAlias = isLegalAgreementAliasCluster(clusterB);

  if (!(aAgreement || aAlias) || !(bAgreement || bAlias)) return false;
  if (aAlias && !bAgreement && !bAlias) return false;
  if (bAlias && !aAgreement && !aAlias) return false;

  return getClusterTopicJaccardOverlap(topicsA, topicsB) > AGREEMENT_TOPIC_OVERLAP_THRESHOLD;
}

/**
 * @param {object[]} clusterDocs
 * @param {number} [minDocShare=0.5]
 * @returns {string[]}
 */
function computeDominantTopics(clusterDocs = [], minDocShare = 0.5) {
  if (!clusterDocs.length) return [];

  const topicCounts = {};
  for (const doc of clusterDocs) {
    for (const topic of doc.topics || []) {
      const normalized = normalizeLabel(topic);
      if (!normalized) continue;
      topicCounts[normalized] = (topicCounts[normalized] || 0) + 1;
    }
  }

  const threshold = Math.ceil(clusterDocs.length * minDocShare);
  return Object.entries(topicCounts)
    .filter(([, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([topic]) => titleCase(topic));
}

/**
 * @param {object} singletonDoc
 * @param {object[]} targetDocs
 * @param {Record<string, number[]>} embeddingsByDocId
 * @returns {number}
 */
function scoreSingletonAttachment(singletonDoc, targetDocs, embeddingsByDocId = {}) {
  let best = 0;
  const singletonId = singletonDoc.documentId || singletonDoc.docId;

  for (const targetDoc of targetDocs) {
    const targetId = targetDoc.documentId || targetDoc.docId;
    const embeddingSimilarity = getEmbeddingSimilarity(
      embeddingsByDocId,
      singletonId,
      targetId
    );

    if (
      embeddingSimilarity != null &&
      embeddingSimilarity > SINGLETON_EMBEDDING_THRESHOLD
    ) {
      best = Math.max(best, embeddingSimilarity);
    }

    const evaluation = evaluateRelationship(singletonDoc, targetDoc, embeddingsByDocId);
    if (evaluation.shouldConnect) {
      best = Math.max(
        best,
        evaluation.similarityScore ?? evaluation.topicOverlapRatio ?? 0
      );
    }
  }

  return best;
}

/**
 * Merge single-document clusters into semantically close multi-document clusters.
 *
 * @param {object[]} clusters
 * @param {object[]} documents
 * @param {Record<string, number[]>} embeddingsByDocId
 * @returns {object[]}
 */
function attachSingletonClusters(clusters = [], documents = [], embeddingsByDocId = {}) {
  const docsById = Object.fromEntries(
    documents.map((doc) => [doc.documentId || doc.docId, doc])
  );

  const multiDocClusters = clusters.filter((cluster) => cluster.documentCount > 1);
  const singletonClusters = clusters.filter((cluster) => cluster.documentCount === 1);

  if (!singletonClusters.length || !multiDocClusters.length) {
    return clusters;
  }

  const mergedClusters = multiDocClusters.map((cluster) => ({
    ...cluster,
    documentIds: [...cluster.documentIds],
  }));
  const absorbedSingletonIds = new Set();

  for (const singleton of singletonClusters) {
    const singletonDocId = singleton.documentIds[0];
    const singletonDoc = docsById[singletonDocId];
    if (!singletonDoc) continue;

    let bestIndex = -1;
    let bestScore = 0;

    for (let index = 0; index < mergedClusters.length; index++) {
      const targetCluster = mergedClusters[index];
      const targetDocs = targetCluster.documentIds
        .map((docId) => docsById[docId])
        .filter(Boolean);

      const attachmentScore = scoreSingletonAttachment(
        singletonDoc,
        targetDocs,
        embeddingsByDocId
      );

      const topicOverlap = getClusterTopicOverlapRatio(
        getClusterTopicSet([singletonDoc]),
        getClusterTopicSet(targetDocs)
      );

      const combinedScore = Math.max(attachmentScore, topicOverlap);
      if (combinedScore > bestScore) {
        bestScore = combinedScore;
        bestIndex = index;
      }
    }

    const topicOverlapWithBest =
      bestIndex >= 0
        ? getClusterTopicOverlapRatio(
            getClusterTopicSet([singletonDoc]),
            getClusterTopicSet(
              mergedClusters[bestIndex].documentIds
                .map((docId) => docsById[docId])
                .filter(Boolean)
            )
          )
        : 0;

    const shouldAttach =
      bestIndex >= 0 &&
      (bestScore > SINGLETON_EMBEDDING_THRESHOLD ||
        topicOverlapWithBest > CLUSTER_TOPIC_OVERLAP_THRESHOLD);

    if (shouldAttach) {
      mergedClusters[bestIndex].documentIds.push(singletonDocId);
      absorbedSingletonIds.add(singleton.id);
    }
  }

  const remainingSingletons = singletonClusters.filter(
    (cluster) => !absorbedSingletonIds.has(cluster.id)
  );

  return [...mergedClusters, ...remainingSingletons];
}

/**
 * Merge clusters with similar labels or high shared-topic overlap.
 *
 * @param {object[]} clusters
 * @param {Record<string, number[]>} [labelEmbeddings]
 * @returns {number[][]}
 */
function mergeClusterGroups(clusters = [], labelEmbeddings = {}) {
  const unionFind = new UnionFind(clusters.map((cluster) => cluster.id));
  const topicSets = clusters.map((cluster) => getClusterTopicSet(cluster._docs || []));

  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const labelSimilarity = getLabelSimilarity(
        clusters[i].label,
        clusters[j].label,
        labelEmbeddings
      );
      const topicOverlap = getClusterTopicOverlapRatio(topicSets[i], topicSets[j]);

      if (
        labelSimilarity > LABEL_SIMILARITY_THRESHOLD ||
        topicOverlap > CLUSTER_TOPIC_OVERLAP_THRESHOLD ||
        shouldMergeAgreementClusters(
          clusters[i],
          clusters[j],
          topicSets[i],
          topicSets[j]
        )
      ) {
        unionFind.union(clusters[i].id, clusters[j].id);
      }
    }
  }

  return unionFind.groups();
}

/**
 * Rebuild cluster objects after merging document id groups.
 *
 * @param {string[][]} idGroups
 * @param {object[]} documents
 * @param {object[]} documentEdges
 * @returns {object[]}
 */
function rebuildClusters(idGroups = [], documents = [], documentEdges = []) {
  const {
    computeClusterConfidence,
    deriveClusterLabel,
  } = require("./clusterDocuments");
  const docsById = Object.fromEntries(
    documents.map((doc) => [doc.documentId || doc.docId, doc])
  );

  const semanticEdges = documentEdges.filter(
    (edge) =>
      edge.type !== "document-document" ||
      ["topic", "embedding", "duplicate"].includes(edge.relationshipType)
  );

  return idGroups.map((ids, index) => {
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
      _docs: clusterDocs,
    };
  });
}

/**
 * Consolidate over-segmented clusters by attaching singletons and merging similar labels.
 *
 * @param {object[]} clusters
 * @param {object[]} documents
 * @param {object[]} documentEdges
 * @param {Record<string, number[]>} [embeddingsByDocId]
 * @param {Record<string, number[]>} [labelEmbeddings]
 * @returns {object[]}
 */
function consolidateClusters(
  clusters = [],
  documents = [],
  documentEdges = [],
  embeddingsByDocId = {},
  labelEmbeddings = {}
) {
  if (clusters.length <= 1) {
    return rebuildClusters(
      clusters.map((cluster) => cluster.documentIds),
      documents,
      documentEdges
    ).map(({ _docs, ...cluster }) => cluster);
  }

  const docsById = Object.fromEntries(
    documents.map((doc) => [doc.documentId || doc.docId, doc])
  );

  const clustersWithDocs = clusters.map((cluster) => ({
    ...cluster,
    _docs: cluster.documentIds
      .map((docId) => docsById[docId])
      .filter(Boolean),
  }));

  const afterSingletons = attachSingletonClusters(
    clustersWithDocs,
    documents,
    embeddingsByDocId
  ).map((cluster) => ({
    ...cluster,
    _docs: cluster.documentIds
      .map((docId) => docsById[docId])
      .filter(Boolean),
  }));

  const mergeGroups = mergeClusterGroups(afterSingletons, labelEmbeddings);
  const clusterById = Object.fromEntries(
    afterSingletons.map((cluster) => [cluster.id, cluster])
  );

  const mergedIdGroups = mergeGroups.map((clusterIds) => {
    const docIds = new Set();
    for (const clusterId of clusterIds) {
      for (const docId of clusterById[clusterId]?.documentIds || []) {
        docIds.add(docId);
      }
    }
    return [...docIds];
  });

  return rebuildClusters(mergedIdGroups, documents, documentEdges).map(
    ({ _docs, ...cluster }) => cluster
  );
}

module.exports = {
  AGREEMENT_CATEGORIES,
  AGREEMENT_TOPIC_OVERLAP_THRESHOLD,
  CLUSTER_TOPIC_OVERLAP_THRESHOLD,
  LABEL_SIMILARITY_THRESHOLD,
  LEGAL_AGREEMENT_CLUSTER_ALIASES,
  SINGLETON_EMBEDDING_THRESHOLD,
  attachSingletonClusters,
  computeDominantTopics,
  consolidateClusters,
  getClusterMajorityCategory,
  getClusterTopicJaccardOverlap,
  getClusterTopicOverlapRatio,
  getClusterTopicSet,
  isAgreementMajorityCluster,
  mergeClusterGroups,
  rebuildClusters,
  shouldMergeAgreementClusters,
};
