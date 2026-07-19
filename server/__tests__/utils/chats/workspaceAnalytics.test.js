/* eslint-env jest, node */

jest.mock("../../../models/documents", () => ({
  Document: {
    forWorkspace: jest.fn(),
    content: jest.fn(),
  },
}));

const { Document } = require("../../../models/documents");
const {
  detectOperations,
  isAnalyticalQuery,
  longestCommonSuffix,
  splitCategoryProduct,
  parseStockReports,
  computeProductStats,
  performWorkspaceAnalytics,
  applyAnalyticsSystemPrompt,
  ANALYTICS_SYSTEM_PROMPT,
} = require("../../../utils/chats/workspaceAnalytics");

function reportDoc(period, rows) {
  return {
    content: `Stock Report for ${period}\nCategoryProductUnits SoldUnits in StockUnit Price\n${rows.join(
      "\n"
    )}`,
    title: `StockReport_${period}.pdf`,
  };
}

describe("workspaceAnalytics", () => {
  beforeEach(() => {
    Document.forWorkspace.mockReset();
    Document.content.mockReset();
  });

  test("detects analytical operations and context", () => {
    expect(detectOperations("give me average of each product")).toEqual([
      "average",
    ]);
    expect(detectOperations("which product sold the most")).toEqual(["highest"]);
    expect(isAnalyticalQuery("give me average of each product")).toBe(true);
    expect(isAnalyticalQuery("summarize the contract")).toBe(false);
    expect(isAnalyticalQuery("highest mountain in the world")).toBe(false);
  });

  test("longestCommonSuffix isolates stable stock+price columns", () => {
    expect(longestCommonSuffix(["1051719", "401719", "2011719"])).toBe("1719");
    expect(longestCommonSuffix(["204.5", "204.5"])).toBe("204.5");
  });

  test("splitCategoryProduct strips known category prefix", () => {
    expect(splitCategoryProduct("BeveragesChang")).toEqual({
      category: "Beverages",
      product: "Chang",
    });
    expect(splitCategoryProduct("UnknownFoo")).toEqual({
      category: null,
      product: "UnknownFoo",
    });
  });

  test("parseStockReports extracts per-month units sold via common suffix", async () => {
    Document.content
      .mockResolvedValueOnce(
        reportDoc("2016-07", ["BeveragesChang1051719", "BeveragesChai153918"])
      )
      .mockResolvedValueOnce(
        reportDoc("2017-02", ["BeveragesChang401719", "BeveragesChai633918"])
      );

    const { products, reportCount } = await parseStockReports([
      { docId: "d1" },
      { docId: "d2" },
    ]);

    expect(reportCount).toBe(2);
    const chang = products.find((p) => p.product === "Chang");
    expect(chang.stockPriceColumns).toBe("1719");
    expect(chang.months.map((m) => m.unitsSold)).toEqual([105, 40]);
  });

  test("computeProductStats returns average/total/max/min", () => {
    const [stats] = computeProductStats([
      {
        name: "BeveragesChang",
        product: "Chang",
        category: "Beverages",
        stockPriceColumns: "1719",
        months: [
          { period: "2016-07", unitsSold: 105 },
          { period: "2017-02", unitsSold: 55 },
        ],
      },
    ]);
    expect(stats.stats.total).toBe(160);
    expect(stats.stats.average).toBe(80);
    expect(stats.stats.max).toEqual({ value: 105, period: "2016-07" });
    expect(stats.stats.min).toEqual({ value: 55, period: "2017-02" });
  });

  test("performWorkspaceAnalytics builds computed context and source", async () => {
    Document.forWorkspace.mockResolvedValue([{ docId: "d1" }, { docId: "d2" }]);
    Document.content
      .mockResolvedValueOnce(
        reportDoc("2016-07", ["BeveragesChang1051719", "BeveragesChai153918"])
      )
      .mockResolvedValueOnce(
        reportDoc("2017-02", ["BeveragesChang401719", "BeveragesChai633918"])
      );

    const result = await performWorkspaceAnalytics({
      workspaceId: 2,
      message: "give me average of each product",
    });

    expect(result.handled).toBe(true);
    expect(result.reportCount).toBe(2);
    expect(result.productCount).toBe(2);
    expect(result.contextTexts[0]).toContain("Computed stock analytics");
    expect(result.contextTexts[0]).toContain("Chang (Beverages)");
    expect(result.sources[0].chunkSource).toBe("analytics://units-sold");
  });

  test("performWorkspaceAnalytics ignores non-analytical queries", async () => {
    const result = await performWorkspaceAnalytics({
      workspaceId: 2,
      message: "summarize this contract",
    });
    expect(result.handled).toBe(false);
    expect(Document.forWorkspace).not.toHaveBeenCalled();
  });

  test("applyAnalyticsSystemPrompt appends only when analytics present", () => {
    expect(applyAnalyticsSystemPrompt("Base", false)).toBe("Base");
    expect(applyAnalyticsSystemPrompt("Base", true)).toContain(
      ANALYTICS_SYSTEM_PROMPT
    );
  });
});
