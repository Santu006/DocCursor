/* eslint-env jest, node */

const {
  isExecutiveReportQuery,
  classifyReportQuery,
  formatReportContext,
} = require("../../../utils/chats/workspaceReportRetrieval");

describe("workspaceReportRetrieval", () => {
  it("detects executive report queries", () => {
    expect(isExecutiveReportQuery("Summarize this workspace")).toBe(true);
    expect(isExecutiveReportQuery("Give me an executive report")).toBe(true);
    expect(isExecutiveReportQuery("What should I review first?")).toBe(true);
    expect(isExecutiveReportQuery("Show key risks")).toBe(true);
    expect(isExecutiveReportQuery("Compare all documents")).toBe(false);
  });

  it("formats review priority as ordered document list", () => {
    const context = formatReportContext(
      {
        reviewOrder: [
          { rank: 1, document: "RETAINER AGREEMENT-2.pdf", riskScore: 120 },
          { rank: 2, document: "TMC0058.pdf", riskScore: 80 },
        ],
      },
      "What should I review first?"
    );

    expect(context).toContain("1. RETAINER AGREEMENT-2.pdf");
    expect(context).toContain("2. TMC0058.pdf");
  });
});
