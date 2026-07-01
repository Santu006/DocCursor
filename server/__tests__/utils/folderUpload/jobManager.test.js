/* eslint-env jest, node */

const {
  createJob,
  getJob,
  updateJob,
  completeJob,
  failJob,
} = require("../../../utils/folderUpload/jobManager");

describe("folderUpload jobManager", () => {
  it("creates and updates upload jobs", () => {
    const job = createJob({
      workspaceId: 1,
      workspaceSlug: "demo",
      folderName: "legal-docs",
      summary: { total: 10, breakdown: [] },
    });

    expect(job.id).toBeTruthy();
    expect(job.status).toBe("queued");

    updateJob(job.id, {
      status: "parsing",
      phase: "parsing",
      processedCount: 3,
      totalCount: 10,
      currentFile: "contract.pdf",
    });

    const updated = getJob(job.id);
    expect(updated.status).toBe("parsing");
    expect(updated.progress.indexed).toBe(3);
    expect(updated.currentFile).toBe("contract.pdf");
  });

  it("marks jobs complete and failed", () => {
    const job = createJob({
      workspaceId: 2,
      workspaceSlug: "other",
      folderName: "batch",
      summary: { total: 1 },
    });

    completeJob(job.id);
    expect(getJob(job.id).status).toBe("complete");

    const failed = createJob({
      workspaceId: 3,
      workspaceSlug: "fail-case",
      folderName: "batch",
      summary: { total: 1 },
    });
    failJob(failed.id, "Encrypted PDF");
    expect(getJob(failed.id).status).toBe("failed");
    expect(getJob(failed.id).error).toBe("Encrypted PDF");
  });
});
