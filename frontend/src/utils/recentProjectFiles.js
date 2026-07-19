import { safeJsonParse } from "@/utils/request";

export const RECENT_PROJECT_FILES_KEY = "doccursor_recent_project_files";
const MAX_RECENT_FILES = 5;

/**
 * @returns {Array<{ title: string, docpath: string, docId?: string, filename?: string, label?: string, mentionType?: string, workspaceSlug: string, workspaceName: string, extension: string, openedAt: number }>}
 */
export function getRecentProjectFiles() {
  const parsed = safeJsonParse(localStorage.getItem(RECENT_PROJECT_FILES_KEY));
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * @param {{ title: string, docpath: string, docId?: string, filename?: string, label?: string, mentionType?: string, workspaceSlug: string, workspaceName: string, extension?: string }} entry
 * @returns {ReturnType<typeof getRecentProjectFiles>}
 */
export function addRecentProjectFile(entry) {
  const {
    title,
    docpath,
    docId,
    filename,
    label,
    mentionType,
    workspaceSlug,
    workspaceName,
    extension = "",
  } = entry;

  const deduped = getRecentProjectFiles().filter(
    (file) => file.docpath !== docpath
  );

  const updated = [
    {
      title,
      docpath,
      docId,
      filename,
      label,
      mentionType,
      workspaceSlug,
      workspaceName,
      extension,
      openedAt: Date.now(),
    },
    ...deduped,
  ].slice(0, MAX_RECENT_FILES);

  localStorage.setItem(RECENT_PROJECT_FILES_KEY, JSON.stringify(updated));
  return updated;
}
