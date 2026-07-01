const { reqBody } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { validWorkspaceSlug } = require("../utils/middleware/validWorkspace");
const { handleFolderBatchUpload } = require("../utils/files/multer");
const { summarizeRelativePaths } = require("../utils/folderUpload/folderScanner");
const {
  createJob,
  getActiveJobForWorkspace,
  getJob,
  getRawJob,
  updateJob,
} = require("../utils/folderUpload/jobManager");
const {
  processFolderUploadJob,
  stageUploadedFiles,
} = require("../utils/folderUpload/processFolderUpload");
const { getWorkspaceIndexStatus } = require("../utils/folderUpload/indexStatus");

/**
 * @param {import("express").Express} app
 */
function folderUploadEndpoints(app) {
  if (!app) return;

  app.post(
    "/workspace/:slug/upload-folder/init",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      validWorkspaceSlug,
    ],
    async (request, response) => {
      try {
        const workspace = response.locals.workspace;
        const { folderName = "folder-upload", relativePaths = [] } =
          reqBody(request);
        const paths = Array.isArray(relativePaths) ? relativePaths : [];
        const summary = summarizeRelativePaths(paths);

        const job = createJob({
          workspaceId: workspace.id,
          workspaceSlug: workspace.slug,
          folderName,
          summary,
          userId: response.locals?.user?.id ?? null,
        });

        response.status(200).json({
          success: true,
          job,
          summary,
        });
      } catch (error) {
        response.status(400).json({ success: false, error: error.message });
      }
    }
  );

  app.post(
    "/workspace/:slug/upload-folder",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager]),
      validWorkspaceSlug,
      handleFolderBatchUpload,
    ],
    async (request, response) => {
      try {
        const workspace = response.locals.workspace;
        const body = request.body || {};
        const finalize =
          body.finalize === true ||
          body.finalize === "true" ||
          body.finalize === "1";
        let jobId = body.jobId || null;
        const folderName = body.folderName || "folder-upload";

        let job = jobId ? getRawJob(jobId) : null;
        if (!job) {
          const relativePaths = (request.files || []).map(
            (file) => file.relativePath || file.originalname
          );
          const summary = summarizeRelativePaths(relativePaths);
          const created = createJob({
            workspaceId: workspace.id,
            workspaceSlug: workspace.slug,
            folderName,
            summary,
            userId: response.locals?.user?.id ?? null,
          });
          jobId = created.id;
          job = getRawJob(jobId);
          if (summary.total !== relativePaths.length) {
            updateJob(jobId, { summary });
          }
        }

        const staged = stageUploadedFiles(request.files || []);
        job.stagedFiles.push(...staged);
        updateJob(jobId, {
          stagedFiles: job.stagedFiles,
          totalCount: job.stagedFiles.length,
        });

        if (!finalize) {
          response.status(202).json({
            success: true,
            jobId,
            staged: staged.length,
            totalStaged: job.stagedFiles.length,
            finalizeRequired: true,
          });
          return;
        }

        response.status(202).json({
          success: true,
          jobId,
          job: getJob(jobId),
          message: "Folder upload started",
        });

        setImmediate(() => {
          processFolderUploadJob(jobId, [...job.stagedFiles]).catch((error) => {
            const { failJob } = require("../utils/folderUpload/jobManager");
            failJob(jobId, error.message);
          });
        });
      } catch (error) {
        console.error("[folderUpload]", error.message);
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );

  app.get(
    "/workspace/:slug/upload-status",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager, ROLES.all]),
      validWorkspaceSlug,
    ],
    async (request, response) => {
      try {
        const workspace = response.locals.workspace;
        const jobId = request.query?.jobId;
        const job = jobId
          ? getJob(String(jobId))
          : getActiveJobForWorkspace(workspace.slug);

        response.status(200).json({
          success: true,
          job,
        });
      } catch (error) {
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );

  app.get(
    "/workspace/:slug/index-status",
    [
      validatedRequest,
      flexUserRoleValid([ROLES.admin, ROLES.manager, ROLES.all]),
      validWorkspaceSlug,
    ],
    async (request, response) => {
      try {
        const workspace = response.locals.workspace;
        const status = await getWorkspaceIndexStatus(workspace);
        response.status(200).json({ success: true, status });
      } catch (error) {
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );
}

module.exports = { folderUploadEndpoints };
