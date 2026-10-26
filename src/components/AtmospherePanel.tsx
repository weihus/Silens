import { useCallback, useId } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import type { Theme, AtmosphereState } from '../types';
import { VolumeX, Moon, CloudRain, Flame, Monitor, Download, X } from 'lucide-react';

interface AtmospherePanelProps {
  open: boolean;
  ref: React.RefObject<HTMLDivElement | null>;
  panelBtnRef: React.RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
  onExport: () => void;
  onCheckUpdates?: () => void;
  onOpenStorage?: () => void;
  onOpenBackups?: () => void;
  onRestore?: () => void;
  onBackup?: () => void;
  onMoveWorkspace?: () => void;
  storageBusy: boolean;
  atmosphere: AtmosphereState;
  onChange: (patch: Partial<AtmosphereState>) => void;
  themeConfig: { bg: string; text: string; muted: string };
  activeTheme: Theme;
  focusDuration: number;
  onFocusDurationChange: (d: number) => void;
}

export function AtmospherePanel({
  open, ref, onToggle, themeConfig, activeTheme, atmosphere, onChange,
  focusDuration, onFocusDurationChange, onExport, onOpenStorage, onOpenBackups, onRestore,
  onBackup, onMoveWorkspace, storageBusy, onCheckUpdates,
}: AtmospherePanelProps) {
  const titleId = useId();
  const dialogRef = useDialogFocus(open, onToggle);
  const setDialogRef = useCallback((node: HTMLDivElement | null) => {
    dialogRef.current = node;
    ref.current = node;
  }, [dialogRef, ref]);
  if (!open) return null;
  const selectedStyle = (selected: boolean) => ({
    backgroundColor: selected ? 'var(--theme-selection)' : 'transparent',
    color: selected ? themeConfig.text : themeConfig.muted,
  });
  const close = onToggle;

  return (
    <div
      ref={setDialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="atmosphere-panel fixed bottom-16 right-6 z-[100] p-6 rounded-xl border flex flex-col gap-6"
      style={{ backgroundColor: activeTheme === 'night' ? '#171D1B' : activeTheme === 'paper' ? '#FAF8F5' : '#FFFFFF', color: themeConfig.text, borderColor: 'var(--theme-border)' }}
    >
      <div className="flex items-center justify-between">
        <h2 id={titleId} className="text-sm font-medium">书写氛围</h2>
        <button type="button" onClick={close} aria-label="关闭书写氛围" className="quiet-button p-2 rounded-md"><X size={16} /></button>
      </div>
      <div role="group" aria-label="主题" className="flex gap-1">
        {([{ id: 'paper', label: '纸白' }, { id: 'white', label: '纯白' }, { id: 'night', label: '夜色' }] as const).map(({ id, label }) => (
          <button key={id} type="button" onClick={() => onChange({ theme: id, autoSync: false })}
            aria-pressed={!atmosphere.autoSync && atmosphere.theme === id}
            className="quiet-button flex-1 py-2 rounded-md text-xs"
            style={selectedStyle(!atmosphere.autoSync && atmosphere.theme === id)}>{label}</button>
        ))}
        <button type="button" onClick={() => onChange({ autoSync: !atmosphere.autoSync })}
          aria-label="跟随系统主题" aria-pressed={atmosphere.autoSync} title="跟随系统主题"
          className="quiet-button p-2 rounded-md" style={selectedStyle(!!atmosphere.autoSync)}><Monitor size={16} /></button>
      </div>
      <div role="group" aria-label="环境声音" className="flex gap-1">
        {[
          { id: 'none', icon: VolumeX, label: '静音' },
          { id: 'night', icon: Moon, label: '深夜' },
          { id: 'rain', icon: CloudRain, label: '细雨' },
          { id: 'fire', icon: Flame, label: '篝火' },
        ].map(({ id, icon: Icon, label }) => (
          <button key={id} type="button" onClick={() => onChange({ sound: id as AtmosphereState['sound'] })}
            aria-pressed={atmosphere.sound === id} className="quiet-button flex-1 py-2 rounded-md flex flex-col items-center gap-2 text-xs"
            style={selectedStyle(atmosphere.sound === id)}><Icon size={16} aria-hidden="true" />{label}</button>
        ))}
      </div>
      {atmosphere.sound !== 'none' && (
        <label className="flex flex-col gap-3 text-xs" style={{ color: themeConfig.muted }}>
          <span className="flex justify-between"><span>音量</span><span>{Math.round(atmosphere.volume * 100)}%</span></span>
          <input type="range" min="0" max="1" step="0.01" value={atmosphere.volume}
            aria-label="环境声音音量" aria-valuetext={`${Math.round(atmosphere.volume * 100)}%`}
            onChange={(e) => onChange({ volume: parseFloat(e.target.value) })}
            className="w-full cursor-pointer" style={{ accentColor: '#718474' }} />
        </label>
      )}
      <div role="group" aria-label="专注时长">
        <p className="text-xs mb-3" style={{ color: themeConfig.muted }}>专注时长</p>
        <div className="flex gap-1">
          {[15, 25, 45, 60].map((d) => (
            <button key={d} type="button" onClick={() => onFocusDurationChange(d)} aria-pressed={focusDuration === d}
              className="quiet-button flex-1 py-2 rounded-md text-xs" style={selectedStyle(focusDuration === d)}>{d} 分</button>
          ))}
        </div>
      </div>
      <button type="button" onClick={onExport} className="quiet-button flex items-center gap-2 py-2 px-2 rounded-md text-xs self-start"><Download size={14} aria-hidden="true" />导出</button>
      <details className="border-t pt-4 text-xs" style={{ borderColor: 'var(--theme-border)', color: themeConfig.muted }}>
        <summary className="cursor-pointer py-1">本地文件</summary>
        <div className="flex flex-col gap-1 mt-3" aria-busy={storageBusy}>
          {[
            { label: '打开笔记文件夹', action: onOpenStorage },
            { label: '备份副本', action: onBackup },
            { label: '恢复备份', action: onRestore },
            { label: '查看备份', action: onOpenBackups },
            { label: '迁移工作区', action: onMoveWorkspace },
          ].map(({ label, action }) => (
            <button key={label} type="button" onClick={action} disabled={storageBusy || !action}
              className="quiet-button text-left rounded-md px-2 py-2 disabled:opacity-50 disabled:cursor-not-allowed">{label}</button>
          ))}
          {storageBusy && <p role="status" className="px-2 py-1">正在处理…</p>}
          <p className="leading-relaxed mt-2">迁移后，原文件仍会保留。恢复备份会先为当前笔记再存一份副本。</p>
        </div>
      </details>
      <button type="button" onClick={onCheckUpdates} disabled={storageBusy || !onCheckUpdates} className="quiet-button rounded-md px-2 py-2 text-left text-xs disabled:opacity-50">检查软件更新</button>
    </div>
  );
}
