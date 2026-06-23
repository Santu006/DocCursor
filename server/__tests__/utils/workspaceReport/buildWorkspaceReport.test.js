/* eslint-env jest, node */

const {
  buildExecutiveSummary,
  buildFactualSummary,
} = require("../../../utils/workspaceReport/executiveSummary");
const { containsAdvisoryLanguage } = require("../../../utils/workspaceReport/objectivity");
const {
  buildWorkspaceReport,
  formatReportAsContext,
  invalidateReportCache,
} = require("../../../utils/workspaceReport/buildWorkspaceReport");
const { buildReviewOrder } = require("../../../utils/workspaceReport/recommendationEngine");
const { clusterDocuments } = require("../../../utils/workspaceGraph/clusterDocuments");

jest.mock("../../../models/documentIntelligence", () => ({
  DocumentIntelligence: {
    forWorkspace: jest.fn(),
    getWorkspaceOverview: jest.fn(),
    statusCounts: jest.fn(),
  },
}));

jest.mock("../../../models/documentComparisons", () => ({
  DocumentComparisons: {
    dashboard: jest.fn(),
    forWorkspace: jest.fn(),
  },
}));

jest.mock("../../../models/documents", () => ({
  Document: {
    forWorkspace: jest.fn(),
  },
}));

jest.mock("../../../utils/workspaceGraph/graphBuilder", () => ({
  buildWorkspaceGraph: jest.fn(),
}));

const { DocumentIntelligence } = require("../../../models/documentIntelligence");
const { DocumentComparisons } = require("../../../models/documentComparisons");
const { Document } = require("../../../models/documents");
const { buildWorkspaceGraph } = require("../../../utils/workspaceGraph/graphBuilder");

describe("executiveSummary", () => {
  it("builds a single factual summary paragraph", () => {
    const summary = buildFactualSummary({
      documentCount: 5,
      categoryCount: 3,
      topCategory: { label: "Legal Agreements", percentage: 60 },
      duplicateCount: 0,
      highRiskDocumentCount: 1,
      clusterCount: 3,
    });

    expect(summary).toContain("5 documents");
    expect(summary).toContain("3 categories");
    expect(summary).toContain("Legal Agreements is the dominant category (60%)");
    expect(summary).toContain("No duplicate files detected");
    expect(summary).toContain("One document is classified as high risk");
    expect(containsAdvisoryLanguage(summary)).toBe(false);
  });
});

describe("buildWorkspaceReport", () => {
  const workspace = { id: 1, slug: "demo", name: "Demo Workspace" };

  beforeEach(() => {
    jest.clearAllMocks();
    invalidateReportCache(1);

    DocumentIntelligence.forWorkspace.mockResolvedValue([
      {
        docId: "legal-1",
        filename: "RETAINER AGREEMENT-2.pdf",
        category: "agreement",
        status: "complete",
        summary: "Retainer agreement with billing terms.",
        keyTopics: ["billing"],
        keywords: [],
        confidenceScore: 0.9,
      },
      {
        docId: "legal-2",
        filename: "TMC0058.pdf",
        category: "agreement",
        status: "complete",
        summary: "Fee agreement.",
        keyTopics: ["billing"],
        keywords: [],
        confidenceScore: 0.9,
      },
      {
        docId: "game-1",
        filename: "sample4.csv",
        category: "spreadsheet",
        status: "complete",
        summary: "Game statistics data.",
        keyTopics: ["game statistics"],
        keywords: [],
        confidenceScore: 0.95,
      },
    ]);

    DocumentIntelligence.getWorkspaceOverview.mockResolvedValue({
      documents: 3,
      categories: [{ category: "agreement", count: 2 }],
      topTopics: [{ topic: "billing", count: 2 }],
      fileTypes: { pdf: 2, csv: 1 },
    });

    DocumentIntelligence.statusCounts.mockResolvedValue({
      total: 3,
      complete: 3,
      pending: 0,
      processing: 0,
      failed: 0,
    });

    DocumentComparisons.dashboard.mockResolvedValue({
      totalReviews: 0,
      averageRiskScore: 0,
      highRiskReviews: 0,
      recentReviews: [],
    });

    DocumentComparisons.forWorkspace.mockResolvedValue([]);
    Document.forWorkspace.mockResolvedValue([{ docId: "legal-1" }]);

    buildWorkspaceGraph.mockResolvedValue({
      clusters: [
        {
          id: "cluster-1",
          label: "Legal Agreements",
          documentCount: 2,
          confidence: 85,
          dominantTopics: ["Billing"],
          topics: ["Billing"],
          documents: [
            { title: "RETAINER AGREEMENT-2.pdf" },
            { title: "TMC0058.pdf" },
          ],
          documentIds: ["legal-1", "legal-2"],
        },
        {
          id: "cluster-2",
          label: "Game Statistics",
          documentCount: 1,
          confidence: 95,
          dominantTopics: ["Game Statistics"],
          topics: ["Game Statistics"],
          documents: [{ title: "sample4.csv" }],
          documentIds: ["game-1"],
        },
      ],
      duplicates: [],
      majorTopics: [{ topic: "Billing", documentCount: 2 }],
      categoryDistribution: [
        { key: "agreement", label: "Legal Agreements", count: 2, percentage: 66.7 },
        { key: "spreadsheet", label: "Spreadsheet", count: 1, percentage: 33.3 },
      ],
      fileTypeDistribution: [
        { key: "pdf", label: "PDF", count: 2, percentage: 66.7 },
        { key: "csv", label: "CSV", count: 1, percentage: 33.3 },
      ],
      distributions: {
        category: {
          items: [
            { key: "agreement", label: "Legal Agreements", count: 2, percentage: 66.7 },
            { key: "spreadsheet", label: "Spreadsheet", count: 1, percentage: 33.3 },
          ],
          totalDocuments: 3,
          sumCounts: 3,
        },
        fileType: {
          items: [
            { key: "pdf", label: "PDF", count: 2, percentage: 66.7 },
            { key: "csv", label: "CSV", count: 1, percentage: 33.3 },
          ],
          totalDocuments: 3,
          sumCounts: 3,
        },
      },
      meta: {
        documentCount: 3,
        clusterCount: 2,
        relationshipCount: 0,
        topicCount: 2,
        duplicateCount: 0,
      },
    });
  });

  it("builds dashboard sections with risk table and review order", async () => {
    const report = await buildWorkspaceReport({ workspace, skipCache: true });

    expect(report.meta.validation.valid).toBe(true);
    expect(report.executiveSummary.summary).toBeTruthy();
    expect(report.riskTable.length).toBeGreaterThan(0);
    expect(report.riskTable[0]).toEqual(
      expect.objectContaining({
        document: expect.any(String),
        riskReason: expect.any(String),
        severity: expect.any(String),
      })
    );
    expect(report.reviewOrder.length).toBeGreaterThan(0);
    expect(report.reviewOrder[0]).toEqual(
      expect.objectContaining({
        rank: 1,
        document: expect.any(String),
        riskScore: expect.any(Number),
      })
    );
  });

  it("remains objective and contains no advisory language", async () => {
    const report = await buildWorkspaceReport({ workspace, skipCache: true });
    const context = formatReportAsContext(report);
    const corpus = [
      report.executiveSummary.summary,
      context,
      ...report.riskTable.map((row) => `${row.document} ${row.riskReason}`),
      ...report.reviewOrder.map((item) => item.document),
    ].join("\n");

    expect(containsAdvisoryLanguage(corpus)).toBe(false);
    expect(corpus).not.toMatch(/ideal|advantageous|clients should|this agreement is/i);
  });

  it("caches report responses", async () => {
    await buildWorkspaceReport({ workspace, skipCache: true });
    const cached = await buildWorkspaceReport({ workspace });
    expect(cached.meta.cached).toBe(true);
  });

  it("validates report consistency and deduplicates risk rows", async () => {
    DocumentComparisons.forWorkspace.mockResolvedValue([
      {
        id: 1,
        riskScore: 82,
        riskLevel: "HIGH",
        documentA: "legal-1",
        documentB: "legal-2",
        documentALabel: "RETAINER AGREEMENT-2.pdf",
        documentBLabel: "TMC0058.pdf",
      },
    ]);

    buildWorkspaceGraph.mockResolvedValue({
      clusters: [
        {
          id: "cluster-1",
          label: "Legal Agreements",
          documentCount: 2,
          confidence: 88,
          dominantTopics: ["Billing"],
          topics: ["Billing"],
          documents: [
            { title: "RETAINER AGREEMENT-2.pdf" },
            { title: "TMC0058.pdf" },
          ],
          documentIds: ["legal-1", "legal-2"],
        },
        {
          id: "cluster-2",
          label: "Game Statistics",
          documentCount: 1,
          confidence: 95,
          dominantTopics: ["Game Statistics"],
          topics: ["Game Statistics"],
          documents: [{ title: "sample4.csv" }],
          documentIds: ["game-1"],
        },
      ],
      duplicates: [],
      majorTopics: [{ topic: "Billing", documentCount: 2 }],
      categoryDistribution: [
        { key: "agreement", label: "Legal Agreements", count: 2, percentage: 66.7 },
        { key: "spreadsheet", label: "Spreadsheet", count: 1, percentage: 33.3 },
      ],
      fileTypeDistribution: [
        { key: "pdf", label: "PDF", count: 2, percentage: 66.7 },
        { key: "csv", label: "CSV", count: 1, percentage: 33.3 },
      ],
      distributions: {
        category: {
          items: [
            { key: "agreement", label: "Legal Agreements", count: 2, percentage: 66.7 },
            { key: "spreadsheet", label: "Spreadsheet", count: 1, percentage: 33.3 },
          ],
          totalDocuments: 3,
          sumCounts: 3,
        },
        fileType: {
          items: [
            { key: "pdf", label: "PDF", count: 2, percentage: 66.7 },
            { key: "csv", label: "CSV", count: 1, percentage: 33.3 },
          ],
          totalDocuments: 3,
          sumCounts: 3,
        },
      },
      meta: {
        documentCount: 3,
        clusterCount: 2,
        relationshipCount: 1,
        topicCount: 2,
        duplicateCount: 0,
      },
    });

    const report = await buildWorkspaceReport({ workspace, skipCache: true });

    expect(report.meta.validation.valid).toBe(true);
    expect(report.executiveSummary.kpis.highRiskReviews).toBe(1);
    expect(report.executiveSummary.kpis.highRiskIndicators).toBeGreaterThanOrEqual(1);
    expect(report.riskTable.filter((row) => row.severity === "HIGH")).toHaveLength(
      report.executiveSummary.kpis.highRiskIndicators
    );

    const riskKeys = report.riskTable.map(
      (row) => `${row.documentId || row.reviewId}::${row.riskReason}`
    );
    expect(new Set(riskKeys).size).toBe(riskKeys.length);
  });
});

describe("report cluster normalization", () => {
  it("merges confidentiality and legal representation agreement clusters", () => {
    const documents = [
      {
        documentId: "legal-1",
        title: "Basic-Fee-Agreement.pdf",
        category: "agreement",
        documentType: "fee agreement",
        topics: ["confidentiality", "billing"],
      },
      {
        documentId: "legal-2",
        title: "TMC0058.pdf",
        category: "agreement",
        documentType: "retainer agreement",
        topics: ["legal representation", "billing"],
      },
      {
        documentId: "legal-3",
        title: "RETAINER AGREEMENT-2.pdf",
        category: "agreement",
        documentType: "retainer agreement",
        topics: ["legal services", "billing"],
      },
    ];

    const clusters = clusterDocuments(documents, []);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].label).toBe("Legal Agreements");
    expect(clusters[0].documentIds).toEqual(
      expect.arrayContaining(["legal-1", "legal-2", "legal-3"])
    );
  });
});

describe("buildReviewOrder", () => {
  it("orders documents by risk score using filenames only", () => {
    const order = buildReviewOrder({
      risks: [
        {
          documentId: "b",
          document: "TMC0058.pdf",
          severity: "MEDIUM",
          riskReason: "Arbitration clause not detected in metadata",
        },
        {
          documentId: "a",
          document: "RETAINER AGREEMENT-2.pdf",
          severity: "HIGH",
          riskReason: "High financial obligation signals in metadata",
        },
      ],
      intelligence: [],
      duplicates: [],
    });

    expect(order[0].document).toBe("RETAINER AGREEMENT-2.pdf");
    expect(order[1].document).toBe("TMC0058.pdf");
    expect(containsAdvisoryLanguage(order.map((item) => item.document).join(" "))).toBe(
      false
    );
  });
});
