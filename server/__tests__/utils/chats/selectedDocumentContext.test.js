/* eslint-env jest, node */

jest.mock("../../../models/documents", () => ({
  Document: {
    content: jest.fn(),
  },
}));

const { Document } = require("../../../models/documents");
const {
  loadSelectedDocumentContext,
  applyDocumentQaSystemPrompt,
  perDocumentBudget,
  DOCUMENT_QA_SYSTEM_PROMPT,
  MAX_CHARS_PER_DOCUMENT,
  MAX_TOTAL_DIRECT_CHARS,
  MAX_SELECTED_DOCUMENTS,
} = require("../../../utils/chats/selectedDocumentContext");

describe("selectedDocumentContext", () => {
  beforeEach(() => {
    Document.content.mockReset();
  });

  test("applyDocumentQaSystemPrompt appends only when direct context loaded", () => {
    expect(applyDocumentQaSystemPrompt("Base", false)).toBe("Base");
    expect(applyDocumentQaSystemPrompt("Base", true)).toContain(
      DOCUMENT_QA_SYSTEM_PROMPT
    );
    expect(applyDocumentQaSystemPrompt("", true)).toBe(DOCUMENT_QA_SYSTEM_PROMPT);
  });

  test("perDocumentBudget fair-shares the total across selected docs", () => {
    expect(perDocumentBudget(1)).toBe(MAX_CHARS_PER_DOCUMENT);
    expect(perDocumentBudget(5)).toBe(
      Math.min(MAX_CHARS_PER_DOCUMENT, Math.floor(MAX_TOTAL_DIRECT_CHARS / 5))
    );
    expect(perDocumentBudget(5) * 5).toBeLessThanOrEqual(MAX_TOTAL_DIRECT_CHARS);
  });

  test("loadSelectedDocumentContext returns empty when no ids", async () => {
    const result = await loadSelectedDocumentContext({
      selectedDocumentIds: [],
    });
    expect(result.loadedCount).toBe(0);
    expect(result.requestedCount).toBe(0);
    expect(result.contextTexts).toEqual([]);
    expect(Document.content).not.toHaveBeenCalled();
  });

  test("loadSelectedDocumentContext injects direct document text first", async () => {
    Document.content.mockResolvedValueOnce({
      title: "Stock Report 2016-07.pdf",
      content:
        "Product Chang Units 105 | Reorder 17 | Stock 19\nGrandma Boysenberry Units 40",
    });

    const result = await loadSelectedDocumentContext({
      selectedDocumentIds: ["doc-1"],
      selectedDocuments: [{ docId: "doc-1", label: "Stock Report 2016-07.pdf" }],
    });

    expect(result.loadedCount).toBe(1);
    expect(result.requestedCount).toBe(1);
    expect(result.labels).toEqual(["Stock Report 2016-07.pdf"]);
    expect(result.truncatedLabels).toEqual([]);
    expect(result.contextTexts[0]).toContain("All selected documents loaded in full");
    expect(result.contextTexts[1]).toContain("Selected document (direct read)");
    expect(result.contextTexts[1]).toContain("Chang Units 105");
    expect(result.sources[0].docId).toBe("doc-1");
    expect(result.sources[0].score).toBe(1);
  });

  test("loadSelectedDocumentContext truncates oversized documents", async () => {
    const huge = "A".repeat(MAX_CHARS_PER_DOCUMENT + 5_000);
    Document.content.mockResolvedValueOnce({
      title: "big.pdf",
      content: huge,
    });

    const result = await loadSelectedDocumentContext({
      selectedDocumentIds: ["doc-big"],
    });

    expect(result.loadedCount).toBe(1);
    expect(result.truncatedLabels).toEqual(["big.pdf"]);
    expect(result.contextTexts[0]).toContain("Truncated for length: big.pdf");
    expect(result.contextTexts[1]).toContain("[...truncated for length");
    expect(result.contextTexts[1].length).toBeLessThan(
      MAX_CHARS_PER_DOCUMENT + 300
    );
  });

  test("loadSelectedDocumentContext gives every selected doc a fair share", async () => {
    const ids = Array.from({ length: 5 }, (_, i) => `doc-${i}`);
    for (const id of ids) {
      Document.content.mockResolvedValueOnce({
        title: `${id}.txt`,
        content: `content of ${id} `.repeat(100),
      });
    }

    const result = await loadSelectedDocumentContext({
      selectedDocumentIds: ids,
    });

    expect(result.requestedCount).toBe(5);
    expect(result.loadedCount).toBe(5);
    expect(result.labels).toHaveLength(5);
    expect(result.failedLabels).toEqual([]);
    expect(result.contextTexts[0]).toContain("Loaded 5/5");
    expect(Document.content).toHaveBeenCalledTimes(5);
  });

  test("loadSelectedDocumentContext respects MAX_SELECTED_DOCUMENTS", async () => {
    const ids = Array.from(
      { length: MAX_SELECTED_DOCUMENTS + 3 },
      (_, i) => `doc-${i}`
    );
    Document.content.mockImplementation(async (docId) => ({
      title: `${docId}.txt`,
      content: "ok",
    }));

    const result = await loadSelectedDocumentContext({
      selectedDocumentIds: ids,
    });

    expect(result.requestedCount).toBe(MAX_SELECTED_DOCUMENTS);
    expect(result.loadedCount).toBe(MAX_SELECTED_DOCUMENTS);
    expect(Document.content).toHaveBeenCalledTimes(MAX_SELECTED_DOCUMENTS);
  });

  test("loadSelectedDocumentContext skips failed documents", async () => {
    Document.content
      .mockRejectedValueOnce(new Error("missing"))
      .mockResolvedValueOnce({
        title: "ok.pdf",
        content: "hello",
      });

    const result = await loadSelectedDocumentContext({
      selectedDocumentIds: ["bad", "good"],
    });

    expect(result.loadedCount).toBe(1);
    expect(result.requestedCount).toBe(2);
    expect(result.labels).toEqual(["ok.pdf"]);
    expect(result.failedLabels).toEqual(["bad"]);
  });
});
