const { EventEmitter } = require("events");
const { v4: uuidv4 } = require("uuid");

/** @type {Map<string, object>} */
const jobsById = new Map();

/** @type {Map<string, string>} */
const activeJobByWorkspace = new Map();

const jobEvents = new EventEmitter();
jobEvents.setMaxListeners(50);

/**
 * @param {object} params
 * @returns {object}
 */
function createJob({
  workspaceId,
  workspaceSlug,
  folderName,
  summary = {},
  userId = null,
}) {
  const existing = activeJobByWorkspace.get(workspaceSlug);
  if (existing) {
    const job = jobsById.get(existing);
    if (job && ["queued", "scanning", "parsing", "embedding", "intelligence"].includes(job.status)) {
      throw new Error("A folder upload is already in progress for this workspace.");
    }
  }

  const id = uuidv4();
  const job = {
    id,
    workspaceId,
    workspaceSlug,
    folderName,
    userId,
    status: "queued",
    phase: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    summary,
    files: [],
    stagedFiles: [],
    parsed: [],
    failed: [],
    embedded: [],
    embedFailed: [],
    currentFile: null,
    processedCount: 0,
    totalCount: summary.total || 0,
    startedAt: null,
    completedAt: null,
    error: null,
    intelligenceReady: false,
  };

  jobsById.set(id, job);
  activeJobByWorkspace.set(workspaceSlug, id);
  emitJobUpdate(job);
  return serializeJob(job);
}

/**
 * @param {string} jobId
 * @returns {object|null}
 */
function getRawJob(jobId) {
  return jobsById.get(jobId) || null;
}

/**
 * @param {string} jobId
 * @param {object} patch
 * @returns {object|null}
 */
function updateJob(jobId, patch = {}) {
  const job = jobsById.get(jobId);
  if (!job) return null;

  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  emitJobUpdate(job);
  return serializeJob(job);
}

/**
 * @param {object} job
 */
function emitJobUpdate(job) {
  const payload = serializeJob(job);
  jobEvents.emit(`job:${job.id}`, payload);
  jobEvents.emit(`workspace:${job.workspaceSlug}`, payload);
}

/**
 * @param {object} job
 * @returns {object}
 */
function serializeJob(job) {
  const elapsedMs =
    job.startedAt && !job.completedAt
      ? Date.now() - new Date(job.startedAt).getTime()
      : job.startedAt && job.completedAt
        ? new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()
        : 0;

  const rate =
    job.processedCount > 0 && elapsedMs > 0
      ? job.processedCount / (elapsedMs / 1000)
      : 0;
  const remaining = Math.max(0, job.totalCount - job.processedCount);
  const estimatedSecondsRemaining =
    rate > 0 ? Math.round(remaining / rate) : null;

  return {
    id: job.id,
    workspaceId: job.workspaceId,
    workspaceSlug: job.workspaceSlug,
    folderName: job.folderName,
    status: job.status,
    phase: job.phase,
    summary: job.summary,
    totalCount: job.totalCount,
    processedCount: job.processedCount,
    parsedCount: job.parsed.length,
    failedCount: job.failed.length,
    embeddedCount: job.embedded.length,
    embedFailedCount: job.embedFailed.length,
    currentFile: job.currentFile,
    failed: [...job.failed, ...job.embedFailed],
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    intelligenceReady: job.intelligenceReady,
    progress: {
      indexed: job.processedCount,
      total: job.totalCount,
      percent:
        job.totalCount > 0
          ? Math.round((job.processedCount / job.totalCount) * 100)
          : 0,
      estimatedSecondsRemaining,
    },
  };
}

/**
 * @param {string} jobId
 * @returns {object|null}
 */
function getJob(jobId) {
  const job = jobsById.get(jobId);
  return job ? serializeJob(job) : null;
}

/**
 * @param {string} workspaceSlug
 * @returns {object|null}
 */
function getActiveJobForWorkspace(workspaceSlug) {
  const jobId = activeJobByWorkspace.get(workspaceSlug);
  return jobId ? getJob(jobId) : null;
}

/**
 * @param {string} jobId
 */
function completeJob(jobId) {
  updateJob(jobId, {
    status: "complete",
    phase: "complete",
    completedAt: new Date().toISOString(),
    currentFile: null,
    processedCount: jobsById.get(jobId)?.totalCount || 0,
  });
  const job = jobsById.get(jobId);
  if (job && activeJobByWorkspace.get(job.workspaceSlug) === jobId) {
    activeJobByWorkspace.delete(job.workspaceSlug);
  }
}

/**
 * @param {string} jobId
 * @param {string} error
 */
function failJob(jobId, error) {
  updateJob(jobId, {
    status: "failed",
    phase: "failed",
    error,
    completedAt: new Date().toISOString(),
    currentFile: null,
  });
  const job = jobsById.get(jobId);
  if (job && activeJobByWorkspace.get(job.workspaceSlug) === jobId) {
    activeJobByWorkspace.delete(job.workspaceSlug);
  }
}

/**
 * Wait for embedding to complete for a workspace.
 *
 * @param {string} workspaceSlug
 * @param {string} jobId
 * @param {number} [timeoutMs=3600000]
 * @returns {Promise<object>}
 */
function waitForEmbedComplete(workspaceSlug, jobId, timeoutMs = 3_600_000) {
  const { getEmbedEventHistory } = require("../EmbeddingWorkerManager");

  return new Promise((resolve, reject) => {
    let interval;

    const timer = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("Embedding timed out"));
    }, timeoutMs);

    function syncFromHistory() {
      const history = getEmbedEventHistory(workspaceSlug);
      const job = jobsById.get(jobId);
      if (!job) return null;

      for (const event of history) {
        if (event.type === "doc_starting") {
          job.currentFile = pathBasename(event.filename);
        }
        if (event.type === "doc_complete" && event.filename) {
          if (!job.embedded.includes(event.filename)) {
            job.embedded.push(event.filename);
          }
        }
        if (event.type === "doc_failed" && event.filename) {
          const exists = job.embedFailed.some((f) => f.document === pathBasename(event.filename));
          if (!exists) {
            job.embedFailed.push({
              document: pathBasename(event.filename),
              relativePath: event.filename,
              reason: event.error || "Embedding failed",
            });
          }
        }
      }

      job.processedCount = job.embedded.length + job.embedFailed.length;
      job.totalCount = Math.max(job.totalCount, job.processedCount);
      emitJobUpdate(job);

      const complete = [...history].reverse().find((e) => e.type === "all_complete");
      return complete || null;
    }

    const complete = syncFromHistory();
    if (complete) {
      clearTimeout(timer);
      resolve(complete);
      return;
    }

    interval = setInterval(() => {
      const done = syncFromHistory();
      if (done) {
        clearTimeout(timer);
        clearInterval(interval);
        resolve(done);
      }
    }, 1000);
  });
}

function pathBasename(value = "") {
  return String(value).split("/").pop();
}

module.exports = {
  completeJob,
  createJob,
  emitJobUpdate,
  failJob,
  getActiveJobForWorkspace,
  getJob,
  getRawJob,
  jobEvents,
  serializeJob,
  updateJob,
  waitForEmbedComplete,
};
