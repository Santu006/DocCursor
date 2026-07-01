const fs = require("fs");
const path = require("path");
const {
  EXTENSION_LABELS,
  SKIPPED_NAMES,
  SUPPORTED_EXTENSIONS,
} = require("./constants");

/**
 * @param {string} filePath
 * @returns {string}
 */
function getExtension(filePath = "") {
  return path.extname(String(filePath)).toLowerCase();
}

/**
 * @param {string} name
 * @returns {boolean}
 */
function shouldSkipEntry(name = "") {
  const base = path.basename(name).toLowerCase();
  if (!base || base.startsWith(".")) return true;
  return SKIPPED_NAMES.has(base);
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isSupportedFile(filePath = "") {
  if (shouldSkipEntry(filePath)) return false;
  return SUPPORTED_EXTENSIONS.has(getExtension(filePath));
}

/**
 * Recursively scan a directory for supported files.
 *
 * @param {string} rootDir
 * @param {string} [relativeTo]
 * @returns {{ files: { absolutePath: string, relativePath: string, extension: string }[], summary: object }}
 */
function scanDirectoryRecursive(rootDir, relativeTo = rootDir) {
  const files = [];
  const typeCounts = {};

  function walk(currentDir, prefix = "") {
    if (!fs.existsSync(currentDir)) return;

    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryName = entry.name;
      if (shouldSkipEntry(entryName)) continue;

      const absolutePath = path.join(currentDir, entryName);
      const relativePath = prefix ? `${prefix}/${entryName}` : entryName;

      if (entry.isDirectory()) {
        walk(absolutePath, relativePath);
        continue;
      }

      if (!entry.isFile() || !isSupportedFile(relativePath)) continue;

      const extension = getExtension(relativePath);
      typeCounts[extension] = (typeCounts[extension] || 0) + 1;
      files.push({
        absolutePath,
        relativePath,
        extension,
      });
    }
  }

  walk(rootDir);

  const breakdown = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([ext, count]) => ({
      extension: ext,
      label: EXTENSION_LABELS[ext] || ext.toUpperCase().replace(".", ""),
      count,
    }));

  return {
    files,
    summary: {
      total: files.length,
      breakdown,
      root: path.relative(relativeTo, rootDir) || path.basename(rootDir),
    },
  };
}

/**
 * Summarize a list of relative file paths (from browser folder picker).
 *
 * @param {string[]} relativePaths
 * @returns {{ total: number, breakdown: object[], supported: string[], skipped: string[] }}
 */
function summarizeRelativePaths(relativePaths = []) {
  const typeCounts = {};
  const supported = [];
  const skipped = [];

  for (const relativePath of relativePaths) {
    if (isSupportedFile(relativePath)) {
      supported.push(relativePath);
      const extension = getExtension(relativePath);
      typeCounts[extension] = (typeCounts[extension] || 0) + 1;
    } else {
      skipped.push(relativePath);
    }
  }

  const breakdown = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([ext, count]) => ({
      extension: ext,
      label: EXTENSION_LABELS[ext] || ext.toUpperCase().replace(".", ""),
      count,
    }));

  return {
    total: supported.length,
    breakdown,
    supported,
    skipped,
  };
}

module.exports = {
  getExtension,
  isSupportedFile,
  scanDirectoryRecursive,
  shouldSkipEntry,
  summarizeRelativePaths,
};
