const { reqBody, userFromSession } = require("../utils/http");
const { DocumentComparisons } = require("../models/documentComparisons");
const { exportReview, VALID_EXPORT_TYPES } = require("../utils/documentDiff/exportReview");
const { REPORT_TEMPLATES } = require("../utils/documentDiff/reportTemplates");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { validWorkspaceSlug } = require("../utils/middleware/validWorkspace");

function reviewsEndpoints(app) {
  if (!app) return;

  app.get(
    "/workspace/:slug/reviews",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const workspace = response.locals.workspace;
        const limit = Math.min(Number(request.query.limit) || 50, 200);
        const offset = Number(request.query.offset) || 0;
        const query = request.query.q || request.query.query || "";
        const riskLevel = request.query.riskLevel || request.query.risk || null;
        const template = request.query.template || null;
        const dashboard = request.query.dashboard === "true";

        if (dashboard) {
          const stats = await DocumentComparisons.dashboard(workspace.id);
          return response.status(200).json(stats);
        }

        const reviews = await DocumentComparisons.forWorkspace(workspace.id, {
          limit,
          offset,
          query,
          riskLevel,
          template,
        });

        return response.status(200).json({ reviews });
      } catch (error) {
        console.error(error);
        return response.sendStatus(500);
      }
    }
  );

  app.get(
    "/workspace/:slug/reviews/templates",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (_request, response) => {
      return response.status(200).json({
        templates: Object.values(REPORT_TEMPLATES),
      });
    }
  );

  app.get(
    "/workspace/:slug/reviews/:id",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const workspace = response.locals.workspace;
        const review = await DocumentComparisons.get(request.params.id);

        if (!review || review.workspaceId !== workspace.id) {
          return response.status(404).json({ error: "Review not found." });
        }

        return response.status(200).json({ review });
      } catch (error) {
        console.error(error);
        return response.sendStatus(500);
      }
    }
  );

  app.post(
    "/workspace/:slug/reviews/export",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const workspace = response.locals.workspace;
        const { reviewId, type = "pdf", template = null } = reqBody(request);

        if (!reviewId) {
          return response.status(400).json({ error: "reviewId is required." });
        }

        const normalizedType = type === "md" ? "markdown" : type;
        if (!VALID_EXPORT_TYPES.includes(normalizedType)) {
          return response.status(400).json({
            error: `Invalid export type. Supported: ${VALID_EXPORT_TYPES.join(", ")}`,
          });
        }

        const review = await DocumentComparisons.get(reviewId);
        if (!review || review.workspaceId !== workspace.id) {
          return response.status(404).json({ error: "Review not found." });
        }

        const exported = await exportReview(review, normalizedType, template);
        response.setHeader("Content-Type", exported.contentType);
        response.setHeader(
          "Content-Disposition",
          `attachment; filename="${exported.filename}"`
        );
        return response.send(exported.buffer);
      } catch (error) {
        console.error(error);
        return response.status(500).json({ error: error.message });
      }
    }
  );

  app.post(
    "/workspace/:slug/reviews/share",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const workspace = response.locals.workspace;
        const { reviewId } = reqBody(request);

        if (!reviewId) {
          return response.status(400).json({ error: "reviewId is required." });
        }

        const review = await DocumentComparisons.ensureShareToken(
          reviewId,
          workspace.id
        );

        if (!review) {
          return response.status(404).json({ error: "Review not found." });
        }

        return response.status(200).json({
          shareToken: review.shareToken,
          sharePath: `/review/${review.shareToken}`,
        });
      } catch (error) {
        console.error(error);
        return response.sendStatus(500);
      }
    }
  );

  // Public read-only shared review (no auth)
  app.get("/review/:shareToken", async (request, response) => {
    try {
      const review = await DocumentComparisons.getByShareToken(
        request.params.shareToken
      );

      if (!review) {
        return response.status(404).json({ error: "Review not found." });
      }

      return response.status(200).json({
        review: {
          id: review.id,
          title: review.title,
          documentA: review.documentALabel,
          documentB: review.documentBLabel,
          riskScore: review.riskScore,
          riskLevel: review.riskLevel,
          summary: review.summary,
          template: review.template,
          createdAt: review.createdAt,
          report: review.comparison,
        },
      });
    } catch (error) {
      console.error(error);
      return response.sendStatus(500);
    }
  });
}

module.exports = { reviewsEndpoints };
