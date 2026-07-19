const { Document } = require("../../models/documents");

const MAX_WORKSPACE_DOCUMENTS = 250;
const MAX_MATCHING_DOCUMENTS = 8;
const MAX_MATCHES_PER_DOCUMENT = 3;
const MAX_MATCH_SPAN_CHARS = 600;
const CONTEXT_PADDING_CHARS = 220;

const REVERSE_LOOKUP_PATTERN =
  /\b(which|what|where|find|locate|match|matching|contains?|has|have|product|invoice|document|file|row|record|entry)\b/i;

const EXACT_SEARCH_SYSTEM_PROMPT = `Exact workspace search results are present in Context.
Treat each result as a literal excerpt from the named document.
For numeric or table lookups, answer only when every requested value occurs in the same matching excerpt.
Identify the matching product, row, record, or document from the text adjacent to those values.
Preserve values exactly. If no supplied exact-search excerpt contains the requested combination, say "Not found in the provided document(s)."
Cite the source filename for every match.`;

/**
 * Pull literal values from reverse-lookup questions. Digits are intentionally
 * allowed next to letters so a typo such as "Pric55" still extracts "55".
 *
 * @param {string} message
 * @returns {string[]}
 */
function extractExactSearchValues(message = "") {
  const numericValues =
    String(message)
      .match(/[-+]?\d[\d,]*(?:\.\d+)?%?/g)
      ?.map((value) => value.replace(/,$/, "")) || [];
  return [...new Set(numericValues)];
}

/**
 * Exact scanning is deliberately narrow because it reads workspace document
 * text. Two numeric values are enough; a single value needs lookup language.
 *
 * @param {string} message
 * @returns {boolean}
 */
function isExactValueLookupQuery(message = "") {
  const values = extractExactSearchValues(message);
  if (values.length >= 2) return true;
  return values.length === 1 && REVERSE_LOOKUP_PATTERN.test(message);
}

function documentLabel(document, fallback = "Document") {
  try {
    const metadata = JSON.parse(document?.metadata || "{}");
    return metadata?.title || document?.filename || fallback;
  } catch {
    return document?.filename || fallback;
  }
}

function valuePatternBody(value) {
  const suffix = value.endsWith("%") ? "%" : "";
  const unsigned = value.replace(/%$/, "").replace(/,/g, "");
  const sign = unsigned.match(/^[-+]/)?.[0] || "";
  const number = unsigned.replace(/^[-+]/, "");
  const [whole, decimal] = number.split(".");
  const groupedWhole = whole
    .split("")
    .map((digit, index) => (index ? `,?${digit}` : digit))
    .join("");
  return `${sign ? `\\${sign}` : ""}${groupedWhole}${
    decimal ? `\\.${decimal}` : ""
  }${suffix ? "\\%" : ""}`;
}

function valuePattern(value) {
  return new RegExp(
    `(?<![\\d.,])${valuePatternBody(value)}(?![\\d.,])`,
    "g"
  );
}

function orderedSequencePattern(values) {
  const separator = "[\\s|;:/-]*";
  const sequence = values.map(valuePatternBody).join(separator);
  return new RegExp(`(?<![\\d.,])${sequence}(?![\\d.,])`, "g");
}

function positionsForValue(text, value) {
  return [...text.matchAll(valuePattern(value))].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

/**
 * Find compact spans containing all requested values. This is row-oriented
 * while tolerating PDF table extraction that puts cells on nearby lines.
 *
 * @param {string} text
 * @param {string[]} values
 * @returns {{start: number, end: number}[]}
 */
function findMatchingSpans(text = "", values = []) {
  if (!text || !values.length) return [];

  // PDF table extraction can flatten a row such as
  // "Chang | 55 | 17 | 19" into "Chang551719". Match the requested ordered
  // value sequence before relying on individual numeric boundaries.
  const sequenceMatches = [
    ...String(text).matchAll(orderedSequencePattern(values)),
  ].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  if (sequenceMatches.length > 0) {
    return sequenceMatches.slice(0, MAX_MATCHES_PER_DOCUMENT);
  }

  const positionsByValue = values.map((value) =>
    positionsForValue(String(text), value)
  );
  if (positionsByValue.some((positions) => positions.length === 0)) return [];

  const candidates = [];
  for (const anchor of positionsByValue[0]) {
    const selected = [anchor];
    let valid = true;

    for (const positions of positionsByValue.slice(1)) {
      const nearest = positions.reduce((best, position) => {
        const distance = Math.abs(position.start - anchor.start);
        if (!best || distance < best.distance) return { position, distance };
        return best;
      }, null);
      if (!nearest) {
        valid = false;
        break;
      }
      selected.push(nearest.position);
    }

    if (!valid) continue;
    const start = Math.min(...selected.map((position) => position.start));
    const end = Math.max(...selected.map((position) => position.end));
    if (end - start <= MAX_MATCH_SPAN_CHARS) candidates.push({ start, end });
  }

  return candidates
    .sort((a, b) => a.end - a.start - (b.end - b.start))
    .filter(
      (span, index, spans) =>
        spans.findIndex(
          (other) =>
            Math.abs(other.start - span.start) < CONTEXT_PADDING_CHARS / 2
        ) === index
    )
    .slice(0, MAX_MATCHES_PER_DOCUMENT);
}

function excerptForSpan(text, span) {
  const start = Math.max(0, span.start - CONTEXT_PADDING_CHARS);
  const end = Math.min(text.length, span.end + CONTEXT_PADDING_CHARS);
  return String(text)
    .slice(start, end)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * @param {{workspaceId: number|string, message: string}} params
 * @returns {Promise<{handled: boolean, values: string[], contextTexts: string[], sources: object[], matchCount: number, documentCount: number}>}
 */
async function performWorkspaceExactSearch({ workspaceId, message } = {}) {
  const values = extractExactSearchValues(message);
  if (!workspaceId || !isExactValueLookupQuery(message)) {
    return {
      handled: false,
      values,
      contextTexts: [],
      sources: [],
      matchCount: 0,
      documentCount: 0,
    };
  }

  const documents = (await Document.forWorkspace(workspaceId)).slice(
    0,
    MAX_WORKSPACE_DOCUMENTS
  );
  const matches = [];

  // Small batches avoid opening every workspace document simultaneously.
  for (let index = 0; index < documents.length; index += 10) {
    const batch = documents.slice(index, index + 10);
    const results = await Promise.all(
      batch.map(async (document) => {
        try {
          const { title, content } = await Document.content(document.docId);
          const spans = findMatchingSpans(content, values);
          if (!spans.length) return null;
          return {
            document,
            title: documentLabel(document, title || document.docId),
            excerpts: spans.map((span) => excerptForSpan(content, span)),
          };
        } catch (error) {
          console.warn(
            `[WorkspaceExactSearch] Failed docId=${document.docId}: ${error.message}`
          );
          return null;
        }
      })
    );

    matches.push(...results.filter(Boolean));
    if (matches.length >= MAX_MATCHING_DOCUMENTS) break;
  }

  const limitedMatches = matches.slice(0, MAX_MATCHING_DOCUMENTS);
  const contextTexts = limitedMatches.map(
    ({ title, excerpts }) =>
      `Exact workspace match in: ${title}\nRequested values: ${values.join(
        ", "
      )}\n\n${excerpts
        .map((excerpt, index) => `Match ${index + 1}:\n${excerpt}`)
        .join("\n\n")}`
  );
  const sources = limitedMatches.map(({ document, title, excerpts }) => ({
    title,
    docId: document.docId,
    chunkSource: `exact://${document.docId}`,
    text: excerpts.join("\n\n").slice(0, 1_000),
    score: 1,
  }));

  return {
    handled: true,
    values,
    contextTexts,
    sources,
    matchCount: limitedMatches.reduce(
      (count, match) => count + match.excerpts.length,
      0
    ),
    documentCount: limitedMatches.length,
  };
}

function applyExactSearchSystemPrompt(systemPrompt = "", hasMatches = false) {
  if (!hasMatches) return systemPrompt;
  const base = String(systemPrompt || "").trim();
  return base
    ? `${base}\n\n${EXACT_SEARCH_SYSTEM_PROMPT}`
    : EXACT_SEARCH_SYSTEM_PROMPT;
}

module.exports = {
  extractExactSearchValues,
  isExactValueLookupQuery,
  findMatchingSpans,
  performWorkspaceExactSearch,
  applyExactSearchSystemPrompt,
  EXACT_SEARCH_SYSTEM_PROMPT,
  MAX_MATCH_SPAN_CHARS,
};
