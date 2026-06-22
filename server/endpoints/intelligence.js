const { DocumentIntelligence } = require("../models/documentIntelligence");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { validWorkspaceSlug } = require("../utils/middleware/validWorkspace");

function intelligenceEndpoints(app) {
  if (!app) return;

  app.get(
    "/workspace/:slug/intelligence/status",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (_request, response) => {
      try {
        const workspace = response.locals.workspace;
        const counts = await DocumentIntelligence.statusCounts(workspace.id);
        return response.status(200).json({ status: counts });
      } catch (error) {
        console.error(error);
        return response.sendStatus(500);
      }
    }
  );

  app.get(
    "/workspace/:slug/intelligence/:docId",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const workspace = response.locals.workspace;
        const { docId } = request.params;
        const record = await DocumentIntelligence.getByDocId(docId);

        if (!record || record.workspaceId !== workspace.id) {
          return response.status(404).json({ error: "Intelligence record not found." });
        }

        return response.status(200).json({ intelligence: record });
      } catch (error) {
        console.error(error);
        return response.sendStatus(500);
      }
    }
  );

  app.get(
    "/workspace/:slug/intelligence",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const workspace = response.locals.workspace;
        const limit = Math.min(Number(request.query.limit) || 100, 500);
        const offset = Number(request.query.offset) || 0;
        const status = request.query.status
          ? String(request.query.status)
          : null;

        const intelligence = await DocumentIntelligence.forWorkspace(
          workspace.id,
          { status, limit, offset }
        );

        return response.status(200).json({ intelligence });
      } catch (error) {
        console.error(error);
        return response.sendStatus(500);
      }
    }
  );
}

module.exports = { intelligenceEndpoints };
