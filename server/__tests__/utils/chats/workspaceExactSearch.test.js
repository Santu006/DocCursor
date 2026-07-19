/* eslint-env jest, node */

jest.mock("../../../models/documents", () => ({
  Document: {
    forWorkspace: jest.fn(),
    content: jest.fn(),
  },
}));

const { Document } = require("../../../models/documents");
const {
  extractExactSearchValues,
  isExactValueLookupQuery,
  findMatchingSpans,
  performWorkspaceExactSearch,
  applyExactSearchSystemPrompt,
  EXACT_SEARCH_SYSTEM_PROMPT,
} = require("../../../utils/chats/workspaceExactSearch");

describe("workspaceExactSearch", () => {
  beforeEach(() => {
    Document.forWorkspace.mockReset();
    Document.content.mockReset();
  });

  test("extracts numeric values even when attached to a mistyped word", () => {
    expect(
      extractExactSearchValues(
        "Units Sold Units in Stock Unit Pric55 17 19 which product"
      )
    ).toEqual(["55", "17", "19"]);
  });

  test("detects multi-value and single-value reverse lookups", () => {
    expect(isExactValueLookupQuery("which product has 55 17 19")).toBe(true);
    expect(isExactValueLookupQuery("which invoice has 1,250.00")).toBe(true);
    expect(isExactValueLookupQuery("summarize the annual report")).toBe(false);
  });

  test("requires all values within a compact document span", () => {
    expect(
      findMatchingSpans("Pavlova | 55 | 17 | 19", ["55", "17", "19"])
    ).toHaveLength(1);
    expect(
      findMatchingSpans("BeveragesChang551719\nBeveragesChai303918", [
        "55",
        "17",
        "19",
      ])
    ).toHaveLength(1);
    expect(
      findMatchingSpans(
        `55${"x".repeat(700)}17 19`,
        ["55", "17", "19"]
      )
    ).toHaveLength(0);
  });

  test("does not match requested values inside larger numbers", () => {
    expect(findMatchingSpans("Product A | 155 | 17 | 19", ["55", "17", "19"]))
      .toHaveLength(0);
  });

  test("returns exact excerpts and source metadata from matching documents", async () => {
    Document.forWorkspace.mockResolvedValue([
      {
        docId: "doc-1",
        filename: "Stock Report 2016-07.pdf",
        metadata: JSON.stringify({ title: "Stock Report 2016-07.pdf" }),
      },
      {
        docId: "doc-2",
        filename: "Stock Report 2017-11.pdf",
        metadata: "{}",
      },
    ]);
    Document.content
      .mockResolvedValueOnce({
        title: "Stock Report 2016-07.pdf",
        content:
          "Product | Units Sold | Units in Stock | Unit Price\nPavlova | 55 | 17 | 19",
      })
      .mockResolvedValueOnce({
        title: "Stock Report 2017-11.pdf",
        content: "Product | Units Sold | Units in Stock\nChang | 105 | 12",
      });

    const result = await performWorkspaceExactSearch({
      workspaceId: 2,
      message:
        "Units Sold Units in Stock Unit Pric55 17 19 which product have this prices",
    });

    expect(result.handled).toBe(true);
    expect(result.values).toEqual(["55", "17", "19"]);
    expect(result.documentCount).toBe(1);
    expect(result.matchCount).toBe(1);
    expect(result.contextTexts[0]).toContain("Pavlova | 55 | 17 | 19");
    expect(result.sources[0]).toMatchObject({
      title: "Stock Report 2016-07.pdf",
      docId: "doc-1",
      chunkSource: "exact://doc-1",
      score: 1,
    });
  });

  test("adds exact-search grounding instructions only when matches exist", () => {
    expect(applyExactSearchSystemPrompt("Base", false)).toBe("Base");
    expect(applyExactSearchSystemPrompt("Base", true)).toContain(
      EXACT_SEARCH_SYSTEM_PROMPT
    );
  });
});
