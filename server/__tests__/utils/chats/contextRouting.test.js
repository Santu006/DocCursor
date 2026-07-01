/* eslint-env jest, node */

jest.mock("../../../models/documents", () => ({
  Document: {
    forWorkspace: jest.fn(),
  },
}));

const { Document } = require("../../../models/documents");
const {
  WORKSPACE_INTENTS,
  parseDocumentMentionsFromMessage,
  detectWorkspaceIntent,
  resolveContextRouting,
  buildRoutedUserPrompt,
  getRetrievalPlan,
  isWorkspaceSummaryQuery,
  isExplicitExecutiveReportQuery,
  stripWorkspaceReferences,
  applyContextAvailableInstructions,
  isInvalidNoAccessResponse,
} = require("../../../utils/chats/contextRouting");

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

describe("contextRouting phase 8.4.3", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Document.forWorkspace.mockResolvedValue(workspaceDocs);
  });

  describe("@document routing", () => {
    it("parses @filename mentions and strips them from the message", () => {
      const result = parseDocumentMentionsFromMessage(
        "@StockReport_2017-06.pdf Summarize this",
        workspaceDocs
      );
      expect(result.cleanMessage).toBe("Summarize this");
      expect(result.resolvedDocIds).toEqual(["doc-stock"]);
    });

    it("handles compare with two @documents", () => {
      const result = parseDocumentMentionsFromMessage(
        "Compare @Agreement1.pdf with @Agreement2.pdf",
        workspaceDocs
      );
      expect(result.cleanMessage).toBe("Compare these documents.");
      expect(result.resolvedDocIds).toEqual(["doc-a1", "doc-a2"]);
    });
  });

  describe("workspace intent detection", () => {
    it("detects workspace summary for summarise santosh folder", () => {
      expect(isWorkspaceSummaryQuery("summarise santosh folder")).toBe(true);
      expect(
        detectWorkspaceIntent("summarise santosh folder", false)
      ).toBe(WORKSPACE_INTENTS.WORKSPACE_SUMMARY);
    });

    it("detects summarize all files and summarize workspace", () => {
      expect(detectWorkspaceIntent("summarize all files", false)).toBe(
        WORKSPACE_INTENTS.WORKSPACE_SUMMARY
      );
      expect(detectWorkspaceIntent("summarize workspace", false)).toBe(
        WORKSPACE_INTENTS.WORKSPACE_SUMMARY
      );
    });

    it("detects executive report separately from workspace summary", () => {
      expect(isExplicitExecutiveReportQuery("Give me an executive report")).toBe(
        true
      );
      expect(detectWorkspaceIntent("Give me an executive report", false)).toBe(
        WORKSPACE_INTENTS.EXECUTIVE_REPORT
      );
    });

    it("uses document scope intent when documents are selected", () => {
      expect(detectWorkspaceIntent("summarize workspace", true)).toBe(
        WORKSPACE_INTENTS.DOCUMENT_SCOPE
      );
    });
  });

  describe("resolveContextRouting", () => {
    it("@document summary resolves scoped IDs and clean message", async () => {
      const result = await resolveContextRouting({
        message: "@StockReport_2017-06.pdf Summarize this",
        workspaceId: 1,
        workspaceName: "Santosh",
        selectedDocumentIds: [],
        indexedDocumentCount: 23,
      });

      expect(result.selectedDocumentIds).toEqual(["doc-stock"]);
      expect(result.cleanMessage).toBe("Summarize this");
      expect(result.workspaceIntent).toBe(WORKSPACE_INTENTS.DOCUMENT_SCOPE);
      expect(result.retrievalPlan.forceProjectWide).toBe(false);
    });

    it("summarise santosh folder becomes workspace summary with stripped names", async () => {
      const result = await resolveContextRouting({
        message: "summarise santosh folder",
        workspaceId: 1,
        workspaceName: "Santosh",
        indexedDocumentCount: 23,
      });

      expect(result.workspaceIntent).toBe(WORKSPACE_INTENTS.WORKSPACE_SUMMARY);
      expect(result.cleanMessage).toBe("Summarize this workspace.");
      expect(result.cleanMessage).not.toMatch(/santosh/i);
      expect(result.retrievalPlan.runExecutiveReport).toBe(false);
      expect(result.retrievalPlan.runWorkspaceGraph).toBe(false);
      expect(result.retrievalPlan.runWorkspaceSummary).toBe(true);
      expect(result.retrievalPlan.forceProjectWide).toBe(false);
    });

    it("missing document mention does not add invalid doc IDs", async () => {
      const result = await resolveContextRouting({
        message: "@Missing-File.pdf Summarize this",
        workspaceId: 1,
        workspaceName: "Santosh",
      });

      expect(result.selectedDocumentIds).toEqual([]);
      expect(result.cleanMessage).toContain("Summarize");
    });
  });

  describe("getRetrievalPlan exclusivity", () => {
    it("prevents executive report and graph when workspace summary is active", () => {
      const plan = getRetrievalPlan({
        workspaceIntent: WORKSPACE_INTENTS.WORKSPACE_SUMMARY,
        documentScopeActive: false,
        cleanMessage: "Summarize this workspace.",
      });
      expect(plan.runExecutiveReport).toBe(false);
      expect(plan.runWorkspaceGraph).toBe(false);
      expect(plan.runWorkspaceSummary).toBe(true);
      expect(plan.forceProjectWide).toBe(false);
    });

    it("scopes retrieval to selected documents only", () => {
      const plan = getRetrievalPlan({
        workspaceIntent: WORKSPACE_INTENTS.DOCUMENT_SCOPE,
        documentScopeActive: true,
        cleanMessage: "Summarize this",
      });
      expect(plan.runExecutiveReport).toBe(false);
      expect(plan.runWorkspaceGraph).toBe(false);
      expect(plan.forceProjectWide).toBe(false);
    });
  });

  describe("buildRoutedUserPrompt", () => {
    it("builds workspace prompt without raw workspace names in question", () => {
      const prompt = buildRoutedUserPrompt({
        cleanMessage: "Summarize this workspace.",
        workspaceName: "Santosh",
        indexedDocumentCount: 23,
        workspaceIntent: WORKSPACE_INTENTS.WORKSPACE_SUMMARY,
      });
      expect(prompt).toContain("Workspace:\nSantosh");
      expect(prompt).toContain("Indexed Documents:\n23");
      expect(prompt).toContain("User Question:\nSummarize this workspace.");
      expect(prompt).not.toContain("@");
    });

    it("builds document-scoped prompt without @mentions", () => {
      const prompt = buildRoutedUserPrompt({
        cleanMessage: "Summarize this document.",
        selectedDocuments: [{ label: "StockReport_2017-06.pdf" }],
        workspaceIntent: WORKSPACE_INTENTS.DOCUMENT_SCOPE,
      });
      expect(prompt).toContain("Selected Documents:");
      expect(prompt).toContain("- StockReport_2017-06.pdf");
      expect(prompt).not.toContain("@StockReport");
    });
  });

  describe("response guard", () => {
    it("flags invalid refusals only when chunks exist", () => {
      expect(
        isInvalidNoAccessResponse("I don't have access to this document.", 2)
      ).toBe(true);
      expect(
        isInvalidNoAccessResponse("I don't have access to this document.", 0)
      ).toBe(false);
      expect(
        isInvalidNoAccessResponse("Revenue grew 12% in 2017.", 3)
      ).toBe(false);
    });

    it("adds context instructions when retrieval succeeded", () => {
      const prompt = applyContextAvailableInstructions("Base", 2);
      expect(prompt).toContain("Do not claim you lack access");
    });
  });

  describe("stripWorkspaceReferences", () => {
    it("removes workspace name and folder from message", () => {
      const stripped = stripWorkspaceReferences(
        "summarise santosh folder",
        "Santosh"
      );
      expect(stripped).toBe("summarise");
      expect(stripped).not.toMatch(/santosh/i);
      expect(stripped).not.toMatch(/folder/i);
    });
  });
});
