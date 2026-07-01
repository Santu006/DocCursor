/* eslint-env jest, node */

jest.mock("../../../models/documents", () => ({
  Document: {
    forWorkspace: jest.fn(),
  },
}));

const { Document } = require("../../../models/documents");
const {
  normalizeSelectedDocumentIds,
  hasDocumentMentionScope,
} = require("../../../utils/chats/documentMention");

describe("documentMention", () => {
  beforeEach(() => {
    Document.forWorkspace.mockResolvedValue([
      { docId: "doc-a", filename: "a.pdf" },
      { docId: "doc-b", filename: "b.pdf" },
    ]);
  });

  test("normalizeSelectedDocumentIds filters invalid ids", async () => {
    const result = await normalizeSelectedDocumentIds(1, [
      "doc-a",
      "doc-b",
      "missing",
      "",
      "doc-a",
    ]);
    expect(result).toEqual(["doc-a", "doc-b"]);
  });

  test("hasDocumentMentionScope is false for empty input", () => {
    expect(hasDocumentMentionScope([])).toBe(false);
    expect(hasDocumentMentionScope(null)).toBe(false);
  });

  test("hasDocumentMentionScope is true when ids present", () => {
    expect(hasDocumentMentionScope(["doc-a"])).toBe(true);
  });
});
