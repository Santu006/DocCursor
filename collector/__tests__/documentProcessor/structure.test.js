/* eslint-env jest, node */

const {
  parseMarkdownStructure,
  parseCsvStructure,
  parsePresentationStructure,
} = require("../../utils/documentProcessor/structure");

describe("documentProcessor structure", () => {
  describe("parseMarkdownStructure", () => {
    it("extracts headings and top-level sections", () => {
      const content = `# Overview\n\n## Billing\n\nDetails\n\n### Fees`;
      const result = parseMarkdownStructure(content);
      expect(result.headings).toEqual(["Overview", "Billing", "Fees"]);
      expect(result.sections).toEqual(["Overview", "Billing"]);
    });
  });

  describe("parseCsvStructure", () => {
    it("builds schema summary and column metadata", () => {
      const content = "name,amount,status\nAlice,10,open\nBob,20,closed";
      const result = parseCsvStructure(content);
      expect(result.columns).toEqual(["name", "amount", "status"]);
      expect(result.rowCount).toBe(2);
      expect(result.schemaSummary).toContain("Columns (3)");
    });
  });

  describe("parsePresentationStructure", () => {
    it("splits slides and titles", () => {
      const content = "Intro slide\n\nDetails here\n\nSecond slide title\n\nMore text";
      const result = parsePresentationStructure(content);
      expect(result.slideCount).toBeGreaterThan(0);
      expect(result.structuredText).toContain("## Slide");
    });
  });
});
