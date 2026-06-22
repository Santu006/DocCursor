import { getFileExtension } from "@/utils/directories";

/**
 * Flat list of workspace documents (no storage-folder grouping).
 *
 * @param {object} localFiles - Response from System.localFiles()
 * @param {string[]} docpaths - workspace.documents[].docpath values
 * @returns {{ id: string, title: string, name: string, docpath: string, extension: string }[]}
 */
export function flattenWorkspaceDocuments(localFiles, docpaths = []) {
  if (!localFiles?.items?.length || !docpaths?.length) return [];

  const docpathSet = new Set(docpaths);
  const files = [];

  for (const folder of localFiles.items) {
    if (folder.type !== "folder" || !folder.items?.length) continue;

    for (const file of folder.items) {
      if (file.type !== "file") continue;

      const docpath = `${folder.name}/${file.name}`;
      if (!docpathSet.has(docpath)) continue;

      const displayName = file.title || file.name;
      files.push({
        id: file.id || docpath,
        title: displayName,
        name: file.name,
        docpath,
        extension: getFileExtension(displayName),
      });
    }
  }

  return files.sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
  );
}

/**
 * @deprecated Use flattenWorkspaceDocuments for sidebar file lists.
 */
export function buildWorkspaceDocumentsTree(localFiles, docpaths = []) {
  if (!localFiles?.items?.length || !docpaths?.length) return [];

  const docpathSet = new Set(docpaths);

  return localFiles.items
    .filter((folder) => folder.type === "folder" && folder.items?.length)
    .map((folder) => {
      const files = folder.items.filter(
        (file) =>
          file.type === "file" &&
          docpathSet.has(`${folder.name}/${file.name}`)
      );
      if (files.length === 0) return null;
      return {
        name: folder.name,
        type: "folder",
        files,
      };
    })
    .filter(Boolean);
}

/**
 * @param {string[]} docpaths
 * @returns {number}
 */
export function countWorkspaceDocuments(docpaths = []) {
  return docpaths.length;
}
