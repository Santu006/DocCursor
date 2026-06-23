/* eslint-env jest, node */

const {
  cosineSimilarity,
  evaluateRelationship,
  findDuplicatePairs,
  getTopicOverlap,
  hasCategoryOverlap,
  TOPIC_OVERLAP_THRESHOLD,
  EMBEDDING_SIMILARITY_THRESHOLD,
} = require("../../../utils/workspaceGraph/similarityGraph");

describe("similarityGraph", () => {
  it("computes cosine similarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("detects category overlap", () => {
    expect(
      hasCategoryOverlap({ category: "agreement" }, { category: "Agreement" })
    ).toBe(true);
    expect(
      hasCategoryOverlap({ category: "agreement" }, { category: "spreadsheet" })
    ).toBe(false);
  });

  it("requires topic overlap above 30% threshold", () => {
    const lowOverlap = getTopicOverlap(
      { keyTopics: ["billing", "retainer", "fees", "trust"] },
      { keyTopics: ["game statistics", "player data", "billing"] }
    );
    expect(lowOverlap.ratio).toBeLessThanOrEqual(TOPIC_OVERLAP_THRESHOLD);
    expect(lowOverlap.sharedTopics).toEqual(["billing"]);

    const highOverlap = getTopicOverlap(
      { keyTopics: ["billing", "retainer"] },
      { keyTopics: ["billing", "retainer", "fees"] }
    );
    expect(highOverlap.ratio).toBeGreaterThan(TOPIC_OVERLAP_THRESHOLD);
    expect(highOverlap.sharedTopics).toEqual(
      expect.arrayContaining(["billing", "retainer"])
    );
  });

  it("does not connect documents by category alone", () => {
    const categoryOnly = evaluateRelationship(
      { documentId: "a", category: "agreement", keyTopics: ["fees"] },
      { documentId: "b", category: "agreement", keyTopics: ["billing"] },
      {}
    );
    expect(categoryOnly.shouldConnect).toBe(false);
    expect(categoryOnly.sharesCategory).toBe(true);
    expect(categoryOnly.relationshipType).toBeNull();

    const topicConnected = evaluateRelationship(
      { documentId: "a", category: "agreement", keyTopics: ["billing", "retainer"] },
      { documentId: "b", category: "agreement", keyTopics: ["billing", "retainer", "fees"] },
      {}
    );
    expect(topicConnected.shouldConnect).toBe(true);
    expect(topicConnected.relationshipType).toBe("topic");

    const noRelation = evaluateRelationship(
      {
        documentId: "game",
        category: "spreadsheet",
        keyTopics: ["game statistics"],
      },
      {
        documentId: "legal",
        category: "agreement",
        keyTopics: ["retainer agreement"],
      },
      { game: [0, 0, 1], legal: [1, 0, 0] }
    );
    expect(noRelation.shouldConnect).toBe(false);
  });

  it("creates embedding relationships above threshold", () => {
    const result = evaluateRelationship(
      { documentId: "a", category: "finance", keyTopics: ["revenue"] },
      { documentId: "b", category: "operations", keyTopics: ["logistics"] },
      { a: [1, 0, 0], b: [0.8, 0.6, 0] }
    );
    expect(result.shouldConnect).toBe(true);
    expect(result.relationshipType).toBe("embedding");
    expect(result.similarityScore).toBeGreaterThan(EMBEDDING_SIMILARITY_THRESHOLD);
    expect(result.similarityScore).toBeLessThan(0.95);
  });

  it("detects near-duplicate pairs", () => {
    const pairs = findDuplicatePairs(
      [
        { documentId: "a", title: "doc-a.pdf" },
        { documentId: "b", title: "doc-b.pdf" },
        { documentId: "c", title: "other.csv" },
      ],
      {
        a: [1, 0, 0],
        b: [0.999, 0.001, 0],
        c: [0, 1, 0],
      }
    );

    expect(pairs).toHaveLength(1);
    expect(pairs[0].relationshipType).toBe("duplicate");
    expect(pairs[0].similarityScore).toBeGreaterThanOrEqual(0.95);
  });
});
