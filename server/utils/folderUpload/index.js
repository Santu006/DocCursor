const {
  createJob,
  getJob,
  getActiveJobForWorkspace,
  updateJob,
  completeJob,
  failJob,
  jobEvents,
} = require("./jobManager");
const { getWorkspaceIndexStatus } = require("./indexStatus");
const {
  processFolderUploadJob,
  sanitizeFolderName,
  stageUploadedFiles,
} = require("./processFolderUpload");
const {
  isSupportedFile,
  scanDirectoryRecursive,
  summarizeRelativePaths,
} = require("./folderScanner");
const { mapWithConcurrency, runWithConcurrency } = require("./uploadQueue");
const {
  DEFAULT_UPLOAD_CONCURRENCY,
  SUPPORTED_EXTENSIONS,
} = require("./constants");

module.exports = {
  DEFAULT_UPLOAD_CONCURRENCY,
  SUPPORTED_EXTENSIONS,
  completeJob,
  createJob,
  failJob,
  getActiveJobForWorkspace,
  getJob,
  getWorkspaceIndexStatus,
  isSupportedFile,
  jobEvents,
  mapWithConcurrency,
  processFolderUploadJob,
  runWithConcurrency,
  sanitizeFolderName,
  scanDirectoryRecursive,
  stageUploadedFiles,
  summarizeRelativePaths,
  updateJob,
};
