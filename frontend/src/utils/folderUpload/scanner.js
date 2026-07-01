import FolderUpload from "@/models/folderUpload";

const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  ".csv",
  ".xlsx",
  ".pptx",
]);

const EXTENSION_LABELS = {
  ".pdf": "PDF",
  ".docx": "DOCX",
  ".txt": "TXT",
  ".md": "MD",
  ".csv": "CSV",
  ".xlsx": "XLSX",
  ".pptx": "PPTX",
};

const SKIPPED_NAMES = new Set([
  ".ds_store",
  "thumbs.db",
  "desktop.ini",
  ".gitkeep",
]);

/**
 * @param {string} filePath
 * @returns {string}
 */
function getExtension(filePath = "") {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : "";
}

/**
 * @param {string} name
 * @returns {boolean}
 */
function shouldSkipName(name = "") {
  const base = name.split("/").pop()?.toLowerCase() || "";
  if (!base || base.startsWith(".")) return true;
  return SKIPPED_NAMES.has(base);
}

/**
 * @param {string} relativePath
 * @returns {boolean}
 */
export function isSupportedFile(relativePath = "") {
  if (shouldSkipName(relativePath)) return false;
  return SUPPORTED_EXTENSIONS.has(getExtension(relativePath));
}

/**
 * Scan a FileList / File[] from a folder picker (webkitRelativePath).
 *
 * @param {File[]|FileList} fileList
 * @returns {{ supported: File[], skipped: File[], summary: object }}
 */
export function scanFolderFiles(fileList = []) {
  const files = Array.from(fileList);
  const supported = [];
  const skipped = [];
  const typeCounts = {};

  for (const file of files) {
    const relativePath = file.webkitRelativePath || file.name;
    if (isSupportedFile(relativePath)) {
      supported.push(file);
      const ext = getExtension(relativePath);
      typeCounts[ext] = (typeCounts[ext] || 0) + 1;
    } else {
      skipped.push(file);
    }
  }

  const breakdown = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([extension, count]) => ({
      extension,
      label: EXTENSION_LABELS[extension] || extension.toUpperCase().replace(".", ""),
      count,
    }));

  const rootFolder =
    supported[0]?.webkitRelativePath?.split("/")?.[0] ||
    files[0]?.webkitRelativePath?.split("/")?.[0] ||
    "uploaded-folder";

  return {
    supported,
    skipped,
    summary: {
      total: supported.length,
      skipped: skipped.length,
      breakdown,
      rootFolder,
    },
  };
}

/**
 * Upload files in batches to the folder upload API.
 *
 * @param {object} params
 * @param {string} params.slug
 * @param {File[]} params.files
 * @param {string} [params.folderName]
 * @param {number} [params.batchSize=20]
 * @param {(progress: object) => void} [params.onProgress]
 * @returns {Promise<object>}
 */
export async function uploadFolderInBatches({
  slug,
  files,
  folderName,
  batchSize = 20,
  onProgress,
}) {
  let jobId = null;

  for (let index = 0; index < files.length; index += batchSize) {
    const batch = files.slice(index, index + batchSize);
    const relativePaths = batch.map(
      (file) => file.webkitRelativePath || file.name
    );
    const finalize = index + batchSize >= files.length;

    const result = await FolderUpload.uploadBatch({
      slug,
      files: batch,
      relativePaths,
      folderName,
      jobId,
      finalize,
    });

    if (!result.success) {
      throw new Error(result.error || "Folder upload failed");
    }

    jobId = result.jobId || jobId;
    onProgress?.({
      uploaded: Math.min(index + batch.length, files.length),
      total: files.length,
      jobId,
      finalize,
    });
  }

  return { jobId };
}
