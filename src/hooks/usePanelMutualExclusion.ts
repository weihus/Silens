import { useEffect } from 'react';

export function usePanelMutualExclusion(
  paletteOpen: boolean,
  sidebarOpen: boolean,
  setPaletteOpen: (v: boolean) => void,
  setSidebarOpen: (v: boolean) => void,
  sidebarPinned: boolean,
) {
  useEffect(() => {
    if (paletteOpen && !sidebarPinned) {
      setSidebarOpen(false);
    }
  }, [paletteOpen, sidebarPinned, setSidebarOpen]);

  useEffect(() => {
    if (sidebarOpen) {
      setPaletteOpen(false);
    }
  }, [sidebarOpen, setPaletteOpen]);
}
