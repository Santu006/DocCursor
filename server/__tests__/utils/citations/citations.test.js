/* eslint-env jest, node */

const {
  buildCitationMap,
  attachEvidence,
  formatCitation,
  buildDiffClauseEvidence,
} = require("../../../utils/citations");
const { normalizeSource } = require("../../../utils/citations/normalizeSource");
const {
  matchEvidenceForFinding,
  sectionsMatch,
} = require("../../../utils/citations/matchEvidence");

describe("normalizeSource", () => {
  it("maps title, id, and score into citation fields", () => {
    const citation = normalizeSource({
      id: "chunk-1",
      title: "RETAINER AGREEMENT-2.pdf",
      score: 0.98,
      text: "withdrawal rights text",
    });

    expect(citation).toEqual(
      expect.objectContaining({
        documentName: "RETAINER AGREEMENT-2.pdf",
        chunkId: "chunk-1",
        similarityScore: 0.98,
      })
    );
  });

  it("parses sourceDocument from chunk metadata", () => {
    const citation = normalizeSource({
      id: "chunk-2",
      title: "fallback.pdf",
      text: `<document_metadata>
sourceDocument: RETAINER AGREEMENT-2.pdf
sectionTitle: Withdrawal Rights
</document_metadata>

clause text`,
    });

    expect(citation.documentName).toBe("RETAINER AGREEMENT-2.pdf");
    expect(citation.sectionTitle).toBe("Withdrawal Rights");
  });
});

describe("buildCitationMap", () => {
  it("indexes citations by chunk id and document", () => {
    const map = buildCitationMap([
      { id: "a", title: "Doc A.pdf", score: 0.8, text: "alpha" },
      { id: "b", title: "Doc B.pdf", score: 0.7, text: "beta" },
    ]);

    expect(map.all).toHaveLength(2);
    expect(map.byChunkId.get("a").documentName).toBe("Doc A.pdf");
    expect(map.byDocument.get("Doc B.pdf")).toHaveLength(1);
  });
});

describe("matchEvidenceForFinding", () => {
  const citations = [
    {
      documentName: "RETAINER AGREEMENT-2.pdf",
      sectionTitle: "Withdrawal Rights",
      chunkId: "c1",
      similarityScore: 0.98,
      excerpt: "Attorney may withdraw from representation",
    },
    {
      documentName: "Basic-Fee-Agreement.pdf",
      sectionTitle: "Arbitration",
      chunkId: "c2",
      similarityScore: 0.55,
      excerpt: "arbitration clause",
    },
  ];

  it("prefers section match over similarity score", () => {
    const matched = matchEvidenceForFinding(
      {
        summary: "Attorney Withdrawal Rights Added",
        section: "Withdrawal Rights",
      },
      citations
    );

    expect(matched[0].documentName).toBe("RETAINER AGREEMENT-2.pdf");
    expect(matched[0].sectionTitle).toBe("Withdrawal Rights");
  });

  it("uses text overlap when section is missing", () => {
    const matched = matchEvidenceForFinding(
      {
        summary: "Arbitration clause removed",
        section: "",
      },
      citations
    );

    expect(matched[0].documentName).toBe("Basic-Fee-Agreement.pdf");
  });
});

describe("attachEvidence", () => {
  it("attaches matched evidence without overwriting existing evidence", () => {
    const findings = attachEvidence(
      [
        {
          summary: "Attorney Withdrawal Rights Added",
          section: "Withdrawal Rights",
        },
        {
          summary: "Already cited",
          evidence: [{ documentName: "Existing.pdf", sectionTitle: "Fees" }],
        },
      ],
      [
        {
          id: "chunk-1",
          title: "RETAINER AGREEMENT-2.pdf",
          score: 0.98,
          text: `<document_metadata>
sourceDocument: RETAINER AGREEMENT-2.pdf
sectionTitle: Withdrawal Rights
</document_metadata>

withdrawal`,
        },
      ]
    );

    expect(findings[0].evidence[0]).toEqual(
      expect.objectContaining({
        documentName: "RETAINER AGREEMENT-2.pdf",
        sectionTitle: "Withdrawal Rights",
        chunkId: "chunk-1",
      })
    );
    expect(findings[1].evidence[0].documentName).toBe("Existing.pdf");
  });
});

describe("buildDiffClauseEvidence", () => {
  it("maps added clauses to document B", () => {
    const evidence = buildDiffClauseEvidence(
      {
        changeType: "added",
        section: "Withdrawal Rights",
        confidence: 0.98,
      },
      {
        titleA: "Basic-Fee-Agreement.pdf",
        titleB: "RETAINER AGREEMENT-2.pdf",
      }
    );

    expect(evidence).toEqual([
      {
        documentName: "RETAINER AGREEMENT-2.pdf",
        sectionTitle: "Withdrawal Rights",
        chunkId: null,
        similarityScore: 0.98,
      },
    ]);
  });

  it("maps removed clauses to document A", () => {
    const evidence = buildDiffClauseEvidence(
      {
        changeType: "removed",
        section: "Arbitration",
        confidence: 0.91,
      },
      {
        titleA: "Basic-Fee-Agreement.pdf",
        titleB: "RETAINER AGREEMENT-2.pdf",
      }
    );

    expect(evidence[0].documentName).toBe("Basic-Fee-Agreement.pdf");
  });

  it("maps modified clauses to both documents", () => {
    const evidence = buildDiffClauseEvidence(
      {
        changeType: "modified",
        section: "Retainer",
        confidence: 0.9,
      },
      {
        titleA: "Basic-Fee-Agreement.pdf",
        titleB: "RETAINER AGREEMENT-2.pdf",
      }
    );

    expect(evidence).toHaveLength(2);
    expect(evidence.map((item) => item.documentName)).toEqual([
      "Basic-Fee-Agreement.pdf",
      "RETAINER AGREEMENT-2.pdf",
    ]);
  });
});

describe("formatCitation", () => {
  it("formats document, section, and confidence", () => {
    expect(
      formatCitation({
        documentName: "RETAINER AGREEMENT-2.pdf",
        sectionTitle: "Withdrawal Rights",
        similarityScore: 0.98,
      })
    ).toBe(
      "RETAINER AGREEMENT-2.pdf · Section: Withdrawal Rights · Confidence: 98%"
    );
  });
});

describe("sectionsMatch", () => {
  it("matches equivalent section labels", () => {
    expect(sectionsMatch("Withdrawal Rights", "withdrawal rights")).toBe(true);
  });
});
