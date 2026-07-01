const path = require("path");
const prisma = require("../utils/prisma");
const { safeJsonParse } = require("../utils/http");

const STATUSES = ["pending", "processing", "complete", "failed"];

/**
 * @param {string} filename
 * @returns {string}
 */
function detectFileType(filename = "") {
  const ext = path.extname(String(filename)).toLowerCase().replace(/^\./, "");
  if (!ext) return "unknown";
  return ext;
}

/**
 * @param {object} record
 * @returns {object}
 */
function formatRecord(record) {
  if (!record) return null;
  return {
    ...record,
    keyTopics: safeJsonParse(record.keyTopics, []),
    keywords: safeJsonParse(record.keywords, []),
  };
}

const DocumentIntelligence = {
  STATUSES,
  detectFileType,

  /**
   * @param {object} params
   * @param {string} params.docId
   * @param {number} params.workspaceId
   * @param {string} params.filename
   * @param {string} [params.fileType]
   */
  createPending: async function ({
    docId,
    workspaceId,
    filename,
    fileType = null,
  }) {
    if (!docId || !workspaceId || !filename) return null;

    const resolvedFileType = fileType || detectFileType(filename);
    try {
      return await prisma.document_intelligence.upsert({
        where: { docId: String(docId) },
        create: {
          docId: String(docId),
          workspaceId: Number(workspaceId),
          filename: String(filename),
          fileType: resolvedFileType,
          status: "pending",
        },
        update: {
          filename: String(filename),
          fileType: resolvedFileType,
          status: "pending",
          error: null,
          category: null,
          documentType: null,
          summary: null,
          keyTopics: null,
          keywords: null,
          confidenceScore: null,
          enrichedAt: null,
          lastUpdatedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("[DocumentIntelligence] createPending failed:", error.message);
      return null;
    }
  },

  getByDocId: async function (docId) {
    try {
      const record = await prisma.document_intelligence.findUnique({
        where: { docId: String(docId) },
      });
      return formatRecord(record);
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  forWorkspace: async function (
    workspaceId,
    { status = null, category = null, limit = 100, offset = 0 } = {}
  ) {
    try {
      const records = await prisma.document_intelligence.findMany({
        where: {
          workspaceId: Number(workspaceId),
          ...(status ? { status: String(status) } : {}),
          ...(category ? { category: String(category) } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: Number(limit) || 100,
        skip: Number(offset) || 0,
      });
      return records.map(formatRecord);
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  /**
   * Load every complete intelligence record for a workspace (batched for scale).
   * @param {number} workspaceId
   * @param {{ batchSize?: number }} [options]
   * @returns {Promise<object[]>}
   */
  loadAllComplete: async function (workspaceId, { batchSize = 500 } = {}) {
    const all = [];
    let offset = 0;
    const pageSize = Math.max(1, Number(batchSize) || 500);

    while (true) {
      const batch = await this.forWorkspace(workspaceId, {
        status: "complete",
        limit: pageSize,
        offset,
      });
      if (!batch.length) break;
      all.push(...batch);
      if (batch.length < pageSize) break;
      offset += batch.length;
    }

    return all;
  },

  statusCounts: async function (workspaceId) {
    try {
      const rows = await prisma.document_intelligence.groupBy({
        by: ["status"],
        where: { workspaceId: Number(workspaceId) },
        _count: { status: true },
      });

      const counts = {
        total: 0,
        pending: 0,
        processing: 0,
        complete: 0,
        failed: 0,
      };

      for (const row of rows) {
        const count = row._count.status;
        counts.total += count;
        if (counts[row.status] !== undefined) counts[row.status] = count;
      }

      return counts;
    } catch (error) {
      console.error(error.message);
      return {
        total: 0,
        pending: 0,
        processing: 0,
        complete: 0,
        failed: 0,
      };
    }
  },

  /**
   * Reset rows left in processing after a worker crash.
   * @param {number} [staleAfterMs=600000] - 10 minutes
   */
  recoverStaleProcessing: async function (staleAfterMs = 600_000) {
    try {
      const cutoff = new Date(Date.now() - staleAfterMs);
      const result = await prisma.document_intelligence.updateMany({
        where: {
          status: "processing",
          lastUpdatedAt: { lt: cutoff },
        },
        data: {
          status: "pending",
          error: null,
          lastUpdatedAt: new Date(),
        },
      });
      return result.count;
    } catch (error) {
      console.error(error.message);
      return 0;
    }
  },

  claimPendingBatch: async function (limit = 3) {
    try {
      await this.recoverStaleProcessing();

      const pending = await prisma.document_intelligence.findMany({
        where: { status: "pending" },
        orderBy: { createdAt: "asc" },
        take: Number(limit) || 3,
      });

      const claimed = [];
      for (const record of pending) {
        const updated = await prisma.document_intelligence.updateMany({
          where: { id: record.id, status: "pending" },
          data: { status: "processing", lastUpdatedAt: new Date() },
        });
        if (updated.count === 1) claimed.push(record);
      }

      return claimed;
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  markComplete: async function (
    id,
    {
      category,
      documentType,
      summary,
      keyTopics,
      keywords,
      confidenceScore,
    }
  ) {
    try {
      return await prisma.document_intelligence.update({
        where: { id: Number(id) },
        data: {
          status: "complete",
          category: category || null,
          documentType: documentType || null,
          summary: summary || null,
          keyTopics: JSON.stringify(keyTopics || []),
          keywords: JSON.stringify(keywords || []),
          confidenceScore:
            typeof confidenceScore === "number" ? confidenceScore : null,
          error: null,
          enrichedAt: new Date(),
          lastUpdatedAt: new Date(),
        },
      });
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  markFailed: async function (id, errorMessage = "Unknown error") {
    try {
      return await prisma.document_intelligence.update({
        where: { id: Number(id) },
        data: {
          status: "failed",
          error: String(errorMessage).slice(0, 2000),
          lastUpdatedAt: new Date(),
        },
      });
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  deleteByDocId: async function (docId) {
    try {
      await prisma.document_intelligence.deleteMany({
        where: { docId: String(docId) },
      });
      return true;
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },

  /**
   * @param {number|null} workspaceId
   * @returns {Promise<number>}
   */
  requeueFailed: async function (workspaceId = null) {
    try {
      const result = await prisma.document_intelligence.updateMany({
        where: {
          status: "failed",
          ...(workspaceId ? { workspaceId: Number(workspaceId) } : {}),
        },
        data: {
          status: "pending",
          error: null,
          lastUpdatedAt: new Date(),
        },
      });
      return result.count;
    } catch (error) {
      console.error(error.message);
      return 0;
    }
  },

  /**
   * Fetch completed intelligence rows keyed by filename for project-wide chat context.
   *
   * @param {number} workspaceId
   * @param {string[]} filenames
   * @returns {Promise<Record<string, object>>}
   */
  getCompleteByFilenames: async function (workspaceId, filenames = []) {
    const names = [...new Set(filenames.map((name) => String(name)).filter(Boolean))];
    if (!workspaceId || names.length === 0) return {};

    try {
      const records = await prisma.document_intelligence.findMany({
        where: {
          workspaceId: Number(workspaceId),
          status: "complete",
          filename: { in: names },
        },
      });

      const index = {};
      for (const record of records) {
        index[record.filename] = formatRecord(record);
      }
      return index;
    } catch (error) {
      console.error(error.message);
      return {};
    }
  },

  /**
   * Workspace intelligence rollup for overview dashboards.
   * @param {number} workspaceId
   */
  getWorkspaceOverview: async function (workspaceId) {
    try {
      const records = await prisma.document_intelligence.findMany({
        where: { workspaceId: Number(workspaceId), status: "complete" },
        select: {
          category: true,
          keyTopics: true,
          keywords: true,
          fileType: true,
        },
      });

      const categories = {};
      const topicCounts = {};
      const fileTypes = {};

      for (const record of records) {
        const category = record.category || "general";
        categories[category] = (categories[category] || 0) + 1;

        const fileType = record.fileType || "unknown";
        fileTypes[fileType] = (fileTypes[fileType] || 0) + 1;

        const topics = safeJsonParse(record.keyTopics, []);
        for (const topic of topics) {
          const key = String(topic).trim().toLowerCase();
          if (!key) continue;
          topicCounts[key] = (topicCounts[key] || 0) + 1;
        }

        const keywords = safeJsonParse(record.keywords, []);
        for (const word of keywords) {
          const key = String(word).trim().toLowerCase();
          if (!key) continue;
          topicCounts[key] = (topicCounts[key] || 0) + 1;
        }
      }

      const topTopics = Object.entries(topicCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([topic, count]) => ({ topic, count }));

      const categoryBreakdown = Object.entries(categories)
        .sort((a, b) => b[1] - a[1])
        .map(([category, count]) => ({ category, count }));

      return {
        documents: records.length,
        categories: categoryBreakdown,
        fileTypes,
        topTopics,
      };
    } catch (error) {
      console.error(error.message);
      return {
        documents: 0,
        categories: [],
        fileTypes: {},
        topTopics: [],
      };
    }
  },

  /**
   * Simple workspace intelligence search across filename, summary, topics, keywords.
   * @param {number} workspaceId
   * @param {string} query
   * @param {{ limit?: number }} [options]
   */
  searchWorkspace: async function (workspaceId, query = "", { limit = 50 } = {}) {
    const q = String(query).trim().toLowerCase();
    if (!workspaceId || !q) return [];

    try {
      const records = await prisma.document_intelligence.findMany({
        where: { workspaceId: Number(workspaceId), status: "complete" },
        orderBy: { enrichedAt: "desc" },
        take: 500,
      });

      const matches = [];
      for (const record of records) {
        const formatted = formatRecord(record);
        const haystack = [
          formatted.filename,
          formatted.summary,
          formatted.category,
          formatted.documentType,
          ...(formatted.keyTopics || []),
          ...(formatted.keywords || []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(q)) continue;
        matches.push(formatted);
        if (matches.length >= limit) break;
      }

      return matches;
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },
};

module.exports = { DocumentIntelligence };
