const { reqBody, userFromSession } = require("../utils/http");
const { DocumentComparisons } = require("../models/documentComparisons");
const { compareDocuments } = require("../utils/documentDiff/documentDiff");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { validWorkspaceSlug } = require("../utils/middleware/validWorkspace");

function diffEndpoints(app) {
  if (!app) return;

  app.post(
    "/diff/compare",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const { documentA, documentB, contentA, contentB, titleA, titleB, workspaceId } =
          reqBody(request);

        if ((!documentA || !documentB) && (!contentA || !contentB)) {
          return response.status(400).json({
            error:
              "Provide documentA and documentB (workspace doc refs), or contentA and contentB (raw text).",
          });
        }

        const result = await compareDocuments({
          workspaceId: workspaceId ? Number(workspaceId) : null,
          documentA,
          documentB,
          contentA,
          contentB,
          titleA,
          titleB,
        });

        if (!result.success) {
          return response.status(400).json({ error: result.error });
        }

        return response.status(200).json({
          summary: result.report.summary,
          added: result.report.added,
          removed: result.report.removed,
          modified: result.report.modified,
          riskChanges: result.report.riskChanges,
          financialChanges: result.report.financialChanges,
          complianceChanges: result.report.complianceChanges,
          report: result.report,
        });
      } catch (error) {
        console.error(error);
        return response.sendStatus(500);
      }
    }
  );

  app.post(
    "/workspace/:slug/diff/compare",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const workspace = response.locals.workspace;
        const { documentA, documentB, contentA, contentB, titleA, titleB, useLLM } =
          reqBody(request);

        if ((!documentA || !documentB) && (!contentA || !contentB)) {
          return response.status(400).json({
            error:
              "Provide documentA and documentB (docId or filename), or contentA and contentB.",
          });
        }

        const result = await compareDocuments({
          workspaceId: workspace.id,
          documentA,
          documentB,
          contentA,
          contentB,
          titleA,
          titleB,
          useLLM: useLLM !== false,
        });

        if (!result.success) {
          return response.status(400).json({ error: result.error });
        }

        const user = await userFromSession(request, response);

        const saved = await DocumentComparisons.create({
          workspaceId: workspace.id,
          documentA: result.documentA,
          documentB: result.documentB,
          report: result.report,
          createdBy: user?.id || null,
        });

        return response.status(200).json({
          id: saved?.id || null,
          reviewId: saved?.id || null,
          documentA: result.documentA,
          documentB: result.documentB,
          titleA: result.titleA,
          titleB: result.titleB,
          summary: result.report.summary,
          added: result.report.added,
          removed: result.report.removed,
          modified: result.report.modified,
          riskChanges: result.report.riskChanges,
          financialChanges: result.report.financialChanges,
          complianceChanges: result.report.complianceChanges,
          report: result.report,
        });
      } catch (error) {
        console.error(error);
        return response.sendStatus(500);
      }
    }
  );

  app.get(
    "/workspace/:slug/diff/compare/:id",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const workspace = response.locals.workspace;
        const record = await DocumentComparisons.get(request.params.id);

        if (!record || record.workspaceId !== workspace.id) {
          return response.status(404).json({ error: "Comparison not found." });
        }

        return response.status(200).json({ comparison: record });
      } catch (error) {
        console.error(error);
        return response.sendStatus(500);
      }
    }
  );

  app.get(
    "/workspace/:slug/diff/history",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const workspace = response.locals.workspace;
        const limit = Math.min(Number(request.query.limit) || 50, 200);
        const offset = Number(request.query.offset) || 0;
        const comparisons = await DocumentComparisons.forWorkspace(
          workspace.id,
          { limit, offset }
        );
        return response.status(200).json({ comparisons });
      } catch (error) {
        console.error(error);
        return response.sendStatus(500);
      }
    }
  );
}

module.exports = { diffEndpoints };
