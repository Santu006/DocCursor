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

jest.mock("../../../utils/chats/workspaceSummaryRetrieval", () => {
  const actual = jest.requireActual(
    "../../../utils/chats/workspaceSummaryRetrieval"
  );
  return {
    ...actual,
    performWorkspaceSummaryQuery: jest.fn(),
  };
});

const { Document } = require("../../../models/documents");
const {
  resolveContextRouting,
  getRetrievalPlan,
  WORKSPACE_INTENTS,
} = require("../../../utils/chats/contextRouting");
const {
  performWorkspaceSummaryQuery,
  sanitizeResponseQuality,
} = require("../../../utils/chats/workspaceSummaryRetrieval");

const workspaceDocs = [
  {
    docId: "doc-stock",
    filename: "StockReport_2017-06.pdf.json",
    metadata: JSON.stringify({ title: "StockReport_2017-06.pdf" }),
  },
];

describe("workspace summary integration phase 8.4.4", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Document.forWorkspace.mockResolvedValue(workspaceDocs);
    performWorkspaceSummaryQuery.mockResolvedValue({
      handled: true,
      synthesisRequired: true,
      deterministicPrefix: [
        "# Workspace Summary",
        "",
        "## Overview",
        "",
        "**Total documents:** 23",
        "",
        "## Document Summary Table",
        "",
        "| Document | Summary |",
        "| --- | --- |",
        "| StockReport_2017-06.pdf | June stock report. |",
      ].join("\n"),
      synthesisSystemPrompt: "synthesis system",
      synthesisUserPrompt: "synthesis user",
      recurringMetricsSection: "## Recurring Metrics\n• Units Sold (appears in 8 document summaries)",
      fallbackSynthesisSections: "## Overall Insights\nFallback.",
      metadata: {
        documents: 23,
        documentTypes: 3,
        topics: 12,
        categories: 5,
        duplicates: 0,
        documentTable: { total: 23, page: 1, pageSize: 50, hasMore: false },
      },
      sources: [],
    });
  });

  it("routes workspace summary to the dedicated handler only", async () => {
    const routing = await resolveContextRouting({
      message: "summarise santosh folder",
      workspaceId: 1,
      workspaceName: "Santosh",
      indexedDocumentCount: 23,
    });

    const plan = getRetrievalPlan(routing);
    expect(routing.workspaceIntent).toBe(WORKSPACE_INTENTS.WORKSPACE_SUMMARY);
    expect(plan.runWorkspaceSummary).toBe(true);
    expect(plan.runExecutiveReport).toBe(false);
    expect(plan.runWorkspaceGraph).toBe(false);
    expect(plan.forceProjectWide).toBe(false);
  });

  it("direct workspace summary response contains only one copy of each section", async () => {
    const duplicated = [
      "# Workspace Summary",
      "",
      "**Documents:** 23",
      "",
      "# Workspace Summary",
      "",
      "**Documents:** 23",
      "",
      "**Key Insights**",
      "• Reports are organized monthly.",
      "• Reports are organized monthly.",
    ].join("\n");

    const cleaned = sanitizeResponseQuality(duplicated);
    expect(cleaned.match(/# Workspace Summary/g)).toHaveLength(1);
    expect(cleaned.match(/\*\*Documents:\*\* 23/g)).toHaveLength(1);
    expect(cleaned.match(/Reports are organized monthly/g)).toHaveLength(1);
  });

  it("performWorkspaceSummaryQuery produces a single structured summary payload", async () => {
    const result = await performWorkspaceSummaryQuery({
      workspace: { id: 1, slug: "santosh", name: "Santosh" },
      message: "Summarize all files in this workspace",
    });

    expect(result.handled).toBe(true);
    expect(result.synthesisRequired).toBe(true);
    expect(result.deterministicPrefix).toContain("# Workspace Summary");
    expect(result.deterministicPrefix).toContain("## Document Summary Table");
    expect(result.metadata.documents).toBe(23);
  });
});
