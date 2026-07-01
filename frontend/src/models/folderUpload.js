import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const FolderUpload = {
  init: async function (slug, { folderName, relativePaths = [] } = {}) {
    return await fetch(`${API_BASE}/workspace/${slug}/upload-folder/init`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ folderName, relativePaths }),
    })
      .then((res) => res.json())
      .catch((error) => ({ success: false, error: error.message }));
  },

  uploadBatch: async function ({
    slug,
    files = [],
    relativePaths = [],
    folderName,
    jobId = null,
    finalize = false,
  }) {
    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file, file.name);
    }
    formData.append("relativePaths", JSON.stringify(relativePaths));
    if (folderName) formData.append("folderName", folderName);
    if (jobId) formData.append("jobId", jobId);
    formData.append("finalize", finalize ? "true" : "false");

    return await fetch(`${API_BASE}/workspace/${slug}/upload-folder`, {
      method: "POST",
      headers: baseHeaders(),
      body: formData,
    })
      .then((res) => res.json())
      .catch((error) => ({ success: false, error: error.message }));
  },

  getUploadStatus: async function (slug, jobId = null) {
    const query = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";
    return await fetch(`${API_BASE}/workspace/${slug}/upload-status${query}`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((error) => ({ success: false, error: error.message }));
  },

  getIndexStatus: async function (slug) {
    return await fetch(`${API_BASE}/workspace/${slug}/index-status`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((error) => ({ success: false, error: error.message }));
  },

  pollUploadStatus: async function (slug, jobId, { intervalMs = 1500, onUpdate } = {}) {
    return await new Promise((resolve, reject) => {
      const poll = async () => {
        const result = await FolderUpload.getUploadStatus(slug, jobId);
        if (!result.success) {
          reject(new Error(result.error || "Status poll failed"));
          return;
        }

        onUpdate?.(result.job);
        const status = result.job?.status;
        if (status === "complete") {
          resolve(result.job);
          return;
        }
        if (status === "failed") {
          reject(new Error(result.job?.error || "Folder upload failed"));
          return;
        }

        setTimeout(poll, intervalMs);
      };

      poll();
    });
  },
};

export default FolderUpload;
