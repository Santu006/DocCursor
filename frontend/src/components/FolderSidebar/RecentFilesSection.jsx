import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import paths from "@/utils/paths";
import { middleTruncate } from "@/utils/directories";
import FileTypeIcon from "./FileTypeIcon";
import { addRecentProjectFile } from "@/utils/recentProjectFiles";

export default function RecentFilesSection({
  recentFiles,
  onRecentFilesChange,
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { slug } = useParams();

  if (!recentFiles?.length) return null;

  function handleRecentFileClick(file) {
    const updated = addRecentProjectFile(file);
    onRecentFilesChange(updated);

    if (slug !== file.workspaceSlug) {
      navigate(paths.workspace.chat(file.workspaceSlug));
    }
  }

  return (
    <div className="flex flex-col gap-y-1 mt-2 pt-2 border-t border-white/10">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-theme-text-secondary px-1">
        {t("recent_files.title")}
      </p>
      <div className="flex flex-col gap-y-0.5">
        {recentFiles.map((file) => (
          <button
            key={file.docpath}
            type="button"
            onClick={() => handleRecentFileClick(file)}
            className="flex items-center gap-x-1.5 py-1 px-2 rounded hover:bg-theme-sidebar-subitem-hover w-full text-left border-none bg-transparent cursor-pointer"
            title={file.title}
          >
            <FileTypeIcon filename={file.title} size={12} />
            <div className="flex flex-col min-w-0 flex-grow">
              <span className="text-[11px] text-theme-text-primary/90 truncate">
                {middleTruncate(file.title, 24)}
              </span>
              <span className="text-[10px] text-theme-text-secondary/70 truncate">
                {middleTruncate(file.workspaceName, 20)}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
