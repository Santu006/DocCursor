/* eslint-env jest, node */

jest.mock("../../../models/documents", () => ({
  Document: {
    get: jest.fn(),
    content: jest.fn(),
  },
}));

jest.mock("../../../models/workspace", () => ({
  Workspace: {
    get: jest.fn(),
  },
}));

jest.mock("../../../models/documentIntelligence", () => ({
  DocumentIntelligence: {
    markComplete: jest.fn(),
    detectFileType: jest.requireActual("../../../models/documentIntelligence")
      .DocumentIntelligence.detectFileType,
  },
}));

jest.mock("../../../utils/helpers", () => ({
  getLLMProvider: jest.fn(),
}));

jest.mock("../../../utils/agents/aibitat/utils/summarize", () => ({
  summarizeContent: jest.fn(),
}));

const { Document } = require("../../../models/documents");
const { Workspace } = require("../../../models/workspace");
const { DocumentIntelligence } = require("../../../models/documentIntelligence");
const { getLLMProvider } = require("../../../utils/helpers");
const { summarizeContent } = require("../../../utils/agents/aibitat/utils/summarize");
const {
  enrichDocument,
  parseClassificationJson,
  normalizeClassification,
  detectFileType,
  LONG_CONTENT_CHAR_THRESHOLD,
} = require("../../../utils/intelligence/enrichDocument");

describe("enrichDocument utilities", () => {
  describe("detectFileType", () => {
    it("returns extension without dot", () => {
      expect(detectFileType("contract.pdf")).toBe("pdf");
      expect(detectFileType("sheet.xlsx")).toBe("xlsx");
    });

    it("returns unknown when extension missing", () => {
      expect(detectFileType("README")).toBe("unknown");
    });
  });

  describe("parseClassificationJson", () => {
    it("parses raw JSON", () => {
      const parsed = parseClassificationJson(
        '{"category":"contract","summary":"A contract.","keyTopics":["fees"]}'
      );
      expect(parsed.category).toBe("contract");
      expect(parsed.keyTopics).toEqual(["fees"]);
    });

    it("parses fenced JSON", () => {
      const parsed = parseClassificationJson(
        '```json\n{"category":"invoice","summary":"An invoice.","keyTopics":["GST"]}\n```'
      );
      expect(parsed.category).toBe("invoice");
    });
  });

  describe("normalizeClassification", () => {
    it("normalizes valid payload", () => {
      const result = normalizeClassification({
        category: "agreement",
        summary: "  Retainer agreement. ",
        keyTopics: ["retainer", "  fees ", 123],
      });
      expect(result).toEqual({
        category: "agreement",
        summary: "Retainer agreement.",
        keyTopics: ["retainer", "fees"],
      });
    });

    it("falls back to other for invalid category", () => {
      const result = normalizeClassification({
        category: "not-a-real-category",
        summary: "Summary",
        keyTopics: [],
      });
      expect(result.category).toBe("other");
    });
  });
});

describe("enrichDocument", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("enriches a document and stores intelligence", async () => {
    Document.get.mockResolvedValue({
      docId: "doc-1",
      docpath: "custom-documents/test.json",
    });
    Document.content.mockResolvedValue({
      title: "TMC0058.pdf",
      content: "Client agrees to pay $25.00 and hourly legal fees.",
    });
    Workspace.get.mockResolvedValue({
      id: 1,
      chatProvider: "openai",
      chatModel: "gpt-4o",
    });
    getLLMProvider.mockReturnValue({
      getChatCompletion: jest.fn().mockResolvedValue({
        textResponse: JSON.stringify({
          category: "agreement",
          summary: "Legal fee and retainer agreement.",
          keyTopics: ["retainer", "legal fees"],
        }),
      }),
    });
    DocumentIntelligence.markComplete.mockResolvedValue({ id: 1 });

    const result = await enrichDocument({
      id: 1,
      docId: "doc-1",
      workspaceId: 1,
      filename: "TMC0058.pdf",
      fileType: "pdf",
    });

    expect(result.success).toBe(true);
    expect(summarizeContent).not.toHaveBeenCalled();
    expect(DocumentIntelligence.markComplete).toHaveBeenCalledWith(1, {
      category: "agreement",
      summary: "Legal fee and retainer agreement.",
      keyTopics: ["retainer", "legal fees"],
    });
  });

  it("uses summarizeContent for long documents", async () => {
    const longContent = "x".repeat(LONG_CONTENT_CHAR_THRESHOLD + 1);
    Document.get.mockResolvedValue({ docId: "doc-2" });
    Document.content.mockResolvedValue({
      title: "Big.pdf",
      content: longContent,
    });
    Workspace.get.mockResolvedValue({ id: 2, chatProvider: "openai" });
    summarizeContent.mockResolvedValue("Condensed key points");
    getLLMProvider.mockReturnValue({
      getChatCompletion: jest.fn().mockResolvedValue({
        textResponse: JSON.stringify({
          category: "contract",
          summary: "Condensed contract summary.",
          keyTopics: ["payment"],
        }),
      }),
    });
    DocumentIntelligence.markComplete.mockResolvedValue({ id: 2 });

    const result = await enrichDocument({
      id: 2,
      docId: "doc-2",
      workspaceId: 2,
      filename: "Big.pdf",
      fileType: "pdf",
    });

    expect(result.success).toBe(true);
    expect(summarizeContent).toHaveBeenCalled();
  });

  it("fails when model response is not parseable JSON", async () => {
    Document.get.mockResolvedValue({ docId: "doc-3" });
    Document.content.mockResolvedValue({
      title: "Bad.pdf",
      content: "Some content",
    });
    Workspace.get.mockResolvedValue({ id: 3 });
    getLLMProvider.mockReturnValue({
      getChatCompletion: jest.fn().mockResolvedValue({
        textResponse: "not json",
      }),
    });

    const result = await enrichDocument({
      id: 3,
      docId: "doc-3",
      workspaceId: 3,
      filename: "Bad.pdf",
      fileType: "pdf",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/parse intelligence JSON/i);
  });
});
