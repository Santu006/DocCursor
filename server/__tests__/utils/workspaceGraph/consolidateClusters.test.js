/* eslint-env jest, node */

const {
  attachSingletonClusters,
  consolidateClusters,
  computeDominantTopics,
  getClusterTopicOverlapRatio,
  getClusterTopicSet,
} = require("../../../utils/workspaceGraph/consolidateClusters");
const { clusterDocuments } = require("../../../utils/workspaceGraph/clusterDocuments");
const { getLabelSimilarity } = require("../../../utils/workspaceGraph/labelEmbedding");

describe("consolidateClusters", () => {
  const legalDocuments = [
    {
      documentId: "legal-1",
      title: "Basic-Fee-Agreement.pdf",
      category: "agreement",
      documentType: "fee agreement",
      topics: ["billing", "legal fees"],
    },
    {
      documentId: "legal-2",
      title: "TMC0058.pdf",
      category: "agreement",
      documentType: "retainer agreement",
      topics: ["retainer", "billing"],
    },
    {
      documentId: "legal-3",
      title: "RETAINER AGREEMENT-2.pdf",
      category: "agreement",
      documentType: "retainer agreement",
      topics: ["retainer funds", "billing"],
    },
  ];

  it("merges agreement clusters with topic overlap above 30%", () => {
    const documents = [
      {
        documentId: "legal-1",
        title: "retainer-a.pdf",
        category: "agreement",
        topics: ["confidentiality", "billing"],
      },
      {
        documentId: "legal-2",
        title: "retainer-b.pdf",
        category: "agreement",
        topics: ["legal representation", "billing"],
      },
      {
        documentId: "legal-3",
        title: "fee-template.pdf",
        category: "agreement",
        topics: ["legal services", "billing"],
      },
    ];

    const initialClusters = [
      {
        id: "cluster-1",
        label: "Confidentiality",
        documentIds: ["legal-1"],
        documentCount: 1,
      },
      {
        id: "cluster-2",
        label: "Legal Representation",
        documentIds: ["legal-2"],
        documentCount: 1,
      },
      {
        id: "cluster-3",
        label: "Legal Services",
        documentIds: ["legal-3"],
        documentCount: 1,
      },
    ];

    const consolidated = consolidateClusters(initialClusters, documents, []);

    expect(consolidated).toHaveLength(1);
    expect(consolidated[0].label).toBe("Legal Agreements");
    expect(consolidated[0].documentCount).toBe(3);
  });

  it("merges legal agreement singletons into one Legal Agreements cluster", () => {
    const initialClusters = legalDocuments.map((doc, index) => ({
      id: `cluster-${index + 1}`,
      label:
        index === 0
          ? "Legal Services"
          : index === 1
            ? "Legal Representation"
            : "Limited Legal Services",
      documentIds: [doc.documentId],
      documentCount: 1,
    }));

    const labelEmbeddings = {
      "legal services": [1, 0, 0, 0],
      "legal representation": [0.95, 0.05, 0, 0],
      "limited legal services": [0.9, 0.1, 0, 0],
    };

    const consolidated = consolidateClusters(
      initialClusters,
      legalDocuments,
      [],
      {},
      labelEmbeddings
    );

    expect(consolidated).toHaveLength(1);
    expect(consolidated[0].label).toBe("Legal Agreements");
    expect(consolidated[0].documentCount).toBe(3);
    expect(consolidated[0].documentIds).toEqual(
      expect.arrayContaining(["legal-1", "legal-2", "legal-3"])
    );
    expect(consolidated[0].dominantTopics).toEqual(
      expect.arrayContaining(["Billing"])
    );
    expect(consolidated[0].confidence).toEqual(expect.any(Number));
  });

  it("attaches a singleton to a nearby multi-document cluster via embeddings", () => {
    const documents = [
      {
        documentId: "legal-1",
        title: "retainer-a.pdf",
        category: "agreement",
        topics: ["billing"],
      },
      {
        documentId: "legal-2",
        title: "retainer-b.pdf",
        category: "agreement",
        topics: ["fees"],
      },
      {
        documentId: "legal-3",
        title: "fee-template.pdf",
        category: "agreement",
        topics: ["template"],
      },
    ];

    const clusters = [
      {
        id: "cluster-1",
        label: "Legal Agreements",
        documentIds: ["legal-1", "legal-2"],
        documentCount: 2,
      },
      {
        id: "cluster-2",
        label: "Fee Templates",
        documentIds: ["legal-3"],
        documentCount: 1,
      },
    ];

    const embeddings = {
      "legal-1": [1, 0, 0],
      "legal-2": [0.95, 0.05, 0],
      "legal-3": [0.92, 0.08, 0],
    };

    const attached = attachSingletonClusters(clusters, documents, embeddings);
    const multiCluster = attached.find((cluster) =>
      cluster.documentIds.includes("legal-1")
    );

    expect(multiCluster.documentIds).toEqual(
      expect.arrayContaining(["legal-1", "legal-2", "legal-3"])
    );
    expect(attached.filter((cluster) => cluster.documentCount === 1)).toHaveLength(
      0
    );
  });

  it("merges clusters when shared topics exceed 50%", () => {
    const topicsA = getClusterTopicSet([
      { topics: ["harassment", "workplace conduct", "complaint"] },
    ]);
    const topicsB = getClusterTopicSet([
      { topics: ["harassment", "workplace bullying", "complaint"] },
    ]);

    expect(getClusterTopicOverlapRatio(topicsA, topicsB)).toBeGreaterThan(0.5);
  });

  it("computes dominantTopics from majority document topics", () => {
    const dominantTopics = computeDominantTopics([
      { topics: ["billing", "retainer"] },
      { topics: ["billing", "fees"] },
      { topics: ["billing", "trust account"] },
    ]);

    expect(dominantTopics).toEqual(["Billing"]);
  });
});

describe("clusterDocuments consolidation integration", () => {
  it("keeps Basic-Fee-Agreement, TMC0058, and RETAINER AGREEMENT-2 in one cluster", () => {
    const documents = [
      {
        documentId: "legal-1",
        title: "Basic-Fee-Agreement.pdf",
        category: "agreement",
        documentType: "fee agreement",
        topics: ["billing", "legal fees"],
      },
      {
        documentId: "legal-2",
        title: "TMC0058.pdf",
        category: "agreement",
        documentType: "retainer agreement",
        topics: ["retainer", "billing"],
      },
      {
        documentId: "legal-3",
        title: "RETAINER AGREEMENT-2.pdf",
        category: "agreement",
        documentType: "retainer agreement",
        topics: ["retainer funds", "billing"],
      },
      {
        documentId: "game-1",
        title: "sample4.csv",
        category: "spreadsheet",
        documentType: "game statistics",
        topics: ["game statistics"],
      },
    ];

    const embeddings = {
      "legal-1": [1, 0, 0, 0],
      "legal-2": [0.95, 0.05, 0, 0],
      "legal-3": [0.9, 0.1, 0, 0],
      "game-1": [0, 0, 0, 1],
    };

    const edges = [
      {
        type: "document-document",
        source: "legal-1",
        target: "legal-2",
        relationshipType: "embedding",
        similarityScore: 0.92,
      },
      {
        type: "document-document",
        source: "legal-2",
        target: "legal-3",
        relationshipType: "embedding",
        similarityScore: 0.9,
      },
    ];

    const clusters = clusterDocuments(documents, edges, { embeddingsByDocId: embeddings });

    const legalCluster = clusters.find((cluster) =>
      cluster.documentIds.includes("legal-1")
    );

    expect(legalCluster).toBeDefined();
    expect(legalCluster.label).toBe("Legal Agreements");
    expect(legalCluster.documentIds).toEqual(
      expect.arrayContaining(["legal-1", "legal-2", "legal-3"])
    );
    expect(legalCluster.documentCount).toBe(3);
    expect(legalCluster.dominantTopics).toEqual(
      expect.arrayContaining(["Billing"])
    );

    const gameCluster = clusters.find((cluster) =>
      cluster.documentIds.includes("game-1")
    );
    expect(gameCluster?.documentCount).toBe(1);
    expect(gameCluster?.label).toBe("Game Statistics");
  });
});

describe("labelEmbedding", () => {
  it("returns high similarity for near-identical label vectors", () => {
    expect(
      getLabelSimilarity("Legal Services", "Legal Representation", {
        "legal services": [1, 0, 0],
        "legal representation": [0.95, 0.05, 0],
      })
    ).toBeGreaterThan(0.8);
  });
});
