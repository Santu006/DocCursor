/* eslint-env jest, node */

process.env.NODE_ENV = "development";

const {
  getProcessor,
  listSupportedExtensions,
  isSupportedByProcessor,
} = require("../../utils/documentProcessor/registry");

describe("documentProcessor registry", () => {
  it("lists phase 4 extensions", () => {
    const extensions = listSupportedExtensions();
    expect(extensions).toEqual(
      expect.arrayContaining([
        ".pdf",
        ".docx",
        ".md",
        ".txt",
        ".csv",
        ".xlsx",
        ".pptx",
      ])
    );
  });

  it("resolves processors by extension", () => {
    expect(getProcessor(".docx")?.id).toBe("docx");
    expect(getProcessor(".csv")?.id).toBe("csv");
    expect(getProcessor(".pptx")?.id).toBe("pptx");
    expect(isSupportedByProcessor(".md")).toBe(true);
  });
});
