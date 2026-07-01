import { useTranslation } from "react-i18next";
import {
  DocumentContextMenu,
  useDocumentContextMenu,
} from "@/components/DocumentContext";
import DraggableSidebarFile from "./DraggableSidebarFile";

export default function WorkspaceFolderTree({
  files,
  loading,
  workspaceSlug,
  onFileClick,
}) {
  const { t } = useTranslation();
  const { menu, openMenu, closeMenu } = useDocumentContextMenu();

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
    <>
      <div className="flex flex-col gap-y-0.5 py-1 border-l border-white/10 ml-4 mr-1">
        {files.map((file) => {
          const displayName = file.title || file.name;
          const documentMention = file.docId
            ? {
                docId: file.docId,
                filename: file.filename || file.name,
                label: file.label || displayName,
                mentionType: file.mentionType || "document",
              }
            : null;

          return (
            <DraggableSidebarFile
              key={file.id || file.docpath}
              file={file}
              workspaceSlug={workspaceSlug}
              displayName={displayName}
              documentMention={documentMention}
              onFileClick={onFileClick}
              onContextMenu={(event) => {
                if (!documentMention) return;
                openMenu(event, documentMention);
              }}
            />
          );
        })}
      </div>
      <DocumentContextMenu
        visible={menu.visible}
        x={menu.x}
        y={menu.y}
        document={menu.document}
        workspaceSlug={workspaceSlug}
        onClose={closeMenu}
      />
    </>
  );
}
