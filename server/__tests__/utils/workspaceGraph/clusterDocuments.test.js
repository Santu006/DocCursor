/* eslint-env jest, node */

const {
  clusterDocuments,
  computeClusterConfidence,
  deriveClusterLabel,
} = require("../../../utils/workspaceGraph/clusterDocuments");

describe("clusterDocuments", () => {
  it("groups semantically connected documents into clusters", () => {
    const documents = [
      {
        documentId: "legal-1",
        title: "retainer-a.pdf",
        category: "agreement",
        documentType: "retainer agreement",
        topics: ["billing"],
      },
      {
        documentId: "legal-2",
        title: "retainer-b.pdf",
        category: "agreement",
        documentType: "fee agreement",
        topics: ["fees"],
      },
      {
        documentId: "game-1",
        title: "sample4.csv",
        category: "spreadsheet",
        documentType: "game statistics",
        topics: ["game statistics"],
      },
    ];

    const edges = [
      {
        type: "document-document",
        source: "legal-1",
        target: "legal-2",
        relationshipType: "embedding",
        similarityScore: 0.92,
      },
    ];

    const clusters = clusterDocuments(documents, edges);

    expect(clusters).toHaveLength(2);
    expect(clusters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Legal Agreements",
          documentCount: 2,
          documentIds: expect.arrayContaining(["legal-1", "legal-2"]),
          confidence: expect.any(Number),
          dominantTopics: expect.any(Array),
        }),
        expect.objectContaining({
          label: "Game Statistics",
          documentCount: 1,
          documentIds: ["game-1"],
        }),
      ])
    );
  });

  it("does not cluster spreadsheets together without semantic edges", () => {
    const documents = [
      {
        documentId: "game-1",
        title: "sample4.csv",
        category: "spreadsheet",
        documentType: "game statistics",
        topics: ["game statistics", "player data"],
      },
      {
        documentId: "hr-1",
        title: "Allegations-of-Harassment-or-Bullying.xlsx",
        category: "spreadsheet",
        documentType: "harassment report",
        topics: ["harassment", "workplace bullying"],
      },
    ];

    const clusters = clusterDocuments(documents, []);

    expect(clusters).toHaveLength(2);
    expect(clusters.map((cluster) => cluster.label)).toEqual(
      expect.arrayContaining(["Game Statistics", "Harassment Reports"])
    );
  });

  it("names harassment report clusters from dominant topics", () => {
    expect(
      deriveClusterLabel([
        {
          title: "Allegations-of-Harassment-or-Bullying.xlsx",
          category: "spreadsheet",
          documentType: "harassment report",
          topics: ["harassment", "workplace conduct"],
        },
      ])
    ).toBe("Harassment Reports");
  });

  it("avoids PDF metadata labels like Pdf Bookmarks", () => {
    expect(
      deriveClusterLabel([
        {
          title: "manual.pdf",
          category: "technical_documentation",
          documentType: "pdf bookmarks",
          topics: ["pdf bookmarks"],
        },
      ])
    ).toBe("Technical Documentation");
  });

  it("computes cluster confidence from semantic edge scores", () => {
    const confidence = computeClusterConfidence(
      [{ documentId: "a" }, { documentId: "b" }],
      [
        {
          relationshipType: "embedding",
          similarityScore: 0.96,
        },
      ]
    );

    expect(confidence).toBe(96);
  });
});
