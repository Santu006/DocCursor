const { buildWorkspaceReport } = require("../utils/workspaceReport");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { validWorkspaceSlug } = require("../utils/middleware/validWorkspace");

function workspaceReportEndpoints(app) {
  if (!app) return;

  app.get(
    "/workspace/:slug/executive-report",
    [validatedRequest, flexUserRoleValid([ROLES.all]), validWorkspaceSlug],
    async (_request, response) => {
      try {
        const workspace = response.locals.workspace;
        const report = await buildWorkspaceReport({ workspace });

        return response.status(200).json({ report });
      } catch (error) {
        console.error(error);
        return response.sendStatus(500);
      }
    }
  );
}

module.exports = { workspaceReportEndpoints };
