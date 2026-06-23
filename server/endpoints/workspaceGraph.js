const {
  buildWorkspaceGraph,
  getWorkspaceClusters,
  getRelatedDocuments,
} = require("../utils/workspaceGraph");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { validWorkspaceSlug } = require("../utils/middleware/validWorkspace");

function workspaceGraphEndpoints(app) {
  if (!app) return;

  app.get(
    "/workspace/:slug/topic-graph",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (_request, response) => {
      try {
        const workspace = response.locals.workspace;
        const graph = await buildWorkspaceGraph({
          workspaceId: workspace.id,
          workspaceSlug: workspace.slug,
        });

        return response.status(200).json({ graph });
      } catch (error) {
        console.error(error);
        return response.sendStatus(500);
      }
    }
  );

  app.get(
    "/workspace/:slug/clusters",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (_request, response) => {
      try {
        const workspace = response.locals.workspace;
        const clusters = await getWorkspaceClusters({
          workspaceId: workspace.id,
          workspaceSlug: workspace.slug,
        });

        return response.status(200).json({ clusters });
      } catch (error) {
        console.error(error);
        return response.sendStatus(500);
      }
    }
  );

  app.get(
    "/workspace/:slug/related-documents/:documentId",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (request, response) => {
      try {
        const workspace = response.locals.workspace;
        const { documentId } = request.params;

        const result = await getRelatedDocuments({
          workspaceId: workspace.id,
          workspaceSlug: workspace.slug,
          documentId,
        });

        if (!result.found) {
          return response.status(404).json({
            error: "Document not found in workspace knowledge graph.",
          });
        }

        return response.status(200).json(result);
      } catch (error) {
        console.error(error);
        return response.sendStatus(500);
      }
    }
  );
}

module.exports = { workspaceGraphEndpoints };
