/* eslint-env jest, node */
const {
  isProjectWideQuery,
  isFactualExtractionQuery,
  getDynamicMaxChunksPerDoc,
  balanceChunksByDocument,
  filterSourcesByThreshold,
  performWorkspaceSimilaritySearch,
  groupChunksByDocument,
  buildStructuredDocumentContext,
  buildDocumentCoverageChecklist,
  getProjectWideSystemInstructions,
  applyProjectWideSystemPrompt,
  PROJECT_WIDE_COVERAGE_ENFORCEMENT,
  PROJECT_WIDE_CANDIDATE_LIMIT,
  FACTUAL_EXTRACTION_THRESHOLD,
} = require("../../../utils/chats/projectWideRetrieval");

describe("projectWideRetrieval", () => {
  describe("isProjectWideQuery", () => {
    const positives = [
      "summarize all agreements",
      "Summarize all documents in this workspace",
      "compare agreements",
      "compare all contracts",
      "Please compare these documents for me",
      "all uploaded PDFs",
      "every document in this project",
      "Summarize all agreements and compare retainer requirements",
      "List every monetary amount mentioned across all PDFs",
    ];

    test.each(positives)("returns true for: %s", (query) => {
      expect(isProjectWideQuery(query)).toBe(true);
    });

    const negatives = [
      "",
      "What is clause 3?",
      "summarize this agreement",
      "compare section 4 and section 5",
      "tell me about the retainer clause",
      "@document/custom-documents/foo.pdf what does this say?",
    ];

    test.each(negatives)("returns false for: %s", (query) => {
      expect(isProjectWideQuery(query)).toBe(false);
    });
  });

  describe("isFactualExtractionQuery", () => {
    const positives = [
      "list every monetary amount",
      "List every monetary amount mentioned across all PDFs",
      "list all amounts",
      "all dates in these files",
      "all deadlines",
      "all fees",
      "every obligation",
      "every payment term",
      "list all fees across documents",
    ];

    test.each(positives)("returns true for: %s", (query) => {
      expect(isFactualExtractionQuery(query)).toBe(true);
    });

    const negatives = [
      "summarize all agreements",
      "compare contracts",
      "What is clause 3?",
    ];

    test.each(negatives)("returns false for: %s", (query) => {
      expect(isFactualExtractionQuery(query)).toBe(false);
    });
  });

  describe("getDynamicMaxChunksPerDoc", () => {
    it("allows all chunks for small documents", () => {
      expect(getDynamicMaxChunksPerDoc(5)).toBe(Number.POSITIVE_INFINITY);
      expect(getDynamicMaxChunksPerDoc(9)).toBe(Number.POSITIVE_INFINITY);
    });

    it("caps medium documents at 5 chunks", () => {
      expect(getDynamicMaxChunksPerDoc(10)).toBe(5);
      expect(getDynamicMaxChunksPerDoc(20)).toBe(5);
      expect(getDynamicMaxChunksPerDoc(30)).toBe(5);
    });

    it("caps large documents at 8 chunks", () => {
      expect(getDynamicMaxChunksPerDoc(31)).toBe(8);
      expect(getDynamicMaxChunksPerDoc(100)).toBe(8);
    });
  });

  describe("filterSourcesByThreshold", () => {
    it("filters chunks below the threshold", () => {
      const sources = [
        { id: "1", score: 0.3 },
        { id: "2", score: 0.2 },
        { id: "3", score: 0.15 },
        { id: "4", score: 0.14 },
      ];

      const filtered = filterSourcesByThreshold(sources, 0.15);
      expect(filtered.map((s) => s.id)).toEqual(["1", "2", "3"]);
    });
  });

  describe("balanceChunksByDocument", () => {
    function makeSource(title, score, id) {
      return { id, title, text: `text-${id}`, score };
    }

    it("uses dynamic limits based on document chunk totals", () => {
      const sources = [
        makeSource("Small Doc", 0.9, "s1"),
        makeSource("Small Doc", 0.8, "s2"),
        makeSource("Small Doc", 0.7, "s3"),
        makeSource("Medium Doc", 0.85, "m1"),
        makeSource("Medium Doc", 0.75, "m2"),
        makeSource("Medium Doc", 0.65, "m3"),
        makeSource("Medium Doc", 0.55, "m4"),
        makeSource("Medium Doc", 0.45, "m5"),
        makeSource("Medium Doc", 0.35, "m6"),
      ];

      const { sources: balanced } = balanceChunksByDocument(sources, {
        documentChunkCounts: {
          "Small Doc": 5,
          "Medium Doc": 20,
        },
      });

      expect(balanced.filter((s) => s.title === "Small Doc")).toHaveLength(3);
      expect(balanced.filter((s) => s.title === "Medium Doc")).toHaveLength(5);
    });

    it("returns results sorted by score descending", () => {
      const sources = [
        makeSource("Doc B", 0.5, "b1"),
        makeSource("Doc A", 0.9, "a1"),
        makeSource("Doc C", 0.7, "c1"),
      ];

      const { sources: balanced } = balanceChunksByDocument(sources, {
        documentChunkCounts: {
          "Doc A": 5,
          "Doc B": 5,
          "Doc C": 5,
        },
      });
      expect(balanced.map((s) => s.id)).toEqual(["a1", "c1", "b1"]);
    });

    it("respects explicit maxPerDoc override", () => {
      const sources = [
        makeSource("Doc A", 0.9, "a1"),
        makeSource("Doc A", 0.8, "a2"),
        makeSource("Doc A", 0.7, "a3"),
      ];

      const { sources: balanced } = balanceChunksByDocument(sources, {
        maxPerDoc: 1,
      });

      expect(balanced).toHaveLength(1);
      expect(balanced[0].id).toBe("a1");
    });
  });

  describe("groupChunksByDocument", () => {
    function makeSource(title, score, id, text) {
      return { id, title, text: text ?? `text-${id}`, score };
    }

    it("groups chunks by document title", () => {
      const sources = [
        makeSource("Doc A", 0.9, "a1"),
        makeSource("Doc B", 0.8, "b1"),
        makeSource("Doc A", 0.7, "a2"),
      ];

      const grouped = groupChunksByDocument(sources);
      expect([...grouped.keys()].sort()).toEqual(["Doc A", "Doc B"]);
      expect(grouped.get("Doc A").map((s) => s.id)).toEqual(["a1", "a2"]);
      expect(grouped.get("Doc B").map((s) => s.id)).toEqual(["b1"]);
    });
  });

  describe("buildStructuredDocumentContext", () => {
    function makeSource(title, score, id, text) {
      return { id, title, text: text ?? `text-${id}`, score };
    }

    it("generates document sections with chunk text grouped by title", () => {
      const sources = [
        makeSource("TMC0058.pdf", 0.9, "t1", "Fee schedule $550"),
        makeSource("RETAINER AGREEMENT-2.pdf", 0.8, "r1", "Retainer terms"),
        makeSource("Basic-Fee-Agreement.pdf", 0.7, "b1", "Template field"),
        makeSource("TMC0058.pdf", 0.6, "t2", "Initial deposit $25.00"),
      ];

      const { text, documentsInContext, chunksPerDocument } =
        buildStructuredDocumentContext(sources);

      expect(documentsInContext).toEqual([
        "TMC0058.pdf",
        "RETAINER AGREEMENT-2.pdf",
        "Basic-Fee-Agreement.pdf",
      ]);
      expect(chunksPerDocument).toEqual({
        "TMC0058.pdf": 2,
        "RETAINER AGREEMENT-2.pdf": 1,
        "Basic-Fee-Agreement.pdf": 1,
      });
      expect(text).toContain("## Document: TMC0058.pdf");
      expect(text).toContain("Fee schedule $550");
      expect(text).toContain("Initial deposit $25.00");
      expect(text).toContain("## Document: RETAINER AGREEMENT-2.pdf");
      expect(text).toContain("Retainer terms");
      expect(text).toContain("## Document: Basic-Fee-Agreement.pdf");
      expect(text).toContain("Template field");
      expect(text).not.toContain("[CONTEXT 0]");
    });

    it("returns empty output for no sources", () => {
      const result = buildStructuredDocumentContext([]);
      expect(result.text).toBe("");
      expect(result.documentsInContext).toEqual([]);
      expect(result.chunksPerDocument).toEqual({});
    });
  });

  describe("buildDocumentCoverageChecklist", () => {
    it("generates a checklist with all document titles", () => {
      const documents = [
        "Basic-Fee-Agreement-hourly-or-flat-fee-for-use-in-limited-scope-representation.pdf",
        "RETAINER AGREEMENT-2.pdf",
        "TMC0058.pdf",
      ];

      const { text, documents: listed } = buildDocumentCoverageChecklist(documents);

      expect(listed).toEqual(documents);
      expect(text).toContain("Documents represented in context:");
      expect(text).toContain(
        "* Basic-Fee-Agreement-hourly-or-flat-fee-for-use-in-limited-scope-representation.pdf"
      );
      expect(text).toContain("* RETAINER AGREEMENT-2.pdf");
      expect(text).toContain("* TMC0058.pdf");
    });

    it("returns empty output when no documents are provided", () => {
      const result = buildDocumentCoverageChecklist([]);
      expect(result.text).toBe("");
      expect(result.documents).toEqual([]);
    });
  });

  describe("getProjectWideSystemInstructions", () => {
    it("includes table instructions for one row per document", () => {
      const instructions = getProjectWideSystemInstructions();
      expect(instructions).toMatch(/Analyze every document separately/i);
      expect(instructions).toMatch(/Include every document represented in context/i);
      expect(instructions).toMatch(/one row per document/i);
    });

    it("includes placeholder instructions", () => {
      const instructions = getProjectWideSystemInstructions();
      expect(instructions).toMatch(/\[dollar amount\]/i);
      expect(instructions).toMatch(/---/);
      expect(instructions).toMatch(/blank template fields/i);
      expect(instructions).toMatch(/Not specified/i);
    });

    it("includes coverage enforcement and documents to cover when checklist is provided", () => {
      const documents = ["Doc A.pdf", "Doc B.pdf", "Doc C.pdf"];
      const instructions = getProjectWideSystemInstructions(documents);

      expect(instructions).toContain(PROJECT_WIDE_COVERAGE_ENFORCEMENT);
      expect(instructions).toMatch(/You MUST provide an output entry for every document listed below/i);
      expect(instructions).toMatch(/Do not omit any document/i);
      expect(instructions).toContain("Documents to cover:");
      expect(instructions).toContain("* Doc A.pdf");
      expect(instructions).toContain("* Doc B.pdf");
      expect(instructions).toContain("* Doc C.pdf");
    });
  });

  describe("applyProjectWideSystemPrompt", () => {
    it("appends project-wide instructions when projectWide is true", () => {
      const base = "Base system prompt.";
      const result = applyProjectWideSystemPrompt(base, { projectWide: true });
      expect(result).toContain(base);
      expect(result).toContain("one row per document");
    });

    it("appends the coverage checklist when documentsInContext is provided", () => {
      const base = "Base system prompt.";
      const documents = [
        "Basic-Fee-Agreement-hourly-or-flat-fee-for-use-in-limited-scope-representation.pdf",
        "RETAINER AGREEMENT-2.pdf",
        "TMC0058.pdf",
      ];
      const result = applyProjectWideSystemPrompt(base, {
        projectWide: true,
        documentsInContext: documents,
      });

      expect(result).toContain("You MUST provide an output entry for every document listed below");
      expect(result).toContain("Documents to cover:");
      documents.forEach((doc) => {
        expect(result).toContain(`* ${doc}`);
      });
    });

    it("returns the original prompt when projectWide is false", () => {
      const base = "Base system prompt.";
      expect(applyProjectWideSystemPrompt(base, { projectWide: false })).toBe(
        base
      );
    });
  });

  describe("performWorkspaceSimilaritySearch", () => {
    const workspace = {
      slug: "santosh",
      topN: 4,
      similarityThreshold: 0.25,
      vectorSearchMode: "default",
    };

    const LLMConnector = { embedTextInput: jest.fn() };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("uses workspace topN for standard queries", async () => {
      const performSimilaritySearch = jest.fn().mockResolvedValue({
        contextTexts: ["chunk"],
        sources: [{ id: "1", title: "Doc", text: "chunk", score: 0.5 }],
        message: false,
      });

      const result = await performWorkspaceSimilaritySearch({
        VectorDb: { performSimilaritySearch },
        workspace,
        input: "What is clause 3?",
        LLMConnector,
        filterIdentifiers: [],
      });

      expect(performSimilaritySearch).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: "santosh",
          topN: 4,
          similarityThreshold: 0.25,
          rerank: false,
        })
      );
      expect(result.projectWide).toBe(false);
      expect(result.sources).toHaveLength(1);
    });

    it("fetches 40 raw chunks and applies workspace threshold for thematic project-wide queries", async () => {
      const rawSources = [
        { id: "1", title: "Doc A", text: "a1", score: 0.9 },
        { id: "2", title: "Doc A", text: "a2", score: 0.8 },
        { id: "3", title: "Doc A", text: "a3", score: 0.7 },
        { id: "4", title: "Doc B", text: "b1", score: 0.85 },
        { id: "5", title: "Doc C", text: "c1", score: 0.6 },
        { id: "6", title: "Doc C", text: "c2", score: 0.2 },
      ];

      const performSimilaritySearch = jest.fn().mockResolvedValue({
        contextTexts: rawSources.map((s) => s.text),
        sources: rawSources,
        message: false,
      });

      const getDocumentChunkCounts = jest.fn().mockResolvedValue({
        "Doc A": 5,
        "Doc B": 5,
        "Doc C": 5,
      });

      const result = await performWorkspaceSimilaritySearch({
        VectorDb: { performSimilaritySearch, getDocumentChunkCounts },
        workspace,
        input: "summarize all agreements",
        LLMConnector,
        filterIdentifiers: [],
      });

      expect(performSimilaritySearch).toHaveBeenCalledWith(
        expect.objectContaining({
          topN: PROJECT_WIDE_CANDIDATE_LIMIT,
          similarityThreshold: 0,
        })
      );
      expect(result.projectWide).toBe(true);
      expect(result.sources).toHaveLength(5);
      expect(new Set(result.sources.map((s) => s.title)).size).toBe(3);
      expect(result.sources.some((s) => s.id === "6")).toBe(false);
      expect(result.contextTexts).toHaveLength(1);
      expect(result.contextTexts[0]).toContain("## Document: Doc A");
      expect(result.contextTexts[0]).toContain("## Document: Doc B");
      expect(result.contextTexts[0]).toContain("## Document: Doc C");
      expect(result.documentsInContext).toEqual(["Doc A", "Doc B", "Doc C"]);
      expect(result.coverageChecklist).toContain("Documents represented in context:");
      expect(result.coverageChecklist).toContain("* Doc A");
      expect(result.coverageChecklist).toContain("* Doc B");
      expect(result.coverageChecklist).toContain("* Doc C");
    });

    it("uses factual threshold override for factual project-wide queries", async () => {
      const rawSources = [
        { id: "1", title: "Doc A", text: "a1", score: 0.24 },
        { id: "2", title: "Doc B", text: "b1", score: 0.2 },
        { id: "3", title: "Doc B", text: "b2", score: 0.14 },
        { id: "4", title: "Doc C", text: "c1", score: 0.16 },
      ];

      const performSimilaritySearch = jest.fn().mockResolvedValue({
        contextTexts: rawSources.map((s) => s.text),
        sources: rawSources,
        message: false,
      });

      const getDocumentChunkCounts = jest.fn().mockResolvedValue({
        "Doc A": 20,
        "Doc B": 20,
        "Doc C": 20,
      });

      const result = await performWorkspaceSimilaritySearch({
        VectorDb: { performSimilaritySearch, getDocumentChunkCounts },
        workspace,
        input: "list every monetary amount across all PDFs",
        LLMConnector,
        filterIdentifiers: [],
      });

      expect(performSimilaritySearch).toHaveBeenCalledWith(
        expect.objectContaining({
          topN: 40,
          similarityThreshold: 0,
        })
      );
      expect(result.projectWide).toBe(true);
      expect(result.sources.map((s) => s.id)).toEqual(["1", "2", "4"]);
      expect(result.contextTexts).toHaveLength(1);
      expect(result.contextTexts[0]).toContain("## Document:");
      expect(result.documentsInContext).toEqual(["Doc A", "Doc B", "Doc C"]);
      expect(result.coverageChecklist).toContain("* Doc A");
      expect(result.coverageChecklist).toContain("* Doc B");
      expect(result.coverageChecklist).toContain("* Doc C");
      expect(FACTUAL_EXTRACTION_THRESHOLD).toBe(0.15);
    });
  });
});
