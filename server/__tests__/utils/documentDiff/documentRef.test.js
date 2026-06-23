/* eslint-env jest, node */

const {
  normalizeDocLabel,
  findBestDocumentMatch,
} = require("../../../utils/documentDiff/documentRef");

describe("documentRef", () => {
  const docs = [
    {
      docId: "a",
      filename:
        "Basic-Fee-Agreement-hourly-or-flat-fee-for-use-in-limited-scope-representation.pdf-e585adc2.json",
      metadata: JSON.stringify({
        title:
          "Basic-Fee-Agreement-hourly-or-flat-fee-for-use-in-limited-scope-representation.pdf",
      }),
    },
    {
      docId: "b",
      filename: "RETAINER-AGREEMENT-2.pdf-9e3b68cd.json",
      metadata: JSON.stringify({ title: "RETAINER AGREEMENT-2.pdf" }),
    },
  ];

  it("normalizes spaces and hyphens consistently", () => {
    expect(normalizeDocLabel("RETAINER AGREEMENT-2.pdf")).toBe(
      normalizeDocLabel("RETAINER-AGREEMENT-2.pdf")
    );
  });

  it("matches retainer agreement by title with spaces", () => {
    const match = findBestDocumentMatch("RETAINER AGREEMENT-2", docs);
    expect(match?.docId).toBe("b");
  });

  it("matches retainer agreement with pdf extension", () => {
    const match = findBestDocumentMatch("RETAINER AGREEMENT-2.pdf", docs);
    expect(match?.docId).toBe("b");
  });

  it("matches shortened basic fee agreement references", () => {
    const match = findBestDocumentMatch("Basic-Fee-Agreement.pdf", docs);
    expect(match?.docId).toBe("a");
  });

  it("matches partial basic fee agreement name without extension", () => {
    const match = findBestDocumentMatch("Basic-Fee-Agreement", docs);
    expect(match?.docId).toBe("a");
  });
});
