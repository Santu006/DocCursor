const prisma = require("../utils/prisma");
const { safeJsonParse } = require("../utils/http");
const { randomBytes } = require("crypto");

/**
 * @param {string} ref
 * @returns {string}
 */
function displayDocName(ref = "") {
  const value = String(ref).trim();
  if (!value) return "Document";
  const basename = value.split("/").pop() || value;
  return basename.replace(/\.(pdf|docx?|md|txt|json)$/i, (_, ext) =>
    ext ? `.${ext.toLowerCase()}` : ""
  );
}

/**
 * @param {object} record
 * @returns {object|null}
 */
function formatRecord(record) {
  if (!record) return null;
  const comparison = safeJsonParse(record.comparisonSummary, null);
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    documentA: record.documentA,
    documentB: record.documentB,
    documentALabel: displayDocName(record.documentA),
    documentBLabel: displayDocName(record.documentB),
    title: `${displayDocName(record.documentA)} → ${displayDocName(record.documentB)}`,
    riskScore: record.riskScore ?? comparison?.riskScore ?? null,
    riskLevel: record.riskLevel ?? comparison?.overallChangeLevel ?? null,
    summary:
      record.summary ||
      comparison?.executiveSummary ||
      comparison?.summary ||
      "",
    template: record.template || "legal_review",
    shareToken: record.shareToken || null,
    createdBy: record.createdBy ?? null,
    createdAt: record.createdAt,
    comparison,
    report: comparison,
  };
}

/**
 * @param {object} report
 * @returns {string}
 */
function deriveRiskLevel(report = {}) {
  if (report.overallChangeLevel) return report.overallChangeLevel;
  const score = report.riskScore;
  if (score == null) return "LOW";
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

const DocumentComparisons = {
  displayDocName,

  /**
   * @param {object} params
   */
  create: async function ({
    workspaceId,
    documentA,
    documentB,
    report,
    createdBy = null,
    template = "legal_review",
  }) {
    if (!workspaceId || !documentA || !documentB) return null;

    try {
      const riskScore =
        typeof report?.riskScore === "number" ? report.riskScore : null;
      const summary =
        report?.executiveSummary || report?.summary || null;
      const riskLevel = deriveRiskLevel(report);

      const record = await prisma.document_comparisons.create({
        data: {
          workspaceId: Number(workspaceId),
          documentA: String(documentA),
          documentB: String(documentB),
          comparisonSummary: JSON.stringify(report || {}),
          riskScore,
          summary,
          createdBy: createdBy ? Number(createdBy) : null,
          template: template || "legal_review",
          riskLevel,
        },
      });
      return formatRecord(record);
    } catch (error) {
      console.error("[DocumentComparisons] create failed:", error.message);
      return null;
    }
  },

  get: async function (id) {
    try {
      const record = await prisma.document_comparisons.findUnique({
        where: { id: Number(id) },
      });
      return formatRecord(record);
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  getByShareToken: async function (shareToken) {
    if (!shareToken) return null;
    try {
      const record = await prisma.document_comparisons.findUnique({
        where: { shareToken: String(shareToken) },
      });
      return formatRecord(record);
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  forWorkspace: async function (
    workspaceId,
    {
      limit = 50,
      offset = 0,
      query = "",
      riskLevel = null,
      template = null,
    } = {}
  ) {
    try {
      const where = { workspaceId: Number(workspaceId) };

      if (riskLevel) {
        where.riskLevel = String(riskLevel).toUpperCase();
      }
      if (template) {
        where.template = String(template);
      }

      const records = await prisma.document_comparisons.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: Math.min(Number(limit) || 50, 200),
        skip: Number(offset) || 0,
      });

      let formatted = records.map(formatRecord);

      if (query && String(query).trim()) {
        const q = String(query).trim().toLowerCase();
        formatted = formatted.filter((item) => {
          const haystack = [
            item.documentA,
            item.documentB,
            item.documentALabel,
            item.documentBLabel,
            item.summary,
            item.title,
            JSON.stringify(item.comparison || {}),
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(q);
        });
      }

      return formatted;
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  dashboard: async function (workspaceId) {
    try {
      const records = await prisma.document_comparisons.findMany({
        where: { workspaceId: Number(workspaceId) },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          riskScore: true,
          riskLevel: true,
          createdAt: true,
          documentA: true,
          documentB: true,
          summary: true,
        },
      });

      const scores = records
        .map((r) => r.riskScore)
        .filter((s) => typeof s === "number");
      const averageRiskScore =
        scores.length > 0
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : 0;

      const highRiskReviews = records.filter(
        (r) => r.riskLevel === "HIGH" || (r.riskScore != null && r.riskScore >= 70)
      ).length;

      return {
        totalReviews: records.length,
        averageRiskScore,
        highRiskReviews,
        recentReviews: records.slice(0, 10).map((r) => ({
          id: r.id,
          title: `${displayDocName(r.documentA)} → ${displayDocName(r.documentB)}`,
          riskScore: r.riskScore,
          riskLevel: r.riskLevel,
          summary: r.summary,
          createdAt: r.createdAt,
        })),
      };
    } catch (error) {
      console.error(error.message);
      return {
        totalReviews: 0,
        averageRiskScore: 0,
        highRiskReviews: 0,
        recentReviews: [],
      };
    }
  },

  ensureShareToken: async function (id, workspaceId) {
    const existing = await this.get(id);
    if (!existing || existing.workspaceId !== Number(workspaceId)) return null;
    if (existing.shareToken) return existing;

    const shareToken = randomBytes(12).toString("hex");
    try {
      await prisma.document_comparisons.update({
        where: { id: Number(id) },
        data: { shareToken },
      });
      return { ...existing, shareToken };
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },
};

module.exports = { DocumentComparisons };
