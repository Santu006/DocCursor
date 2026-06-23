/* eslint-env jest, node */

const {
  getCategoryDistribution,
  getFileTypeDistribution,
  sumDistributionCounts,
} = require("../../../utils/workspaceGraph/topicGraph");

describe("topicGraph distributions", () => {
  const sampleRecords = [
    {
      docId: "legal-1",
      filename: "Basic-Fee-Agreement.pdf",
      category: "agreement",
      documentType: "fee agreement",
      fileType: "pdf",
    },
    {
      docId: "legal-2",
      filename: "TMC0058.pdf",
      category: "agreement",
      documentType: "retainer agreement",
      fileType: "pdf",
    },
    {
      docId: "legal-3",
      filename: "RETAINER AGREEMENT-2.pdf",
      category: "agreement",
      documentType: "retainer agreement",
      fileType: "pdf",
    },
    {
      docId: "hr-1",
      filename: "Allegations-of-Harassment-or-Bullying.xlsx",
      category: "legal_document",
      documentType: "harassment report",
      fileType: "xlsx",
    },
    {
      docId: "game-1",
      filename: "sample4.csv",
      category: "spreadsheet",
      documentType: "game statistics",
      fileType: "csv",
    },
  ];

  it("counts each document once in category distribution using category only", () => {
    const distribution = getCategoryDistribution(sampleRecords);

    expect(distribution.totalDocuments).toBe(5);
    expect(distribution.sumCounts).toBe(5);
    expect(sumDistributionCounts(distribution)).toBe(5);
    expect(distribution.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "agreement", label: "Legal Agreements", count: 3 }),
        expect.objectContaining({ key: "legal_document", count: 1 }),
        expect.objectContaining({ key: "spreadsheet", count: 1 }),
      ])
    );
  });

  it("does not mix documentType into category distribution", () => {
    const distribution = getCategoryDistribution(sampleRecords);
    const labels = distribution.items.map((item) => item.label);

    expect(labels).not.toContain("Game Statistics");
    expect(labels).not.toContain("Harassment Reports");
  });

  it("counts each document once in file type distribution using fileType only", () => {
    const distribution = getFileTypeDistribution(sampleRecords);

    expect(distribution.totalDocuments).toBe(5);
    expect(distribution.sumCounts).toBe(5);
    expect(sumDistributionCounts(distribution)).toBe(5);
    expect(distribution.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "pdf", label: "PDF", count: 3 }),
        expect.objectContaining({ key: "xlsx", label: "XLSX", count: 1 }),
        expect.objectContaining({ key: "csv", label: "CSV", count: 1 }),
      ])
    );
  });

  it("derives file type from filename when fileType is missing", () => {
    const distribution = getFileTypeDistribution([
      { filename: "notes.md", category: "general" },
    ]);

    expect(distribution.items).toEqual([
      expect.objectContaining({ key: "md", label: "MD", count: 1 }),
    ]);
    expect(distribution.sumCounts).toBe(1);
  });
});
