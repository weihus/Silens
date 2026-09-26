import type { Theme, AtmosphereState } from '../types';
import { VolumeX, Moon, CloudRain, Flame, Monitor, Download } from 'lucide-react';

interface AtmospherePanelProps {
  open: boolean;
  ref: React.RefObject<HTMLDivElement | null>;
  panelBtnRef: React.RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
  onExport: () => void;
  atmosphere: AtmosphereState;
  onChange: (patch: Partial<AtmosphereState>) => void;
  themeConfig: { bg: string; text: string; muted: string };
  activeTheme: Theme;
  focusDuration: number;
  onFocusDurationChange: (d: number) => void;
}

export function AtmospherePanel({
  open,
  ref,
  themeConfig,
  activeTheme,
  atmosphere,
  onChange,
  focusDuration,
  onFocusDurationChange,
  onExport,
}: AtmospherePanelProps) {
  if (!open) return null;

  const handleAutoSync = () => onChange({ autoSync: !atmosphere.autoSync });
  const handleTheme = (t: Theme) => onChange({ theme: t, autoSync: false });
  const handleSound = (s: string) => onChange({ sound: s as AtmosphereState['sound'] });

  return (
    <div
      ref={ref}
      className="fixed bottom-16 right-6 z-[100] p-6 rounded-2xl backdrop-blur-xl shadow-2xl w-72 flex flex-col gap-6 transition-all"
      style={{
        backgroundColor: activeTheme === 'night' ? 'rgba(18, 25, 43, 0.85)' : 'rgba(255, 255, 255, 0.85)',
      }}
    >
      {/* Theme */}
      <div className="flex gap-2">
        {(['paper', 'white', 'night'] as Theme[]).map((t) => {
          const isSelected = !atmosphere.autoSync && atmosphere.theme === t;
          return (
            <button
              key={t}
              onClick={() => handleTheme(t)}
              className="flex-1 py-1.5 rounded-lg text-xs tracking-wider capitalize transition-all"
              style={{
                backgroundColor: isSelected
                  ? (activeTheme === 'night' ? 'rgba(255,255,255,0.1)' : 'rgba(47,52,65,0.1)')
                  : 'transparent',
                color: themeConfig.text,
                opacity: isSelected ? 0.9 : 0.4,
              }}
            >
              {t}
            </button>
          );
        })}
        <button
          onClick={handleAutoSync}
          className="w-8 flex items-center justify-center rounded-lg transition-all"
          title="跟随系统切换日夜主题"
          style={{
            backgroundColor: atmosphere.autoSync
              ? (activeTheme === 'night' ? 'rgba(255,255,255,0.1)' : 'rgba(47,52,65,0.1)')
              : 'transparent',
            color: themeConfig.text,
            opacity: atmosphere.autoSync ? 0.9 : 0.4,
          }}
        >
          <Monitor size={14} strokeWidth={atmosphere.autoSync ? 2 : 1.5} />
        </button>
      </div>

      {/* Sound */}
      <div className="flex gap-2">
        {[
          { id: 'none', icon: VolumeX, label: '静音' },
          { id: 'night', icon: Moon, label: '深夜' },
          { id: 'rain', icon: CloudRain, label: '细雨' },
          { id: 'fire', icon: Flame, label: '篝火' },
        ].map(({ id, icon: Icon, label }) => {
          const isSelected = atmosphere.sound === id;
          return (
            <button
              key={id}
              onClick={() => handleSound(id)}
              className="flex-1 py-2 rounded-lg transition-all flex items-center justify-center"
              title={label}
              style={{
                backgroundColor: isSelected
                  ? (activeTheme === 'night' ? 'rgba(255,255,255,0.1)' : 'rgba(47,52,65,0.1)')
                  : 'transparent',
                color: themeConfig.text,
                opacity: isSelected ? 0.9 : 0.4,
              }}
            >
              <Icon size={16} strokeWidth={isSelected ? 2 : 1.5} />
            </button>
          );
        })}
      </div>

      {/* Volume slider */}
      {atmosphere.sound !== 'none' && (
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={atmosphere.volume}
          onChange={(e) => onChange({ volume: parseFloat(e.target.value) })}
          className="w-full h-1 rounded-full appearance-none cursor-pointer outline-none slider-thumb-styled"
          style={{
            backgroundColor: activeTheme === 'night' ? 'rgba(255,255,255,0.15)' : 'rgba(47,52,65,0.15)',
          }}
        />
      )}
      <style>{`
        .slider-thumb-styled::-webkit-slider-thumb {
          appearance: none;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: ${themeConfig.text};
          opacity: 0.5;
          transition: transform 0.2s, opacity 0.2s;
        }
        .slider-thumb-styled::-webkit-slider-thumb:hover {
          transform: scale(1.2);
          opacity: 0.8;
        }
      `}</style>

      {/* Focus duration */}
      <div className="flex gap-2">
        {[15, 25, 45, 60].map((d) => {
          const isSelected = focusDuration === d;
          return (
            <button
              key={d}
              onClick={() => onFocusDurationChange(d)}
              className="flex-1 py-1.5 rounded-lg text-xs tracking-wider transition-all"
              style={{
                backgroundColor: isSelected
                  ? (activeTheme === 'night' ? 'rgba(255,255,255,0.1)' : 'rgba(47,52,65,0.1)')
                  : 'transparent',
                color: themeConfig.text,
                opacity: isSelected ? 0.9 : 0.4,
              }}
            >
              {d}m
            </button>
          );
        })}
      </div>

      {/* Export — 底部幽灵按钮，无边框，悬停才浮现背景 */}
      <button
        onClick={onExport}
        className="flex items-center gap-2 py-1.5 px-2 rounded-lg text-xs tracking-wider uppercase transition-all self-start"
        style={{ color: themeConfig.text }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = activeTheme === 'night' ? 'rgba(255,255,255,0.08)' : 'rgba(47,52,65,0.08)';
          e.currentTarget.style.opacity = '1';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
          e.currentTarget.style.opacity = '0.5';
        }}
      >
        <Download size={13} />
        导出
      </button>
    </div>
  );
}
