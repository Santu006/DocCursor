/* eslint-env jest, node */

const {
  isWorkspaceGraphQuery,
  classifyGraphQuery,
  formatGraphContext,
} = require("../../../utils/chats/workspaceGraphRetrieval");

describe("workspaceGraphRetrieval", () => {
  it("detects workspace graph queries", () => {
    expect(isWorkspaceGraphQuery("What are the major topics?")).toBe(true);
    expect(isWorkspaceGraphQuery("Which documents are related?")).toBe(true);
    expect(isWorkspaceGraphQuery("Show document clusters")).toBe(true);
    expect(isWorkspaceGraphQuery("Find duplicate files")).toBe(true);
    expect(isWorkspaceGraphQuery("Summarise all files")).toBe(false);
  });

  it("classifies graph query intent", () => {
    expect(classifyGraphQuery("What are the major topics?")).toBe("major-topics");
    expect(classifyGraphQuery("Which agreements discuss billing?")).toBe(
      "topic-search"
    );
    expect(classifyGraphQuery("Find near-duplicate documents")).toBe("duplicates");
  });

  it("formats graph context without inventing relationships", () => {
    const graph = {
      meta: { documentCount: 2, clusterCount: 2, relationshipCount: 0 },
      majorTopics: [{ topic: "Game Statistics", documentCount: 1 }],
      clusters: [
        {
          label: "Game Statistics",
          documentCount: 1,
          documents: [{ title: "sample4.csv" }],
        },
        {
          label: "Legal Agreements",
          documentCount: 1,
          documents: [{ title: "retainer.pdf" }],
        },
      ],
      categoryDistribution: [
        { key: "agreement", label: "Legal Agreements", count: 1, percentage: 50 },
        { key: "spreadsheet", label: "Spreadsheet", count: 1, percentage: 50 },
      ],
      fileTypeDistribution: [
        { key: "pdf", label: "PDF", count: 1, percentage: 50 },
        { key: "csv", label: "CSV", count: 1, percentage: 50 },
      ],
      duplicates: [],
      edges: [],
      nodes: [],
    };

    const context = formatGraphContext(graph, "Show document clusters");
    expect(context).toContain("Game Statistics");
    expect(context).toContain("Legal Agreements");
    expect(context).toContain("no LLM speculation");
    expect(context).not.toContain("sample4.csv is related to retainer");
  });
});
