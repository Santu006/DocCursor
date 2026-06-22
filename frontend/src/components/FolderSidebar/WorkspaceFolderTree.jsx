import { middleTruncate } from "@/utils/directories";
import { useTranslation } from "react-i18next";
import FileTypeIcon from "./FileTypeIcon";

export default function WorkspaceFolderTree({
  files,
  loading,
  onFileClick,
}) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <p className="text-[11px] text-theme-text-secondary pl-6 py-1 animate-pulse">
        {t("projects.loading")}
      </p>
    );
  }

  if (!files?.length) {
    return (
      <p className="text-[11px] text-theme-text-secondary/70 pl-6 py-1 italic">
        {t("projects.empty_files")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-y-0.5 py-1 border-l border-white/10 ml-4 mr-1">
      {files.map((file) => {
        const displayName = file.title || file.name;

        return (
          <button
            key={file.id || file.docpath}
            type="button"
            onClick={() => onFileClick?.(file)}
            className="flex items-center gap-x-1.5 py-0.5 pl-2 pr-1 rounded hover:bg-theme-sidebar-subitem-hover w-full text-left border-none bg-transparent cursor-pointer"
            title={displayName}
          >
            <FileTypeIcon filename={displayName} size={12} />
            <span className="text-[11px] text-theme-text-primary/80 truncate">
              {middleTruncate(displayName, 28)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
