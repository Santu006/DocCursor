const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { CollectorApi } = require("../collectorApi");
const { normalizePath, isWithin, sanitizeFileName } = require("../files");
const { DEFAULT_UPLOAD_CONCURRENCY } = require("./constants");
const { mapWithConcurrency } = require("./uploadQueue");
const {
  completeJob,
  failJob,
  getRawJob,
  updateJob,
  waitForEmbedComplete,
} = require("./jobManager");

const documentsPath =
  process.env.NODE_ENV === "development"
    ? path.resolve(__dirname, "../../storage/documents")
    : path.resolve(process.env.STORAGE_DIR, "documents");

const hotdirPath =
  process.env.NODE_ENV === "development"
    ? path.resolve(__dirname, "../../../collector/hotdir")
    : path.resolve(process.env.STORAGE_DIR, "../../collector/hotdir");

/**
 * @param {string} folderName
 * @returns {string}
 */
function sanitizeFolderName(folderName = "") {
  const cleaned = String(folderName)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || `folder-upload-${Date.now()}`;
}

/**
 * @param {object} doc
 * @param {string} targetFolder
 * @returns {string}
 */
function moveDocumentToFolder(doc, targetFolder) {
  const currentFolder = path.dirname(doc.location);
  if (currentFolder === targetFolder) return doc.location;

  const sourcePath = path.join(documentsPath, normalizePath(doc.location));
  const destinationPath = path.join(
    documentsPath,
    targetFolder,
    path.basename(doc.location)
  );

  if (
    !isWithin(documentsPath, sourcePath) ||
    !isWithin(documentsPath, destinationPath)
  ) {
    throw new Error("Invalid document path");
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.renameSync(sourcePath, destinationPath);
  return path.join(targetFolder, path.basename(doc.location));
}

/**
 * @param {object} params
 * @returns {Promise<{ success: boolean, location?: string, relativePath: string, error?: string }>}
 */
async function parseUploadedFile({
  uploadedPath,
  relativePath,
  targetFolder,
  collector,
}) {
  const hotdirName = path.basename(uploadedPath);

  try {
    const { success, reason, documents } = await collector.processDocument(
      hotdirName,
      { title: path.basename(relativePath) }
    );

    if (!success || !documents?.length) {
      if (fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath);
      return {
        success: false,
        relativePath,
        error: reason || "Document processing failed",
      };
    }

    const locations = [];
    for (const doc of documents) {
      locations.push(moveDocumentToFolder(doc, targetFolder));
    }

    return {
      success: true,
      relativePath,
      location: locations[0],
      locations,
    };
  } catch (error) {
    if (fs.existsSync(uploadedPath)) {
      try {
        fs.unlinkSync(uploadedPath);
      } catch {
        /* ignore */
      }
    }
    return {
      success: false,
      relativePath,
      error: error.message,
    };
  }
}

/**
 * Stage multer files into hotdir with unique names.
 *
 * @param {object[]} files
 * @returns {object[]}
 */
function stageUploadedFiles(files = []) {
  return files.map((file) => {
    const relativePath = file.relativePath || file.originalname;
    const uniqueName = `${uuidv4().slice(0, 8)}-${sanitizeFileName(path.basename(relativePath))}`;
    const destPath = path.join(hotdirPath, uniqueName);
    fs.renameSync(file.path, destPath);
    return {
      uploadedPath: destPath,
      relativePath,
      originalName: path.basename(relativePath),
    };
  });
}

/**
 * Run parse → embed → intelligence for a folder upload job.
 *
 * @param {string} jobId
 * @param {object[]} stagedFiles
 */
async function processFolderUploadJob(jobId, stagedFiles = []) {
  const rawJob = getRawJob(jobId);
  if (!rawJob) return;

  const collector = new CollectorApi();
  const online = await collector.online();
  if (!online) {
    failJob(jobId, "Document processor is offline");
    return;
  }

  const targetFolder = sanitizeFolderName(rawJob.folderName);
  const targetFolderPath = path.join(documentsPath, targetFolder);
  if (!isWithin(path.resolve(documentsPath), path.resolve(targetFolderPath))) {
    failJob(jobId, "Invalid target folder");
    return;
  }
  fs.mkdirSync(targetFolderPath, { recursive: true });

  updateJob(jobId, {
    status: "parsing",
    phase: "parsing",
    startedAt: rawJob.startedAt || new Date().toISOString(),
    totalCount: stagedFiles.length,
    processedCount: 0,
    folderName: targetFolder,
  });

  const concurrency =
    Number(process.env.FOLDER_UPLOAD_CONCURRENCY) || DEFAULT_UPLOAD_CONCURRENCY;

  const results = await mapWithConcurrency(
    stagedFiles,
    async (file) => {
      updateJob(jobId, { currentFile: path.basename(file.relativePath) });
      const result = await parseUploadedFile({
        uploadedPath: file.uploadedPath,
        relativePath: file.relativePath,
        targetFolder,
        collector,
      });

      const job = getRawJob(jobId);
      if (!job) return result;

      if (result.success) {
        job.parsed.push({
          relativePath: result.relativePath,
          location: result.location,
        });
      } else {
        job.failed.push({
          relativePath: result.relativePath,
          document: path.basename(result.relativePath),
          reason: result.error || "Unknown error",
        });
      }

      updateJob(jobId, {
        parsed: job.parsed,
        failed: job.failed,
        processedCount: job.parsed.length + job.failed.length,
      });

      return result;
    },
    { concurrency }
  );

  const parsedLocations = results
    .filter((result) => result.success && result.location)
    .map((result) => result.location);

  if (!parsedLocations.length) {
    failJob(jobId, "No documents were successfully parsed");
    return;
  }

  updateJob(jobId, {
    status: "embedding",
    phase: "embedding",
    currentFile: null,
    totalCount: parsedLocations.length,
    processedCount: 0,
  });

  const { embedFiles, isNativeEmbedder } = require("../EmbeddingWorkerManager");
  const { Document } = require("../../models/documents");
  const { Workspace } = require("../../models/workspace");

  const workspace = await Workspace.get({ id: rawJob.workspaceId });
  if (!workspace) {
    failJob(jobId, "Workspace not found");
    return;
  }

  try {
    if (isNativeEmbedder()) {
      await embedFiles(
        workspace.slug,
        parsedLocations,
        workspace.id,
        rawJob.userId
      );
      const embedResult = await waitForEmbedComplete(
        workspace.slug,
        jobId
      );
      const job = getRawJob(jobId);
      if (job && embedResult?.embeddedFiles) {
        job.embedded = embedResult.embeddedFiles;
        updateJob(jobId, { embedded: job.embedded });
      }
    } else {
      const { failedToEmbed = [], errors = [] } = await Document.addDocuments(
        workspace,
        parsedLocations,
        rawJob.userId
      );
      const job = getRawJob(jobId);
      if (job) {
        job.embedded = parsedLocations.filter((loc) => !failedToEmbed.includes(loc));
        job.embedFailed = failedToEmbed.map((loc, index) => ({
          document: path.basename(loc),
          reason: errors[index] || "Embedding failed",
        }));
        updateJob(jobId, {
          embedded: job.embedded,
          embedFailed: job.embedFailed,
          processedCount: parsedLocations.length,
        });
      }
    }
  } catch (error) {
    failJob(jobId, error.message);
    return;
  }

  updateJob(jobId, { status: "intelligence", phase: "intelligence" });

  try {
    const { invalidateGraphCache, buildWorkspaceGraph } = require("../workspaceGraph/graphBuilder");
    const {
      invalidateReportCache,
      buildWorkspaceReport,
    } = require("../workspaceReport/buildWorkspaceReport");

    invalidateGraphCache(workspace.id);
    invalidateReportCache(workspace.id);

    await buildWorkspaceGraph({
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      skipCache: true,
    });
    await buildWorkspaceReport({ workspace, skipCache: true });

    updateJob(jobId, { intelligenceReady: true });
  } catch (error) {
    console.error("[folderUpload] intelligence generation failed:", error.message);
  }

  completeJob(jobId);
}

module.exports = {
  processFolderUploadJob,
  sanitizeFolderName,
  stageUploadedFiles,
};
