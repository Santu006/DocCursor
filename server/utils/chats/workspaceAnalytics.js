const { Document } = require("../../models/documents");

const MAX_WORKSPACE_DOCUMENTS = 250;
const MAX_PRODUCTS_IN_CONTEXT = 80;

// Northwind-style stock report categories are concatenated onto the product
// name during PDF extraction. Stripping a known leading category makes the
// computed table readable without guessing word boundaries.
const KNOWN_CATEGORIES = [
  "Beverages",
  "Condiments",
  "Confections",
  "Dairy Products",
  "Grains/Cereals",
  "Meat/Poultry",
  "Produce",
  "Seafood",
];

const ANALYTICS_SYSTEM_PROMPT = `Computed analytics are provided in Context under "Computed stock analytics" and may also appear in the user message.
These figures were calculated deterministically from the workspace stock reports; treat them as exact ground truth.
Answer the user's aggregation question (average, total, highest, lowest, etc.) using ONLY these computed values.
Do NOT reply "Not found in the provided document(s)" when Computed stock analytics are present — use those numbers.
Do not recalculate from raw PDF rows and do not invent numbers.
Ignore flattened raw document rows for aggregation; prefer the computed table.
Units Sold is reliably separated per month; Units in Stock and Unit Price are stored fused in the source and are shown as a combined "stock+price" reference only — do not split them or report a standalone stock/price value unless it is explicitly listed.
Cite the source as the workspace stock reports.
Format:
## Answer
- concise bullets or a short table of the requested averages/totals
## Evidence
- "Computed from N monthly stock reports"
## Not found / Uncertain
- only for metrics that were not computed (e.g. standalone unit price averages)`;

const OPERATIONS = [
  { key: "average", patterns: [/\baverage\b/i, /\bavg\b/i, /\bmean\b/i] },
  { key: "total", patterns: [/\btotal\b/i, /\bsum\b/i, /\bcombined\b/i] },
  {
    key: "highest",
    patterns: [/\bhighest\b/i, /\bmax(imum)?\b/i, /\bmost\b/i, /\btop\b/i, /\bbest[\s-]?sell/i],
  },
  {
    key: "lowest",
    patterns: [/\blowest\b/i, /\bmin(imum)?\b/i, /\bleast\b/i, /\bworst[\s-]?sell/i, /\bfewest\b/i],
  },
];

const ANALYTICS_CONTEXT_PATTERN =
  /\b(product|products|sold|sales|units?|stock|inventory|report|each|per|across|month|overall)\b/i;

/**
 * @param {string} message
 * @returns {string[]} matched operation keys
 */
function detectOperations(message = "") {
  return OPERATIONS.filter((op) =>
    op.patterns.some((pattern) => pattern.test(message))
  ).map((op) => op.key);
}

/**
 * @param {string} message
 * @returns {boolean}
 */
function isAnalyticalQuery(message = "") {
  if (!message || typeof message !== "string") return false;
  const operations = detectOperations(message);
  if (!operations.length) return false;
  return ANALYTICS_CONTEXT_PATTERN.test(message);
}

/**
 * @param {string[]} values
 * @returns {string} longest common suffix
 */
function longestCommonSuffix(values = []) {
  if (!values.length) return "";
  let suffix = values[0];
  for (const value of values.slice(1)) {
    let i = 0;
    while (
      i < suffix.length &&
      i < value.length &&
      suffix[suffix.length - 1 - i] === value[value.length - 1 - i]
    ) {
      i++;
    }
    suffix = suffix.slice(suffix.length - i);
    if (!suffix) break;
  }
  return suffix;
}

/**
 * @param {string} name
 * @returns {{category: string|null, product: string}}
 */
function splitCategoryProduct(name = "") {
  for (const category of KNOWN_CATEGORIES) {
    if (name.startsWith(category)) {
      return { category, product: name.slice(category.length).trim() || name };
    }
  }
  return { category: null, product: name };
}

/**
 * Parse workspace stock reports into per-product monthly Units Sold series.
 * Units Sold is the per-month variable prefix; the stable trailing digits are
 * the fused Units-in-Stock + Unit-Price columns.
 *
 * @param {object[]} documents
 * @returns {Promise<{products: object[], reportCount: number, reportTitles: string[]}>}
 */
async function parseStockReports(documents = []) {
  const byName = new Map();
  const reportTitles = [];
  let reportCount = 0;

  for (const document of documents) {
    let content;
    let title;
    try {
      ({ content, title } = await Document.content(document.docId));
    } catch {
      continue;
    }
    if (!content || !/stock report/i.test(content)) continue;

    const lines = String(content).split(/\n+/);
    const periodMatch = lines[0]?.match(/stock report for\s+(\S+)/i);
    const period = periodMatch ? periodMatch[1] : title || document.docId;

    let rowsFound = false;
    for (const line of lines) {
      if (/^stock report/i.test(line)) continue;
      if (/unit\s*price/i.test(line)) continue;
      const match = line.match(/^(.*?[A-Za-z.])(\d[\d.]*)$/);
      if (!match) continue;
      const name = match[1].trim();
      const digits = match[2];
      if (!name || !digits) continue;
      rowsFound = true;

      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push({ period, digits });
    }

    if (rowsFound) {
      reportCount += 1;
      reportTitles.push(title || document.docId);
    }
  }

  const products = [];
  for (const [name, entries] of byName.entries()) {
    const suffix = longestCommonSuffix(entries.map((entry) => entry.digits));
    const months = [];
    let parseable = true;

    for (const entry of entries) {
      const prefix = suffix
        ? entry.digits.slice(0, entry.digits.length - suffix.length)
        : entry.digits;
      if (!/^\d+$/.test(prefix)) {
        parseable = false;
        break;
      }
      months.push({ period: entry.period, unitsSold: Number(prefix) });
    }

    if (!parseable || months.length === 0) continue;
    const { category, product } = splitCategoryProduct(name);
    products.push({
      name,
      product,
      category,
      stockPriceColumns: suffix || null,
      months,
    });
  }

  return { products, reportCount, reportTitles };
}

/**
 * @param {object[]} products
 * @returns {object[]} products with computed unitsSold statistics
 */
function computeProductStats(products = []) {
  return products
    .map((entry) => {
      const series = entry.months;
      const values = series.map((m) => m.unitsSold);
      const total = values.reduce((sum, value) => sum + value, 0);
      const count = values.length;
      const average = count ? total / count : 0;
      const peak = series.reduce(
        (best, m) => (!best || m.unitsSold > best.unitsSold ? m : best),
        null
      );
      const trough = series.reduce(
        (worst, m) => (!worst || m.unitsSold < worst.unitsSold ? m : worst),
        null
      );
      return {
        ...entry,
        stats: {
          count,
          total,
          average: Math.round(average * 100) / 100,
          max: peak ? { value: peak.unitsSold, period: peak.period } : null,
          min: trough ? { value: trough.unitsSold, period: trough.period } : null,
        },
      };
    })
    .sort((a, b) => b.stats.total - a.stats.total);
}

function formatProductLabel(entry) {
  if (entry.category) return `${entry.product} (${entry.category})`;
  return entry.product || entry.name;
}

/**
 * @param {object[]} statsProducts
 * @param {string[]} operations
 * @param {number} reportCount
 * @returns {string}
 */
function buildAnalyticsContext(statsProducts, operations, reportCount) {
  const headerBits = [
    `Computed stock analytics (Units Sold) across ${reportCount} monthly stock report(s).`,
    `Metric: Units Sold per product, aggregated over all available months.`,
  ];

  if (operations.includes("highest")) {
    const top = statsProducts[0];
    if (top) {
      headerBits.push(
        `Highest total Units Sold: ${formatProductLabel(top)} = ${top.stats.total} units (avg ${top.stats.average}/month over ${top.stats.count} months).`
      );
    }
  }
  if (operations.includes("lowest")) {
    const bottom = statsProducts[statsProducts.length - 1];
    if (bottom) {
      headerBits.push(
        `Lowest total Units Sold: ${formatProductLabel(bottom)} = ${bottom.stats.total} units (avg ${bottom.stats.average}/month over ${bottom.stats.count} months).`
      );
    }
  }

  const rows = statsProducts
    .slice(0, MAX_PRODUCTS_IN_CONTEXT)
    .map((entry) => {
      const s = entry.stats;
      const suffix = entry.stockPriceColumns
        ? ` | stock+price columns (fused, not separated): ${entry.stockPriceColumns}`
        : "";
      return `- ${formatProductLabel(entry)}: avg ${s.average}, total ${s.total}, max ${s.max?.value} (${s.max?.period}), min ${s.min?.value} (${s.min?.period}), months ${s.count}${suffix}`;
    })
    .join("\n");

  return `${headerBits.join("\n")}\n\nPer-product Units Sold summary:\n${rows}`;
}

/**
 * @param {{workspaceId: number|string, message: string}} params
 * @returns {Promise<{handled: boolean, operations: string[], contextTexts: string[], sources: object[], productCount: number, reportCount: number}>}
 */
async function performWorkspaceAnalytics({ workspaceId, message } = {}) {
  const operations = detectOperations(message);
  if (!workspaceId || !isAnalyticalQuery(message)) {
    return {
      handled: false,
      operations,
      contextTexts: [],
      sources: [],
      productCount: 0,
      reportCount: 0,
    };
  }

  const documents = (await Document.forWorkspace(workspaceId)).slice(
    0,
    MAX_WORKSPACE_DOCUMENTS
  );
  const { products, reportCount, reportTitles } = await parseStockReports(
    documents
  );

  if (!products.length || reportCount === 0) {
    return {
      handled: false,
      operations,
      contextTexts: [],
      sources: [],
      productCount: 0,
      reportCount,
    };
  }

  const statsProducts = computeProductStats(products);
  const contextTexts = [
    buildAnalyticsContext(statsProducts, operations, reportCount),
  ];
  const sources = [
    {
      title: `Workspace stock reports (${reportCount} files)`,
      chunkSource: "analytics://units-sold",
      text: reportTitles.slice(0, 12).join(", "),
      score: 1,
    },
  ];

  return {
    handled: true,
    operations,
    contextTexts,
    sources,
    productCount: statsProducts.length,
    reportCount,
  };
}

function applyAnalyticsSystemPrompt(systemPrompt = "", hasAnalytics = false) {
  if (!hasAnalytics) return systemPrompt;
  const base = String(systemPrompt || "").trim();
  return base ? `${base}\n\n${ANALYTICS_SYSTEM_PROMPT}` : ANALYTICS_SYSTEM_PROMPT;
}

module.exports = {
  detectOperations,
  isAnalyticalQuery,
  longestCommonSuffix,
  splitCategoryProduct,
  parseStockReports,
  computeProductStats,
  performWorkspaceAnalytics,
  applyAnalyticsSystemPrompt,
  ANALYTICS_SYSTEM_PROMPT,
};
