import { useEffect } from 'react';

export function useGlobalShortcuts(
  _paletteOpen: boolean,
  setPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>,
  _sidebarOpen: boolean,
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>,
  sidebarPinned: boolean,
  setSidebarPinned: React.Dispatch<React.SetStateAction<boolean>>,
  _panelOpen: boolean,
  setPanelOpen: React.Dispatch<React.SetStateAction<boolean>>,
  toggleFocusMode: () => void,
) {
  // Cmd/Ctrl + K: toggle palette
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'k' || e.code === 'KeyK')) {
        e.preventDefault();
        setPaletteOpen((open: boolean) => !open);
      }
    };
    window.addEventListener('keydown', down, { capture: true });
    return () => window.removeEventListener('keydown', down, { capture: true });
  }, [setPaletteOpen]);

  // Cmd/Ctrl + L: toggle sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'l' || e.code === 'KeyL')) {
        e.preventDefault();
        setPaletteOpen(false);
        setSidebarOpen((prev: boolean) => {
          if (prev && sidebarPinned) setSidebarPinned(false);
          return !prev;
        });
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [sidebarPinned, setPaletteOpen, setSidebarOpen, setSidebarPinned]);

  // Cmd/Ctrl + Shift + M: toggle atmosphere panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key.toLowerCase() === 'm' || e.code === 'KeyM')) {
        e.preventDefault();
        setPaletteOpen(false);
        setPanelOpen((prev: boolean) => !prev);
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [setPaletteOpen, setPanelOpen]);

  // Cmd/Ctrl + Shift + F: toggle focus mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key.toLowerCase() === 'f' || e.code === 'KeyF')) {
        e.preventDefault();
        setPaletteOpen(false);
        toggleFocusMode();
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [setPaletteOpen, toggleFocusMode]);
}
