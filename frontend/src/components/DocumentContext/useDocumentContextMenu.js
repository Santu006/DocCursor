import { useCallback, useState } from "react";

/**
 * Manages right-click document context menu state.
 */
export default function useDocumentContextMenu() {
  const [menu, setMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    document: null,
  });

  const openMenu = useCallback((event, document) => {
    event.preventDefault();
    event.stopPropagation();
    if (!document?.docId) return;
    setMenu({
      visible: true,
      x: event.clientX,
      y: event.clientY,
      document,
    });
  }, []);

  const closeMenu = useCallback(() => {
    setMenu({ visible: false, x: 0, y: 0, document: null });
  }, []);

  return { menu, openMenu, closeMenu };
}
