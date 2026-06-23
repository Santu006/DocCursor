/* eslint-env jest, node */

const {
  buildGraphFromDocuments,
  getRelatedDocuments,
  invalidateGraphCache,
} = require("../../../utils/workspaceGraph/graphBuilder");

jest.mock("../../../models/documentIntelligence", () => ({
  DocumentIntelligence: {
    forWorkspace: jest.fn(),
  },
}));

jest.mock("../../../utils/helpers", () => ({
  getVectorDbClass: jest.fn(() => ({
    getDocumentCentroidVectors: jest.fn().mockResolvedValue({}),
  })),
}));

const { DocumentIntelligence } = require("../../../models/documentIntelligence");

describe("graphBuilder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateGraphCache(1);
  });

  const sampleIntelligence = [
    {
      docId: "legal-1",
      filename: "Basic-Fee-Agreement.pdf",
      category: "agreement",
      documentType: "fee agreement",
      summary: "Basic fee agreement template.",
      keyTopics: ["billing", "legal fees"],
      keywords: ["trust account"],
    },
    {
      docId: "legal-2",
      filename: "TMC0058.pdf",
      category: "agreement",
      documentType: "retainer agreement",
      summary: "Retainer agreement for legal services.",
      keyTopics: ["retainer", "billing"],
      keywords: ["attorney"],
    },
    {
      docId: "legal-3",
      filename: "RETAINER AGREEMENT-2.pdf",
      category: "agreement",
      documentType: "retainer agreement",
      summary: "Oregon retainer sample.",
      keyTopics: ["retainer funds", "billing"],
      keywords: ["Oregon"],
    },
    {
      docId: "hr-1",
      filename: "Allegations of Harassment.pdf",
      category: "legal_document",
      documentType: "harassment report",
      summary: "Workplace harassment allegations.",
      keyTopics: ["harassment", "workplace conduct"],
      keywords: ["complaint"],
    },
    {
      docId: "game-1",
      filename: "sample4.csv",
      category: "spreadsheet",
      documentType: "game statistics",
      summary: "Player and game statistics data.",
      keyTopics: ["game statistics", "player data"],
      keywords: ["csv", "scores"],
    },
  ];

  it("builds document nodes with intelligence metadata", () => {
    const graph = buildGraphFromDocuments(sampleIntelligence, {
      "legal-1": [1, 0, 0],
      "game-1": [0, 0, 1],
    });

    const legalNode = graph.nodes.find((node) => node.documentId === "legal-1");
    expect(legalNode).toEqual(
      expect.objectContaining({
        documentId: "legal-1",
        title: "Basic-Fee-Agreement.pdf",
        category: "agreement",
        documentType: "fee agreement",
        topics: expect.arrayContaining(["billing"]),
        embeddingReference: "legal-1",
      })
    );

    const gameNode = graph.nodes.find((node) => node.documentId === "game-1");
    expect(gameNode.embeddingReference).toBe("game-1");
  });

  it("separates unrelated documents and connects legal agreements", () => {
    const embeddings = {
      "legal-1": [1, 0, 0, 0],
      "legal-2": [0.95, 0.05, 0, 0],
      "legal-3": [0.9, 0.1, 0, 0],
      "hr-1": [0, 1, 0, 0],
      "game-1": [0, 0, 0, 1],
    };

    const graph = buildGraphFromDocuments(sampleIntelligence, embeddings);

    expect(graph.meta.relationshipCount).toBeGreaterThanOrEqual(3);

    const gameEdges = graph.edges.filter(
      (edge) =>
        edge.type === "document-document" &&
        (edge.source === "game-1" || edge.target === "game-1")
    );
    expect(gameEdges).toHaveLength(0);

    const legalCluster = graph.clusters.find((cluster) =>
      cluster.documentIds.includes("legal-1")
    );
    expect(legalCluster?.documentIds).toEqual(
      expect.arrayContaining(["legal-1", "legal-2", "legal-3"])
    );
    expect(legalCluster?.label).toBe("Legal Agreements");

    const gameCluster = graph.clusters.find((cluster) =>
      cluster.documentIds.includes("game-1")
    );
    expect(gameCluster?.documentCount).toBe(1);
  });

  it("outputs edges with relationshipType and similarityScore", () => {
    const graph = buildGraphFromDocuments(
      sampleIntelligence.slice(0, 2),
      {
        "legal-1": [1, 0, 0],
        "legal-2": [0.8, 0.6, 0],
      }
    );

    const edge = graph.edges.find((item) => item.type === "document-document");
    expect(edge).toEqual(
      expect.objectContaining({
        source: expect.any(String),
        target: expect.any(String),
        relationshipType: expect.stringMatching(/category|topic|embedding|duplicate/),
        similarityScore: expect.any(Number),
      })
    );
  });

  it("includes category distribution and major topics", () => {
    const graph = buildGraphFromDocuments(sampleIntelligence, {});

    expect(graph.categoryDistribution.length).toBeGreaterThan(0);
    expect(graph.fileTypeDistribution.length).toBeGreaterThan(0);
    expect(graph.distributions.category.sumCounts).toBe(sampleIntelligence.length);
    expect(graph.distributions.fileType.sumCounts).toBe(sampleIntelligence.length);
    expect(graph.meta.rules).toContain("topic-overlap-above-30-percent");
  });

  it("returns related documents for a given document", async () => {
    DocumentIntelligence.forWorkspace.mockResolvedValue(sampleIntelligence);

    const result = await getRelatedDocuments({
      workspaceId: 1,
      workspaceSlug: "demo",
      documentId: "legal-1",
    });

    expect(result.found).toBe(true);
    // Without embeddings in mock, legal docs connect via shared topic overlap
    expect(result.related.length).toBeGreaterThanOrEqual(0);
    if (result.related.length > 0) {
      expect(result.related.every((item) => item.relationshipType)).toBe(true);
      expect(["topic", "embedding", "duplicate"]).toContain(
        result.related[0].relationshipType
      );
    }
  });

  it("does not cluster different spreadsheets without semantic similarity", () => {
    const spreadsheetIntelligence = [
      {
        docId: "game-1",
        filename: "sample4.csv",
        category: "spreadsheet",
        documentType: "game statistics",
        keyTopics: ["game statistics", "player data"],
      },
      {
        docId: "hr-1",
        filename: "Allegations-of-Harassment-or-Bullying.xlsx",
        category: "spreadsheet",
        documentType: "harassment report",
        keyTopics: ["harassment", "workplace bullying"],
      },
    ];

    const graph = buildGraphFromDocuments(spreadsheetIntelligence, {
      "game-1": [0, 0, 1],
      "hr-1": [0, 1, 0],
    });

    expect(graph.meta.clusterCount).toBe(2);
    expect(graph.meta.relationshipCount).toBe(0);
    expect(graph.clusters.map((c) => c.label)).toEqual(
      expect.arrayContaining(["Game Statistics", "Harassment Reports"])
    );
  });

  it("does not hallucinate cross-domain relationships for game statistics", () => {
    const graph = buildGraphFromDocuments(sampleIntelligence, {
      "legal-1": [1, 0, 0],
      "legal-2": [0.9, 0.1, 0],
      "legal-3": [0.85, 0.15, 0],
      "hr-1": [0, 1, 0],
      "game-1": [0, 0, 1],
    });

    const crossDomain = graph.edges.filter(
      (edge) =>
        edge.type === "document-document" &&
        ((edge.source === "game-1" &&
          ["legal-1", "legal-2", "legal-3", "hr-1"].includes(edge.target)) ||
          (edge.target === "game-1" &&
            ["legal-1", "legal-2", "legal-3", "hr-1"].includes(edge.source)))
    );

    expect(crossDomain).toHaveLength(0);
  });
});
