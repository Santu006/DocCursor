/* eslint-env jest, node */

jest.mock("../../../models/documents", () => ({
  Document: {
    forWorkspace: jest.fn(),
    content: jest.fn(),
    get: jest.fn(),
  },
}));

jest.mock("../../../models/workspace", () => ({
  Workspace: {
    get: jest.fn(),
  },
}));

jest.mock("../../../utils/helpers", () => ({
  getLLMProvider: jest.fn(),
}));

const { Document } = require("../../../models/documents");
const { compareDocuments, parseAnalysisJson } = require("../../../utils/documentDiff/documentDiff");
const { extractSections, matchSections } = require("../../../utils/documentDiff/sectionMatcher");
const { computeTextDiff, computeSemanticDiff } = require("../../../utils/documentDiff/semanticDiff");
const { buildDiffReport, normalizeLLMAnalysis } = require("../../../utils/documentDiff/diffReport");
const {
  isDocumentDiffQuery,
  extractDocumentPairFromQuery,
} = require("../../../utils/chats/documentDiffRetrieval");

const MARKDOWN_V1 = `# Service Agreement

## Payment Terms
Client pays Net 30 days from invoice date.

## Confidentiality
Both parties agree to keep information confidential.

## Termination
Either party may terminate with 30 days notice.
`;

const MARKDOWN_V2 = `# Service Agreement

## Payment Terms
Client pays Net 15 days from invoice date.

## Confidentiality
Both parties agree to keep information confidential. Non-disclosure applies for 5 years.

## Arbitration
Disputes shall be resolved by binding arbitration.

## Termination
Either party may terminate with 60 days notice.
`;

const DOCX_LIKE_V1 = `RETAINER AGREEMENT

PAYMENT TERMS
The client shall pay a $5,000 retainer.

CONFIDENTIALITY
All matter information is confidential.

TERMINATION
Attorney may withdraw with 14 days notice.
`;

const DOCX_LIKE_V2 = `RETAINER AGREEMENT

PAYMENT TERMS
The client shall pay a $10,000 retainer and hourly fees.

CONFIDENTIALITY
All matter information is confidential.

LIABILITY
Client indemnifies the firm for third-party claims.

TERMINATION
Attorney may withdraw with 30 days notice.
`;

const PDF_LIKE_V1 = `FEE AGREEMENT

1. Scope of Services
Limited representation only.

2. Fees
Flat fee of $2,500.

3. Confidentiality
Standard confidentiality applies.
`;

const PDF_LIKE_V2 = `FEE AGREEMENT

1. Scope of Services
Limited representation only.

2. Fees
Hourly rate of $350 with $2,500 flat fee cap.

3. Confidentiality
Enhanced confidentiality with audit rights.
`;

describe("sectionMatcher", () => {
  it("extracts markdown sections", () => {
    const sections = extractSections(MARKDOWN_V1);
    expect(sections.some((s) => s.title.includes("Payment Terms"))).toBe(true);
    expect(sections.some((s) => s.title.includes("Confidentiality"))).toBe(true);
  });

  it("matches sections between versions", () => {
    const sectionsA = extractSections(MARKDOWN_V1);
    const sectionsB = extractSections(MARKDOWN_V2);
    const { matched, onlyA, onlyB } = matchSections(sectionsA, sectionsB);

    expect(matched.length).toBeGreaterThan(0);
    expect(onlyB.some((s) => /Arbitration/i.test(s.title))).toBe(true);
    expect(onlyA.length).toBe(0);
  });
});

describe("semanticDiff", () => {
  it("detects line-level changes in raw diff mode", () => {
    const diff = computeTextDiff("alpha\nbeta", "alpha\ngamma");
    expect(
      diff.removed.includes("beta") ||
        diff.modified.some((m) => m.before.includes("beta"))
    ).toBe(true);
    expect(
      diff.added.includes("gamma") ||
        diff.modified.some((m) => m.after.includes("gamma"))
    ).toBe(true);
  });

  it("detects markdown semantic changes", () => {
    const result = computeSemanticDiff(MARKDOWN_V1, MARKDOWN_V2);

    expect(
      result.sectionChanges.modified.some((s) => /Payment|Revised/i.test(s.title))
    ).toBe(true);
    expect(
      result.sectionChanges.added.some((s) => /Arbitration/i.test(s.title))
    ).toBe(true);
    expect(result.financialChanges.length).toBeGreaterThan(0);
    expect(result.riskScore).toBeGreaterThan(0);
  });

  it("detects DOCX-like section changes", () => {
    const result = computeSemanticDiff(DOCX_LIKE_V1, DOCX_LIKE_V2);

    expect(
      result.sectionChanges.modified.some((s) => /Payment|Retainer|Revised/i.test(s.title))
    ).toBe(true);
    expect(
      result.sectionChanges.added.some((s) => /Liability/i.test(s.title))
    ).toBe(true);
    expect(result.riskChanges.length).toBeGreaterThan(0);
  });

  it("detects PDF-like section changes", () => {
    const result = computeSemanticDiff(PDF_LIKE_V1, PDF_LIKE_V2);

    expect(result.clauseChanges.length).toBeGreaterThan(0);
    expect(
      result.clauseChanges.some(
        (c) =>
          /fee|payment|billing/i.test(c.summary) ||
          /fee|payment|billing/i.test(c.label || "")
      )
    ).toBe(true);
  });
});

describe("diffReport", () => {
  it("builds a structured report with git-style diff", () => {
    const diffResult = computeSemanticDiff(MARKDOWN_V1, MARKDOWN_V2);
    const report = buildDiffReport({
      titleA: "Contract_v1.md",
      titleB: "Contract_v2.md",
      diffResult,
      llmAnalysis: normalizeLLMAnalysis({
        executiveSummary: "Payment terms tightened and arbitration added.",
        paymentTermChanges: ["Net 30 changed to Net 15"],
        riskChanges: [{ section: "Arbitration", summary: "Binding arbitration added" }],
      }),
    });

    expect(report.executiveSummary).toMatch(/Payment terms tightened/i);
    expect(report.added.length).toBeGreaterThan(0);
    expect(report.modified.length).toBeGreaterThan(0);
    expect(report.report).toMatch(/Executive Summary/);
    expect(report.report).toMatch(/Financial Impact/);
    expect(report.added[0].evidence?.[0]).toEqual(
      expect.objectContaining({
        documentName: "Contract_v2.md",
        similarityScore: expect.any(Number),
      })
    );
  });
});

describe("compareDocuments", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("compares raw markdown content without workspace docs", async () => {
    const result = await compareDocuments({
      contentA: MARKDOWN_V1,
      contentB: MARKDOWN_V2,
      titleA: "Contract_v1.md",
      titleB: "Contract_v2.md",
      useLLM: false,
    });

    expect(result.success).toBe(true);
    expect(result.report.summary).toBeTruthy();
    expect(result.report.added.length).toBeGreaterThan(0);
    expect(result.report.modified.length).toBeGreaterThan(0);
  });

  it("compares DOCX-like documents", async () => {
    const result = await compareDocuments({
      contentA: DOCX_LIKE_V1,
      contentB: DOCX_LIKE_V2,
      titleA: "Contract_v1.docx",
      titleB: "Contract_v2.docx",
      useLLM: false,
    });

    expect(result.success).toBe(true);
    expect(result.report.riskChanges.length).toBeGreaterThan(0);
    expect(result.report.modified.length).toBeGreaterThan(0);
  });

  it("compares PDF-like documents", async () => {
    const result = await compareDocuments({
      contentA: PDF_LIKE_V1,
      contentB: PDF_LIKE_V2,
      titleA: "Agreement_v1.pdf",
      titleB: "Agreement_v2.pdf",
      useLLM: false,
    });

    expect(result.success).toBe(true);
    expect(
      result.report.modified.length +
        result.report.added.length +
        result.report.removed.length
    ).toBeGreaterThan(0);
  });
});

describe("documentDiffRetrieval", () => {
  it("detects pairwise diff queries", () => {
    expect(
      isDocumentDiffQuery("Compare Contract_v1.docx with Contract_v2.docx")
    ).toBe(true);
    expect(isDocumentDiffQuery("What changed between these two agreements?")).toBe(
      true
    );
    expect(isDocumentDiffQuery("Compare all documents")).toBe(false);
  });

  it("extracts document pair from query when filenames are mentioned", () => {
    const pair = extractDocumentPairFromQuery(
      "Compare Contract_v1.docx with Contract_v2.docx",
      [
        { docId: "a", filename: "custom-documents/Contract_v1.docx" },
        { docId: "b", filename: "custom-documents/Contract_v2.docx" },
      ]
    );

    expect(pair).toEqual({ documentA: "a", documentB: "b" });
  });

  it("extracts santosh workspace filenames with spaces vs hyphens", () => {
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

    const pair = extractDocumentPairFromQuery(
      "Compare Basic-Fee-Agreement-hourly-or-flat-fee-for-use-in-limited-scope-representation.pdf with RETAINER AGREEMENT-2.pdf",
      docs
    );

    expect(pair).toEqual({ documentA: "a", documentB: "b" });
  });

  it("extracts pair when user uses shortened basic fee agreement filename", () => {
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

    const pair = extractDocumentPairFromQuery(
      "Compare Basic-Fee-Agreement.pdf with RETAINER AGREEMENT-2.pdf",
      docs
    );

    expect(pair).toEqual({ documentA: "a", documentB: "b" });
  });
});

describe("parseAnalysisJson", () => {
  it("parses fenced LLM JSON", () => {
    const parsed = parseAnalysisJson(
      '```json\n{"executiveSummary":"Changes found."}\n```'
    );
    expect(parsed.executiveSummary).toBe("Changes found.");
  });
});
