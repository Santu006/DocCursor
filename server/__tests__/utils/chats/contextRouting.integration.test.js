/* eslint-env jest, node */

jest.mock("../../../models/documents", () => ({
  Document: {
    forWorkspace: jest.fn(),
  },
}));

jest.mock("../../../utils/chats/documentMention", () => ({
  normalizeSelectedDocumentIds: jest.fn(async (_workspaceId, ids = []) => ids),
  hasDocumentMentionScope: jest.fn((ids = []) => ids.length > 0),
}));

const { Document } = require("../../../models/documents");
const {
  resolveContextRouting,
  buildRoutedUserPrompt,
  getRetrievalPlan,
  isInvalidNoAccessResponse,
  applyContextAvailableInstructions,
  WORKSPACE_INTENTS,
} = require("../../../utils/chats/contextRouting");
const {
  performWorkspaceSimilaritySearch,
} = require("../../../utils/chats/projectWideRetrieval");

jest.mock("../../../utils/chats/projectWideRetrieval", () => {
  const actual = jest.requireActual("../../../utils/chats/projectWideRetrieval");
  return {
    ...actual,
    performWorkspaceSimilaritySearch: jest.fn(),
  };
});

const workspaceDocs = [
  {
    docId: "doc-stock",
    filename: "StockReport_2017-06.pdf.json",
    docpath: "custom-documents/StockReport_2017-06.pdf.json",
    metadata: JSON.stringify({ title: "StockReport_2017-06.pdf" }),
  },
  {
    docId: "doc-a1",
    filename: "Agreement1.pdf.json",
    docpath: "custom-documents/Agreement1.pdf.json",
    metadata: JSON.stringify({ title: "Agreement1.pdf" }),
  },
  {
    docId: "doc-a2",
    filename: "Agreement2.pdf.json",
    docpath: "custom-documents/Agreement2.pdf.json",
    metadata: JSON.stringify({ title: "Agreement2.pdf" }),
  },
];

describe("contextRouting integration phase 8.4.3", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Document.forWorkspace.mockResolvedValue(workspaceDocs);
    performWorkspaceSimilaritySearch.mockResolvedValue({
      contextTexts: ["Revenue increased 12% in 2017."],
      sources: [
        {
          id: "1",
          title: "StockReport_2017-06.pdf",
          text: "Revenue increased 12% in 2017.",
          score: 0.8,
        },
      ],
      message: false,
      projectWide: false,
    });
  });

  it("@document summary succeeds with scoped retrieval and clean prompt", async () => {
    const routing = await resolveContextRouting({
      message: "@StockReport_2017-06.pdf Summarize this",
      workspaceId: 1,
      workspaceName: "Santosh",
      indexedDocumentCount: 23,
    });

    await performWorkspaceSimilaritySearch({
      VectorDb: { performSimilaritySearch: jest.fn() },
      workspace: { slug: "santosh", topN: 4, similarityThreshold: 0.25 },
      input: routing.cleanMessage,
      LLMConnector: { embedTextInput: jest.fn() },
      selectedDocumentIds: routing.selectedDocumentIds,
    });

    const prompt = buildRoutedUserPrompt({
      cleanMessage: routing.cleanMessage,
      selectedDocuments: routing.selectedDocuments,
      workspaceIntent: routing.workspaceIntent,
    });

    expect(routing.selectedDocumentIds).toEqual(["doc-stock"]);
    expect(prompt).not.toMatch(/@\w+/);
    expect(
      isInvalidNoAccessResponse("Revenue increased 12%.", 1)
    ).toBe(false);
  });

  it("compare two @documents resolves both IDs", async () => {
    const routing = await resolveContextRouting({
      message: "Compare @Agreement1.pdf with @Agreement2.pdf",
      workspaceId: 1,
      workspaceName: "Santosh",
    });

    expect(routing.selectedDocumentIds).toEqual(["doc-a1", "doc-a2"]);
    expect(routing.cleanMessage).toBe("Compare these documents.");
  });

  it("summarize workspace uses project-wide plan", async () => {
    const routing = await resolveContextRouting({
      message: "Summarize all files in this workspace",
      workspaceId: 1,
      workspaceName: "Santosh",
      indexedDocumentCount: 23,
    });

    expect(routing.workspaceIntent).toBe(WORKSPACE_INTENTS.WORKSPACE_SUMMARY);
    expect(routing.retrievalPlan.runWorkspaceSummary).toBe(true);
    expect(routing.retrievalPlan.forceProjectWide).toBe(false);
    expect(routing.retrievalPlan.runExecutiveReport).toBe(false);
  });

  it("summarise santosh folder routes to workspace summary without crashing plan", async () => {
    const routing = await resolveContextRouting({
      message: "summarise santosh folder",
      workspaceId: 1,
      workspaceName: "Santosh",
      indexedDocumentCount: 23,
    });

    const plan = getRetrievalPlan(routing);
    expect(routing.workspaceIntent).toBe(WORKSPACE_INTENTS.WORKSPACE_SUMMARY);
    expect(plan.runWorkspaceSummary).toBe(true);
    expect(plan.forceProjectWide).toBe(false);
    expect(plan.runWorkspaceGraph).toBe(false);
    expect(plan.runExecutiveReport).toBe(false);

    const prompt = buildRoutedUserPrompt({
      cleanMessage: routing.cleanMessage,
      workspaceName: "Santosh",
      indexedDocumentCount: 23,
      workspaceIntent: routing.workspaceIntent,
    });
    expect(prompt).not.toMatch(/santosh folder/i);
  });

  it("executive report uses exclusive executive handler plan", async () => {
    const routing = await resolveContextRouting({
      message: "Give me an executive report",
      workspaceId: 1,
      workspaceName: "Santosh",
      indexedDocumentCount: 23,
    });

    expect(routing.workspaceIntent).toBe(WORKSPACE_INTENTS.EXECUTIVE_REPORT);
    expect(routing.retrievalPlan.runExecutiveReport).toBe(true);
    expect(routing.retrievalPlan.forceProjectWide).toBe(false);
  });

  it("empty workspace returns zero indexed documents in routing metadata", async () => {
    Document.forWorkspace.mockResolvedValue([]);
    const routing = await resolveContextRouting({
      message: "summarize workspace",
      workspaceId: 1,
      workspaceName: "Empty",
      indexedDocumentCount: 0,
    });

    expect(routing.indexedDocumentCount).toBe(0);
    expect(routing.selectedDocumentIds).toEqual([]);
  });

  it("blocks no-access responses when retrieval returned chunks", () => {
    const systemPrompt = applyContextAvailableInstructions("Base", 2);
    expect(systemPrompt).toContain("Do not claim you lack access");
    expect(
      isInvalidNoAccessResponse("Please upload the document.", 3)
    ).toBe(true);
  });
});
