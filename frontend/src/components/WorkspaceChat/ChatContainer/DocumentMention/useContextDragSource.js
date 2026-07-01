import { useCallback } from "react";
import { setContextDragData } from "@/utils/documentContextDrag";

/**
 * Hook for making sidebar items draggable into chat as document context.
 *
 * @param {object} params
 * @param {string} params.workspaceSlug
 * @param {object|object[]} params.items - one or more mention items
 * @param {boolean} [params.disabled]
 */
export default function useContextDragSource({
  workspaceSlug,
  items,
  disabled = false,
}) {
  const onDragStart = useCallback(
    (event) => {
      if (disabled) {
        event.preventDefault();
        return;
      }

      const list = Array.isArray(items) ? items : [items];
      setContextDragData(event.dataTransfer, {
        workspaceSlug,
        items: list,
      });

      if (event.target?.style) {
        event.target.style.opacity = "0.5";
      }
    },
    [workspaceSlug, items, disabled]
  );

  const onDragEnd = useCallback((event) => {
    if (event.target?.style) {
      event.target.style.opacity = "";
    }
  }, []);

  return {
    draggable: !disabled,
    onDragStart,
    onDragEnd,
  };
}
