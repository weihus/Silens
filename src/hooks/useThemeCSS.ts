import { useEffect } from 'react';
import type { Theme } from '../types';

const themeConfigs: Record<Theme, { bg: string; text: string; muted: string }> = {
  paper: { bg: '#F4EAD5', text: '#2f3441', muted: '#8A8275' },
  white: { bg: '#FFFFFF', text: '#2f3441', muted: '#9CA3AF' },
  night: { bg: '#0D1424', text: '#E2E8F0', muted: '#64748B' },
};

export function useThemeCSS(theme: Theme) {
  const themeConfig = themeConfigs[theme] ?? themeConfigs.paper;

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--theme-bg', themeConfig.bg);
    root.style.setProperty('--theme-text', themeConfig.text);
    root.style.setProperty('--theme-muted', themeConfig.muted);

    if (theme === 'night') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme, themeConfig]);

  return themeConfig;
}
