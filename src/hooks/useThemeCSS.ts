import { useEffect } from 'react';
import type { Theme } from '../types';

const themeConfigs: Record<Theme, { bg: string; text: string; muted: string }> = {
  paper: { bg: '#FAF8F5', text: '#343C38', muted: '#777E76' },
  white: { bg: '#FFFFFF', text: '#343C38', muted: '#777E76' },
  night: { bg: '#171D1B', text: '#E3E7E0', muted: '#9BA69C' },
};

export function useThemeCSS(theme: Theme) {
  const themeConfig = themeConfigs[theme] ?? themeConfigs.paper;

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--theme-bg', themeConfig.bg);
    root.style.setProperty('--theme-text', themeConfig.text);
    root.style.setProperty('--theme-muted', themeConfig.muted);
    root.style.setProperty('--theme-accent', '#718474');
    root.style.setProperty('--theme-border', theme === 'night' ? 'rgba(227, 231, 224, 0.12)' : 'rgba(52, 60, 56, 0.12)');
    root.style.setProperty('--theme-selection', theme === 'night' ? 'rgba(113, 132, 116, 0.24)' : 'rgba(113, 132, 116, 0.12)');
    root.style.colorScheme = theme === 'night' ? 'dark' : 'light';

    if (theme === 'night') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme, themeConfig]);

  return themeConfig;
}
