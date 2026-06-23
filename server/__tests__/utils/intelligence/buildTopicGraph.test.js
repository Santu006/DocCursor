/* eslint-env jest, node */

const {
  buildWorkspaceTopicGraph,
  getTopicOverlap,
  hasCategoryOverlap,
  cosineSimilarity,
} = require("../../../utils/intelligence/buildTopicGraph");
const { invalidateGraphCache } = require("../../../utils/workspaceGraph/graphBuilder");

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

describe("buildWorkspaceTopicGraph (shim)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateGraphCache(1);
  });

  it("creates topic mappings without speculative document edges", async () => {
    DocumentIntelligence.forWorkspace.mockResolvedValue([
      {
        docId: "legal-1",
        filename: "retainer.pdf",
        category: "agreement",
        keyTopics: ["billing", "retainer"],
        keywords: [],
      },
      {
        docId: "game-1",
        filename: "player-stats.csv",
        category: "spreadsheet",
        keyTopics: ["game statistics", "player data"],
        keywords: [],
      },
    ]);

    const graph = await buildWorkspaceTopicGraph({
      workspaceId: 1,
      workspaceSlug: "demo",
      embeddingsByDocId: {},
      skipCache: true,
    });

    expect(graph.meta.documentCount).toBe(2);
    expect(graph.meta.clusterCount).toBe(2);
    expect(graph.meta.relationshipCount).toBe(0);
  });

  it("links documents when topic or embedding rules match", async () => {
    DocumentIntelligence.forWorkspace.mockResolvedValue([
      {
        docId: "legal-1",
        filename: "retainer-a.pdf",
        category: "agreement",
        keyTopics: ["billing"],
        keywords: [],
      },
      {
        docId: "legal-2",
        filename: "retainer-b.pdf",
        category: "agreement",
        keyTopics: ["fees"],
        keywords: [],
      },
      {
        docId: "harass-1",
        filename: "complaint.pdf",
        category: "legal_document",
        keyTopics: ["harassment"],
        keywords: [],
      },
      {
        docId: "game-1",
        filename: "stats.csv",
        category: "spreadsheet",
        keyTopics: ["game statistics"],
        keywords: [],
      },
    ]);

    const graph = await buildWorkspaceTopicGraph({
      workspaceId: 1,
      workspaceSlug: "demo",
      embeddingsByDocId: {
        "legal-1": [1, 0, 0],
        "legal-2": [0.8, 0.6, 0],
        "harass-1": [0, 1, 0],
        "game-1": [0, 0, 1],
      },
      skipCache: true,
    });

    expect(graph.meta.relationshipCount).toBeGreaterThanOrEqual(1);
    expect(graph.clusters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Legal Agreements", documentCount: 2 }),
      ])
    );
  });
});

describe("topic graph helpers (shim)", () => {
  it("detects category overlap", () => {
    expect(
      hasCategoryOverlap({ category: "agreement" }, { category: "agreement" })
    ).toBe(true);
  });

  it("returns topic overlap ratio", () => {
    const overlap = getTopicOverlap(
      { keyTopics: ["billing", "retainer"] },
      { keyTopics: ["billing", "retainer", "fees"] }
    );
    expect(overlap.sharedTopics).toEqual(
      expect.arrayContaining(["billing", "retainer"])
    );
    expect(overlap.ratio).toBeGreaterThan(0);
  });

  it("computes cosine similarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
  });
});
