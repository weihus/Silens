import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ReflectionAIDrawer } from './ReflectionAIDrawer';
import type { ReflectionEpilogue } from '../utils/reflectionAI';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import type { NoteTarget, RecallRange, ReflectionPerspective, Theme } from '../types';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { usePeriodReflection } from '../hooks/usePeriodReflection';
import { reflectionHasContent, reflectionQuickRange } from '../utils/reflectionPresentation';
import { captureImage, type ImageFormat } from '../utils/imageExport';
import { ReflectionLetter } from './ReflectionLetter';
import './reflection.css';

export interface PeriodReflectionScrollProps {
  open: boolean;
  preparing?: boolean;
  preparationError?: string | null;
  range: RecallRange | null;
  perspective: ReflectionPerspective;
  revision: number;
  sidebarInteractive?: boolean;
  suppressed?: boolean;
  theme: Theme;
  themeConfig: { bg: string; text: string; muted: string };
  onRangeChange: (range: RecallRange | null) => void;
  onPerspectiveChange: (p: ReflectionPerspective) => void;
  onClose: (reason?: 'dismiss' | 'navigate' | 'write') => void;
  onNavigate: (filename: string, target?: NoteTarget) => Promise<boolean>;
  onRetryPreparation?: () => void;
  onExportBusyChange?: (busy: boolean) => void;
  aiSettingsRevision?: number;
  onOpenAISettings?: () => void;
  paused?: boolean;
}

function ScrollBackdrop({ children, sidebarInteractive, reducedMotion }: {
  children: ReactNode; sidebarInteractive: boolean; reducedMotion: boolean;
}) {
  const present = useIsPresent();
  return <motion.div className="period-reflection-backdrop" data-sidebar={sidebarInteractive ? 'true' : 'false'}
    inert={!present} aria-hidden={!present || undefined}
    initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    transition={{ duration: reducedMotion ? 0 : 0.18 }}>{children}</motion.div>;
}

function validDate(value: string) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  return year > 0 && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function PeriodReflectionScroll({ open, preparing = false, preparationError, range, perspective, revision,
  sidebarInteractive = false, suppressed = false, theme, themeConfig, onRangeChange, onPerspectiveChange,
  onClose, onNavigate, onRetryPreparation, onExportBusyChange, aiSettingsRevision = 0, onOpenAISettings, paused = false }: PeriodReflectionScrollProps) {
  const visible = open && !suppressed;
  const enabled = visible && !preparing && !preparationError;
  const reflection = usePeriodReflection({ enabled: !!enabled, range, perspective, revision });
  const reducedMotion = useReducedMotion();
  const [customOpen, setCustomOpen] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [format, setFormat] = useState<ImageFormat>('png');
  const [exporting, setExporting] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [aiOpen, setAIOpen] = useState(false);
  const [aiResult, setAIResult] = useState<{ context: string; value: ReflectionEpilogue } | null>(null);
  const aiButton = useRef<HTMLButtonElement>(null);
  const wasPaused = useRef(false);
  const aiContext = JSON.stringify([range?.start ?? null, range?.end ?? null, perspective, revision, reflection.pageSeed, aiSettingsRevision, reflection.result]);
  const epilogue = visible && aiResult?.context === aiContext ? aiResult.value : null;
  const receiveAIResult = useCallback((value: ReflectionEpilogue | null) => {
    setAIResult(value ? { context: aiContext, value } : null);
  }, [aiContext]);
  useLayoutEffect(() => { setAIResult(null); setAIOpen(false); }, [aiContext, visible]);
  useLayoutEffect(() => {
    if (wasPaused.current && !paused && visible) requestAnimationFrame(() => {
      if (aiButton.current?.isConnected && !aiButton.current.closest('[inert]')) aiButton.current.focus({ preventScroll: true });
    });
    wasPaused.current = paused;
  }, [paused, visible]);
  const exportBusy = useRef(false);
  const navigationBusy = useRef(false);
  const busyCallback = useRef(onExportBusyChange);
  const lifecycle = useRef(0);
  const closeButton = useRef<HTMLButtonElement>(null);
  const letterRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { busyCallback.current = onExportBusyChange; });
  useLayoutEffect(() => {
    ++lifecycle.current;
    setCustomOpen(false); setError(null); setStatus('');
    navigationBusy.current = false; setNavigating(false);
    return () => { ++lifecycle.current; };
  }, [visible]);
  const requestClose = (reason: 'dismiss' | 'write' = 'dismiss') => {
    if (exportBusy.current || navigationBusy.current || paused || aiOpen) return;
    onClose(reason);
  };
  const handleEscape = () => {
    if (exportBusy.current || navigationBusy.current || paused) return;
    if (aiOpen) { setAIOpen(false); return; }
    if (customOpen) { setCustomOpen(false); return; }
    requestClose();
  };
  const dialogRef = useDialogFocus(visible && !sidebarInteractive && !aiOpen && !paused, handleEscape, closeButton, { restoreFocus: false });
  useLayoutEffect(() => {
    if (visible && sidebarInteractive && !paused && !aiOpen) closeButton.current?.focus({ preventScroll: true });
  }, [visible, sidebarInteractive]);
  const busy = exporting || navigating;
  const disabled = busy || paused || reflection.loading || !!reflection.error || !enabled;
  const changePerspective = (next: ReflectionPerspective) => {
    if (!exportBusy.current && !navigationBusy.current && enabled && !aiOpen && !paused) onPerspectiveChange(next);
  };
  const navigate = async (filename: string, target?: NoteTarget) => {
    if (disabled || aiOpen || exportBusy.current || navigationBusy.current) return;
    navigationBusy.current = true; setNavigating(true); setError(null);
    const current = lifecycle.current;
    try {
      const success = await onNavigate(filename, target);
      if (current !== lifecycle.current) return;
      if (success) onClose('navigate');
      else setError('未能打开原文，请重试。');
    } catch (cause) {
      if (current === lifecycle.current) setError(cause instanceof Error ? cause.message : '未能打开原文，请重试。');
    } finally {
      if (current === lifecycle.current) { navigationBusy.current = false; setNavigating(false); }
    }
  };
  const exportLetter = async () => {
    if (disabled || aiOpen || exportBusy.current || navigationBusy.current || !letterRef.current || !reflection.result) return;
    exportBusy.current = true; setExporting(true); setError(null); setStatus('');
    const current = lifecycle.current;
    try {
      busyCallback.current?.(true);
      const query = reflection.result.query;
      const view = query.perspective;
      const label = view.kind === 'tag' ? view.tag : view.kind === 'untagged' ? '未命名' : view.kind === 'articlesOnly' ? '独立篇目' : '全部';
      const filename = `时光拾遗-${query.startDate ?? '起初'}-${query.endDate ?? '至今'}-${label}`.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-');
      const bytes = await captureImage(letterRef.current, {
        format, backgroundColor: themeConfig.bg, color: themeConfig.text, fullHeight: true,
      });
      const path = await save({ defaultPath: `${filename}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
      if (!path) return;
      await writeFile(path, bytes);
      if (current === lifecycle.current) setStatus('长图信笺已保存。');
    } catch (cause) {
      if (current === lifecycle.current) setError(cause instanceof Error ? cause.message : '导出失败，请重试。');
    } finally {
      exportBusy.current = false; setExporting(false);
      busyCallback.current?.(false);
    }
  };

  // Bypass exit animations so focus mode removes the surface synchronously.
  if (suppressed) return null;
  const tags = reflection.topTags.filter(item => item.count > 0).slice(0, 5).map(item => item.tag);
  const emptyAction = reflection.loading || reflection.error ? null
    : reflection.allLoading ? <p role="status" className="reflection-meta">正在查看这段时光…</p>
    : reflection.allError ? <button type="button" className="reflection-text-action" disabled={disabled || aiOpen}
      onClick={() => { if (!disabled && !aiOpen) reflection.retry(); }}>重新查看这段时光 →</button>
    : reflection.allResult ? <button type="button" className="reflection-text-action" disabled={disabled || aiOpen}
      onClick={() => {
        if (disabled || aiOpen) return;
        if (reflectionHasContent(reflection.allResult!)) changePerspective({ kind: 'all' });
        else requestClose('write');
      }}>{reflectionHasContent(reflection.allResult) ? '查看这段时光的全部随想 →' : '回到今日落笔 →'}</button> : null;
  const choices: { label: string; value: ReflectionPerspective }[] = [
    { label: '全部', value: { kind: 'all' } },
    ...tags.map(tag => ({ label: `#${tag}`, value: { kind: 'tag' as const, tag } })),
    { label: '未命名', value: { kind: 'untagged' } },
    { label: '独立篇目', value: { kind: 'articlesOnly' } },
  ];
  return <AnimatePresence>{open && <ScrollBackdrop sidebarInteractive={sidebarInteractive} reducedMotion={!!reducedMotion}>
    <div ref={dialogRef} role="dialog" aria-label="时光拾遗" aria-modal={!sidebarInteractive && !aiOpen && !paused} aria-hidden={paused || undefined} inert={paused} aria-busy={busy || reflection.loading || preparing}
      tabIndex={-1} className="period-reflection-panel" data-theme={theme} style={{ backgroundColor: themeConfig.bg, color: themeConfig.text }}
      onKeyDown={event => {
        if (sidebarInteractive && !aiOpen && !paused && event.key === 'Escape' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
          event.preventDefault(); event.stopPropagation(); handleEscape();
        }
      }}>
      <div inert={aiOpen} aria-hidden={aiOpen || undefined}>
      <button ref={closeButton} type="button" className="period-reflection-close quiet-button" aria-label="收起时光拾遗" title="收起时光拾遗（Esc）" disabled={busy} onClick={() => requestClose()} data-export-exclude>
        <span>收起</span><X size={15} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {preparing ? <p role="status" className="period-reflection-status">正在保存文字，准备展卷…</p>
        : preparationError ? <div className="period-reflection-error"><p role="alert">{preparationError}</p>
          {onRetryPreparation && <button className="quiet-button" onClick={onRetryPreparation}>重试准备</button>}</div>
        : <>
          <div className="period-reflection-controls" data-export-exclude>
            <div className="period-reflection-quick-ranges" role="group" aria-label="回顾日期">
              {(['month', 'quarter', 'year', 'all'] as const).map((preset, index) => {
                const next = reflectionQuickRange(preset);
                const selected = (range?.start ?? '') === (next?.start ?? '') && (range?.end ?? '') === (next?.end ?? '');
                return <button key={preset} className="quiet-button" disabled={busy} aria-pressed={selected} onClick={() => {
                  if (exportBusy.current || navigationBusy.current) return;
                  setCustomOpen(false); onRangeChange(next);
                }}>{['近一月', '这一季', '今年', '全部时光'][index]}</button>;
              })}
              <button className="quiet-button" disabled={busy} aria-expanded={customOpen} onClick={() => {
                setStart(range?.start ?? ''); setEnd(range?.end ?? ''); setDateError(null); setCustomOpen(value => !value);
              }}>自定义</button>
            </div>
            {customOpen && <form onSubmit={event => {
              event.preventDefault();
              if (exportBusy.current || navigationBusy.current) return;
              if (!validDate(start) || !validDate(end) || (start && end && start > end)) {
                setDateError('请输入有效日期，开始日期不能晚于结束日期。'); return;
              }
              onRangeChange(start || end ? { ...(start ? { start } : {}), ...(end ? { end } : {}) } : null);
              setCustomOpen(false); setDateError(null);
            }}>
              <label>开始日期<input aria-label="开始日期" type="date" value={start} disabled={busy} onChange={event => setStart(event.target.value)} /></label>
              <label>结束日期<input aria-label="结束日期" type="date" value={end} disabled={busy} onChange={event => setEnd(event.target.value)} /></label>
              <button className="quiet-button" disabled={busy} type="submit">应用日期</button>
              {dateError && <p role="alert">{dateError}</p>}
            </form>}
            <div className="period-reflection-capsules" role="group" aria-label="回顾视角">{choices.map(choice => <button key={choice.label}
              className="quiet-button" disabled={busy} aria-pressed={choice.value.kind === perspective.kind && (choice.value.kind !== 'tag' || (perspective.kind === 'tag' && choice.value.tag === perspective.tag))}
              onClick={() => changePerspective(choice.value)}>{choice.label}</button>)}</div>
          </div>
          {reflection.loading && <p role="status" className="period-reflection-status">正在拾起这段时光…</p>}
          {reflection.error && <div className="period-reflection-error"><p role="alert">{reflection.error}</p><button className="quiet-button" disabled={busy} onClick={reflection.retry}>重新拾遗</button></div>}
          <div className="period-reflection-content" style={{ opacity: reflection.loading && reflection.result ? 0.55 : 1 }}>{reflection.result && <ReflectionLetter result={reflection.result} emptyAction={emptyAction} disabled={disabled || aiOpen} epilogue={epilogue}
            onNavigate={navigate} onPerspectiveChange={next => { if (!disabled) changePerspective(next); }}
            onShuffle={() => { if (!disabled && !exportBusy.current && !navigationBusy.current) reflection.shuffle(); }} letterRef={letterRef} />}</div>
          <div className="period-reflection-footer" data-export-exclude>
            {reflection.result && reflectionHasContent(reflection.result) && <button ref={aiButton} type="button" className="quiet-button"
              disabled={disabled || aiOpen} aria-label="请 AI 为这段时光撰写按语" onClick={() => {
                if (!disabled && !aiOpen) setAIOpen(true);
              }}>请 AI 为这段时光撰写按语</button>}
            <label>图片格式<select aria-label="图片格式" value={format} disabled={busy} onChange={event => setFormat(event.target.value as ImageFormat)}>
              <option value="png">PNG</option><option value="jpg">JPG</option>
            </select></label>
            <button className="quiet-button" disabled={disabled || !reflection.result} aria-label="导出为长图信笺" onClick={() => void exportLetter()}>{exporting ? '正在导出…' : '导出为长图信笺'}</button>
          </div>
        </>}
      {error && <p role="alert" className="period-reflection-error">{error}</p>}
      {status && <p role="status" aria-live="polite" className="period-reflection-status">{status}</p>}
      </div>
      {reflection.result && <ReflectionAIDrawer open={aiOpen && visible && !paused} reflection={reflection.result}
        contextKey={aiContext} settingsRevision={aiSettingsRevision} disabled={disabled}
        onClose={() => setAIOpen(false)} onOpenSettings={() => {
          setAIOpen(false); onOpenAISettings?.();
        }} onResult={receiveAIResult} sidebarInteractive={sidebarInteractive} />}
    </div>
  </ScrollBackdrop>}</AnimatePresence>;
}
