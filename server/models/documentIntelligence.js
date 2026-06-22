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
          summary: null,
          keyTopics: null,
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
    { status = null, limit = 100, offset = 0 } = {}
  ) {
    try {
      const records = await prisma.document_intelligence.findMany({
        where: {
          workspaceId: Number(workspaceId),
          ...(status ? { status: String(status) } : {}),
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

  markComplete: async function (id, { category, summary, keyTopics }) {
    try {
      return await prisma.document_intelligence.update({
        where: { id: Number(id) },
        data: {
          status: "complete",
          category: category || null,
          summary: summary || null,
          keyTopics: JSON.stringify(keyTopics || []),
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
};

module.exports = { DocumentIntelligence };
