/* eslint-env jest, node */

jest.mock("../../../utils/workspaceReport", () => ({
  buildWorkspaceReport: jest.fn(),
}));

jest.mock("../../../models/documentIntelligence", () => ({
  DocumentIntelligence: {
    loadAllComplete: jest.fn(),
  },
}));

const { buildWorkspaceReport } = require("../../../utils/workspaceReport");
const { DocumentIntelligence } = require("../../../models/documentIntelligence");
const {
  DOCUMENT_TABLE_PAGE_SIZE,
  sanitizeResponseQuality,
  detectWorkspaceDomain,
  extractDateRange,
  aggregateIntelligenceRollups,
  buildDocumentSummaryTable,
  buildHierarchicalWorkspaceSummary,
  assembleHierarchicalResponse,
  performWorkspaceSummaryQuery,
  toOneLineSummary,
} = require("../../../utils/chats/workspaceSummaryRetrieval");

function makeDoc(index, overrides = {}) {
  const month = String(index).padStart(2, "0");
  const year = index <= 12 ? 2016 : 2017;
  return {
    filename: `StockReport_${year}-${month}.pdf`,
    category: "stock report",
    documentType: "report",
    fileType: "pdf",
    summary: `Monthly stock report ${year}-${month} covering inventory and sales.`,
    keyTopics: ["inventory", "sales"],
    keywords: ["units sold", "units in stock"],
    ...overrides,
  };
}

const stockReport = {
  meta: { documentCount: 23 },
  categoryDistribution: [{ label: "stock report", count: 18 }],
  fileTypeDistribution: [
    { label: "pdf", count: 18 },
    { label: "xlsx", count: 3 },
    { label: "csv", count: 2 },
  ],
  topTopics: [
    { topic: "inventory", count: 12 },
    { topic: "sales", count: 10 },
    { topic: "units sold", count: 8 },
  ],
  clusters: [{ id: 1 }, { id: 2 }],
  duplicates: [],
  executiveSummary: {
    kpis: {
      documents: 23,
      categories: 1,
      topics: 12,
      duplicates: 0,
    },
  },
};

describe("workspaceSummaryRetrieval phase 8.5", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    buildWorkspaceReport.mockResolvedValue(stockReport);
  });

  describe("document catalog", () => {
    it("reuses stored summaries without LLM regeneration", () => {
      const intelligence = [
        makeDoc(1, { summary: "Stored summary A." }),
        makeDoc(2, { summary: "Stored summary B." }),
      ];

      const table = buildDocumentSummaryTable(intelligence);
      expect(table).toContain("| Document | Summary |");
      expect(table).toContain("Stored summary A.");
      expect(table).toContain("Stored summary B.");
      expect(table).not.toContain("LLM");
    });

    it("shows one row per document for a 23-document workspace", () => {
      const intelligence = Array.from({ length: 23 }, (_, index) =>
        makeDoc(index + 1)
      );
      const table = buildDocumentSummaryTable(intelligence);

      const rowCount = table
        .split("\n")
        .filter((line) => line.startsWith("| StockReport_")).length;
      expect(rowCount).toBe(23);
    });

    it("paginates document tables beyond 50 documents", () => {
      const intelligence = Array.from({ length: 75 }, (_, index) =>
        makeDoc(index + 1, {
          filename: `Report_${String(index + 1).padStart(3, "0")}.pdf`,
          summary: `Summary ${index + 1}`,
        })
      );

      const table = buildDocumentSummaryTable(intelligence);
      const rowCount = table
        .split("\n")
        .filter((line) => line.startsWith("| Report_")).length;

      expect(rowCount).toBe(DOCUMENT_TABLE_PAGE_SIZE);
      expect(table).toContain(`of 75`);
    });
  });

  describe("aggregateIntelligenceRollups", () => {
    it("aggregates recurring topics, entities, and metrics", () => {
      const intelligence = Array.from({ length: 5 }, (_, index) => makeDoc(index + 1));
      const rollups = aggregateIntelligenceRollups(intelligence, stockReport);

      expect(rollups.documentCount).toBe(5);
      expect(rollups.topTopics.length).toBeGreaterThan(0);
      expect(rollups.recurringEntities.length).toBeGreaterThan(0);
      expect(rollups.dateRange).toContain("2016");
    });
  });

  describe("buildHierarchicalWorkspaceSummary", () => {
    it("builds overview and document table before synthesis", () => {
      const intelligence = Array.from({ length: 23 }, (_, index) =>
        makeDoc(index + 1)
      );
      const rollups = aggregateIntelligenceRollups(intelligence, stockReport);
      const hierarchical = buildHierarchicalWorkspaceSummary({
        rollups,
        intelligence,
        report: stockReport,
        workspaceName: "Santosh",
      });

      expect(hierarchical.deterministicPrefix).toContain("# Workspace Summary");
      expect(hierarchical.deterministicPrefix).toContain("## Overview");
      expect(hierarchical.deterministicPrefix).toContain(
        "## Document Summary Table"
      );
      expect(hierarchical.deterministicPrefix).toContain("**Workspace:** Santosh");
      expect(hierarchical.synthesisUserPrompt).toContain(
        "Document catalog (pre-indexed summaries"
      );
      expect(hierarchical.metadata.documentTable.total).toBe(23);
    });
  });

  describe("assembleHierarchicalResponse", () => {
    it("assembles catalog + synthesis + recurring metrics once", () => {
      const text = assembleHierarchicalResponse({
        deterministicPrefix:
          "# Workspace Summary\n\n## Overview\n\n23 docs\n\n## Document Summary Table\n\n| Document | Summary |",
        synthesisSections:
          "## Overall Insights\nWorkspace overview.\n\n## Common Themes\n• inventory",
        recurringMetricsSection:
          "## Recurring Metrics\n• Units Sold (appears in 8 document summaries)",
      });

      expect(text.match(/# Workspace Summary/g)).toHaveLength(1);
      expect(text).toContain("## Document Summary Table");
      expect(text).toContain("## Overall Insights");
      expect(text).toContain("## Recurring Metrics");
    });
  });

  describe("performWorkspaceSummaryQuery", () => {
    it("requests synthesis for populated workspaces", async () => {
      DocumentIntelligence.loadAllComplete.mockResolvedValue(
        Array.from({ length: 23 }, (_, index) => makeDoc(index + 1))
      );

      const result = await performWorkspaceSummaryQuery({
        workspace: { id: 1, slug: "santosh", name: "Santosh" },
        message: "Summarize all files in this workspace",
      });

      expect(result.handled).toBe(true);
      expect(result.synthesisRequired).toBe(true);
      expect(result.deterministicPrefix).toContain("## Document Summary Table");
      expect(result.metadata.documents).toBe(23);
      expect(DocumentIntelligence.loadAllComplete).toHaveBeenCalledWith(1);
    });

    it("handles empty workspaces without synthesis", async () => {
      DocumentIntelligence.loadAllComplete.mockResolvedValue([]);

      const result = await performWorkspaceSummaryQuery({
        workspace: { id: 2, slug: "empty", name: "Empty" },
        message: "summarize workspace",
      });

      expect(result.directResponse).toContain("**Total documents:** 0");
      expect(result.synthesisRequired).toBeFalsy();
    });

    it("ignores non-workspace-summary queries", async () => {
      const result = await performWorkspaceSummaryQuery({
        workspace: { id: 1, slug: "santosh", name: "Santosh" },
        message: "What is the revenue in June 2017?",
      });

      expect(result.handled).toBe(false);
      expect(DocumentIntelligence.loadAllComplete).not.toHaveBeenCalled();
    });
  });

  describe("sanitizeResponseQuality", () => {
    it("removes duplicate sections from assembled responses", () => {
      const input = [
        "## Overall Insights",
        "Same paragraph.",
        "",
        "## Overall Insights",
        "Same paragraph.",
      ].join("\n");

      const output = sanitizeResponseQuality(input);
      expect(output.match(/## Overall Insights/g)).toHaveLength(1);
      expect(output.match(/Same paragraph/g)).toHaveLength(1);
    });
  });

  describe("toOneLineSummary", () => {
    it("truncates long summaries for table cells", () => {
      const long = "x".repeat(200);
      expect(toOneLineSummary(long).length).toBeLessThanOrEqual(160);
    });
  });
});
