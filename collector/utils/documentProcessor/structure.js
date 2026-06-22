/**
 * Parse markdown heading hierarchy (# ## ###).
 * @param {string} content
 * @returns {{ headings: string[], sections: string[] }}
 */
function parseMarkdownStructure(content = "") {
  const headings = [];
  const sections = [];

  for (const line of String(content).split("\n")) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (!match) continue;
    const level = match[1].length;
    const title = match[2].trim();
    headings.push(title);
    if (level <= 2) sections.push(title);
  }

  return { headings, sections };
}

/**
 * @param {string} content
 * @returns {{ columns: string[], rowCount: number, schemaSummary: string }}
 */
function parseCsvStructure(content = "") {
  const lines = String(content)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { columns: [], rowCount: 0, schemaSummary: "Empty CSV file." };
  }

  const columns = lines[0]
    .split(",")
    .map((cell) => cell.replace(/^"|"$/g, "").trim())
    .filter(Boolean);
  const rowCount = Math.max(lines.length - 1, 0);
  const schemaSummary = [
    "CSV schema summary:",
    `- Columns (${columns.length}): ${columns.join(", ") || "none"}`,
    `- Data rows: ${rowCount}`,
    "",
  ].join("\n");

  return { columns, rowCount, schemaSummary };
}

/**
 * Split presentation text into slide-like sections.
 * @param {string} content
 * @returns {{ slideTitles: string[], slideCount: number, structuredText: string }}
 */
function parsePresentationStructure(content = "") {
  const raw = String(content).trim();
  if (!raw) {
    return { slideTitles: [], slideCount: 0, structuredText: "" };
  }

  const chunks = raw
    .split(/\f|\n{2,}(?=Slide\s+\d+|\[Slide)/i)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const slides = chunks.length > 1 ? chunks : raw.split(/\n{2,}/).filter(Boolean);
  const slideTitles = slides.map((slide, index) => {
    const firstLine = slide.split("\n").find((line) => line.trim()) || "";
    return firstLine.trim().slice(0, 120) || `Slide ${index + 1}`;
  });

  const structuredText = slides
    .map((slide, index) => {
      const title = slideTitles[index];
      return `## Slide ${index + 1}: ${title}\n\n${slide}`;
    })
    .join("\n\n");

  return {
    slideTitles,
    slideCount: slides.length,
    structuredText: structuredText || raw,
  };
}

/**
 * Extract heading-like lines from plain text (ALL CAPS or numbered sections).
 * @param {string} content
 * @returns {string[]}
 */
function extractPlainTextHeadings(content = "") {
  const headings = [];
  for (const line of String(content).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 120) continue;
    if (/^(?:\d+\.|\d+\))\s+\S/.test(trimmed)) headings.push(trimmed);
    else if (
      trimmed === trimmed.toUpperCase() &&
      /[A-Z]/.test(trimmed) &&
      trimmed.split(/\s+/).length <= 12
    ) {
      headings.push(trimmed);
    }
  }
  return headings.slice(0, 40);
}

module.exports = {
  parseMarkdownStructure,
  parseCsvStructure,
  parsePresentationStructure,
  extractPlainTextHeadings,
};
