import { middleTruncate } from "@/utils/directories";
import FileTypeIcon from "./FileTypeIcon";
import useContextDragSource from "@/components/WorkspaceChat/ChatContainer/DocumentMention/useContextDragSource";

export default function DraggableSidebarFile({
  file,
  workspaceSlug,
  displayName,
  documentMention,
  onFileClick,
  onContextMenu,
}) {
  const drag = useContextDragSource({
    workspaceSlug,
    items: documentMention,
    disabled: !documentMention?.docId,
  });

  return (
    <button
      type="button"
      draggable={drag.draggable}
      onDragStart={drag.onDragStart}
      onDragEnd={drag.onDragEnd}
      onClick={() => onFileClick?.(file)}
      onContextMenu={onContextMenu}
      className="flex items-center gap-x-1.5 py-0.5 pl-2 pr-1 rounded hover:bg-theme-sidebar-subitem-hover w-full text-left border-none bg-transparent cursor-grab active:cursor-grabbing"
      title={`${displayName} — drag to chat`}
    >
      <FileTypeIcon filename={displayName} size={12} />
      <span className="text-[11px] text-theme-text-primary/80 truncate">
        {middleTruncate(displayName, 28)}
      </span>
    </button>
  );
}
