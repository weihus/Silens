import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { open as openFolderDialog } from '@tauri-apps/plugin-dialog';
import { MotionConfig } from 'framer-motion';
import { Canvas } from './components/Canvas';
import { CommandPalette } from './components/CommandPalette';
import { AtmospherePanel } from './components/AtmospherePanel';
import { UpdateManager } from './components/UpdateManager';
import { ExportDialog } from './components/ExportDialog';
import { PeriodReflectionScroll } from './components/PeriodReflectionScroll';
import { RestoreDialog } from './components/RestoreDialog';
import { Editor } from '@tiptap/react';
import type { AtmosphereState, NoteTarget, ReflectionPerspective, Theme } from './types';
import { computeTagFrequency, loadTagsByDoc, updateDocTags } from './utils/tags';
import { useDocumentSession } from './hooks/useDocumentSession';
import { TimelineSidebar } from './components/TimelineSidebar';
import { useTypingLock } from './hooks/useTypingLock';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useFocusTimer } from './hooks/useFocusTimer';
import { useAtmospherePanel } from './hooks/useAtmospherePanel';
import { useAudio } from './hooks/useAudio';
import { useThemeCSS } from './hooks/useThemeCSS';
import { decodeEmptyLines } from './utils/emptyLines';
import { displayTitle, documentKind, parseDocument } from './utils/documents';
import type { RecallDay, RecallRange } from './types';
import { periodLabel, periodRange, type RecallPeriod } from './utils/recall';
import { SlidersHorizontal, Columns, Search, ArrowLeft } from 'lucide-react';

const themeConfigs: Record<Theme, { bg: string; text: string; muted: string }> = {
  paper: { bg: '#FAF8F5', text: '#343C38', muted: '#777E76' },
  white: { bg: '#FFFFFF', text: '#343C38', muted: '#777E76' },
  night: { bg: '#171D1B', text: '#E3E7E0', muted: '#9BA69C' },
};


function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}


function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function App() {
  // === Atmosphere state (persisted to localStorage) ===
  const [atmosphere, setAtmosphere] = useState<AtmosphereState>(() => {
    const saved = localStorage.getItem('silens-atmosphere-v1');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return {
            sound: parsed.sound || 'none',
            volume: typeof parsed.volume === 'number' ? parsed.volume : 0.5,
            theme: parsed.theme || 'paper',
            autoSync: !!parsed.autoSync,
          };
        }
      } catch { /* ignore */ }
    }
    return { sound: 'none', volume: 0.5, theme: 'paper', autoSync: false };
  });

  // Persist atmosphere to localStorage
  useEffect(() => {
    localStorage.setItem('silens-atmosphere-v1', JSON.stringify(atmosphere));
  }, [atmosphere]);

  const handleAtmosphereChange = useCallback((patch: Partial<AtmosphereState>) => {
    setAtmosphere(prev => ({ ...prev, ...patch }));
  }, []);

  // === Derived theme values ===
  const [systemTheme, setSystemTheme] = useState<Theme>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'paper';
    }
    return 'paper';
  });
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemTheme(media.matches ? 'night' : 'paper');
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const activeTheme = (atmosphere as any).autoSync ? systemTheme : atmosphere.theme;
  const themeConfig = activeTheme ? (themeConfigs[activeTheme as Theme] ?? themeConfigs.paper) : themeConfigs.paper;

  // === Hook extractions ===
  const { isTyping, isIdle, handleTyping } = useTypingLock();
  const { panelOpen, setPanelOpen: setPanelOpenState, panelRef, panelBtnRef } = useAtmospherePanel();
  const { isFocusMode, focusTimeLeft, focusDuration, setFocusDuration, toggleFocusMode, toast, setToast } = useFocusTimer(atmosphere.sound !== 'none', atmosphere.volume);
  const [paletteOpen, setPaletteOpenState] = useState(false);
  const [sidebarOpen, setSidebarOpenState] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const closing = useRef(false);
  const [tagsRev, setTagsRev] = useState(0);
  const [forcedTag, setForcedTag] = useState<string | null>(null);
  const [targetSearchText, setTargetSearchText] = useState<NoteTarget | null>(null);
  const [exportOpen, setExportOpenState] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [reflectionPhase, setReflectionPhase] = useState<'closed' | 'preparing' | 'open'>('closed');
  const [reflectionPerspective, setReflectionPerspective] = useState<ReflectionPerspective>({ kind: 'all' });
  const [reflectionPreparationError, setReflectionPreparationError] = useState<string | null>(null);
  const [reflectionExportBusy, setReflectionExportBusy] = useState(false);
  const [aiSettingsRequested, setAISettingsRequested] = useState(0);
  const [aiSettingsRevision, setAISettingsRevision] = useState(0);
  const [aiSettingsFromReflection, setAISettingsFromReflection] = useState(false);
  const aiSettingsRoute = useRef(false);
  const reflectionRequest = useRef(0);
  const reflectionState = useRef({ active: false, pinned: false, focused: false, navigating: false, exporting: false });
  reflectionState.current.active = reflectionPhase !== 'closed';
  reflectionState.current.pinned = sidebarPinned;
  reflectionState.current.focused = isFocusMode;
  const lastWritingFocus = useRef<HTMLElement | null>(null);
  const writingBookmark = useRef<{
    filename: string | null;
    doc: Editor['state']['doc'] | null;
    selection: Editor['state']['selection'] | null;
    scrollTop: number;
    focus: HTMLElement | null;
    invoker: HTMLElement | null;
    titleSelection: { start: number; end: number; direction: 'forward' | 'backward' | 'none' } | null;
  } | null>(null);
  const overlays = useRef({ paletteOpen, panelOpen, sidebarOpen, exportOpen, exportBusy, updateOpen, restoreOpen, reflectionActive: false });
  overlays.current = { paletteOpen, panelOpen, sidebarOpen, exportOpen, exportBusy, updateOpen, restoreOpen, reflectionActive: reflectionPhase !== 'closed' };
  const setPaletteOpen = useCallback((value: React.SetStateAction<boolean>) => {
    const state = overlays.current;
    if (state.exportOpen || state.updateOpen || state.restoreOpen || state.reflectionActive) return;
    const next = typeof value === 'function' ? value(state.paletteOpen) : value;
    setPaletteOpenState(next);
    if (next) setPanelOpenState(false);
  }, [setPanelOpenState]);
  const setPanelOpen = useCallback((value: React.SetStateAction<boolean>) => {
    const state = overlays.current;
    if (state.exportOpen || state.updateOpen || state.restoreOpen || (state.reflectionActive && !aiSettingsRoute.current)) return;
    const next = typeof value === 'function' ? value(state.panelOpen) : value;
    if (state.reflectionActive && next) return;
    setPanelOpenState(next);
    if (!next) { aiSettingsRoute.current = false; setAISettingsFromReflection(false); }
    if (next) setPaletteOpenState(false);
  }, [setPanelOpenState]);
  const setSidebarOpen = useCallback((value: React.SetStateAction<boolean>) => {
    const state = overlays.current;
    if (state.exportOpen || state.updateOpen || state.restoreOpen || (state.reflectionActive && !reflectionState.current.pinned)) return;
    const next = typeof value === 'function' ? value(state.sidebarOpen) : value;
    setSidebarOpenState(next);
    if (next) { setPaletteOpenState(false); setPanelOpenState(false); }
  }, [setPanelOpenState]);
  const setExportOpen = useCallback((open: boolean) => {
    if (overlays.current.exportBusy || overlays.current.updateOpen || overlays.current.reflectionActive) return;
    setExportOpenState(open);
    if (open) { setPaletteOpenState(false); setPanelOpenState(false); }
  }, [setPanelOpenState]);
  const reflectionActive = reflectionPhase !== 'closed';
  const otherDialogOpen = paletteOpen || panelOpen || exportOpen || updateOpen || restoreOpen;
  const dialogOpen = otherDialogOpen || reflectionActive;
  const visibleSidebar = sidebarOpen && !otherDialogOpen && (!reflectionActive || sidebarPinned);
  const [recallPeriod, setRecallPeriod] = useState<RecallPeriod | null>(() => ({ unit: 'month', anchor: todayKey() }));
  const [recallRange, setRecallRange] = useState<RecallRange | null>(() => periodRange({ unit: 'month', anchor: todayKey() }));
  const [timeViewRequest, setTimeViewRequest] = useState(0);
  const [rangeLabel, setRangeLabel] = useState<string | null>(() => periodLabel({ unit: 'month', anchor: todayKey() }));
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const rangeRequest = useRef(0);
  useEffect(() => {
    if (!sidebarOpen || rangeLabel === null) {
      rangeRequest.current += 1;
      setRangeLoading(false);
      if (rangeLabel === null) setRangeError(null);
    }
  }, [sidebarOpen, rangeLabel]);

  const onSaved = useCallback((filename: string, content: string) => {
    updateDocTags(filename, parseDocument(filename, content).body);
    setTagsRev(n => n + 1);
  }, []);
  const { text, title, filename: currentFilename, loading, status: saveStatus, error: saveError, notice,
    change: changeText, changeTitle, getContent, open: openDocument, flush } = useDocumentSession(editor, onSaved);

  const closeReflection = useCallback((reason: 'dismiss' | 'navigate' | 'write' = 'dismiss', force = false) => {
    if (!reflectionState.current.active || (reflectionState.current.exporting && !force)) return;
    reflectionRequest.current += 1;
    reflectionState.current.active = false;
    overlays.current.reflectionActive = false;
    setReflectionPhase('closed');
    setReflectionPreparationError(null);
    if (aiSettingsRoute.current) {
      aiSettingsRoute.current = false;
      setAISettingsFromReflection(false);
      setPanelOpenState(false);
    }
    const saved = writingBookmark.current;
    if (reason === 'navigate' || !saved) return;
    requestAnimationFrame(() => {
      if (reflectionState.current.active || saved.filename !== currentFilename) return;
      if (editor && saved.doc && saved.selection && editor.state.doc.eq(saved.doc) && !editor.state.selection.eq(saved.selection)) {
        editor.view.dispatch(editor.state.tr.setSelection(saved.selection).setMeta('addToHistory', false));
      }
      const invoker = saved.invoker;
      if (reason === 'write') {
        editor?.view.focus();
      } else if (invoker?.isConnected && invoker.closest('[role="complementary"]') && !invoker.closest('[inert]')) {
        invoker.focus({ preventScroll: true });
      } else if (saved.focus?.isConnected) {
        if (editor && saved.focus === editor.view.dom) editor.view.focus();
        else saved.focus.focus({ preventScroll: true });
        if (saved.focus instanceof HTMLTextAreaElement && saved.titleSelection) {
          saved.focus.setSelectionRange(saved.titleSelection.start, saved.titleSelection.end, saved.titleSelection.direction);
        }
      } else editor?.view.focus();
      const scroller = document.getElementById('silens-scroll-container');
      if (scroller) scroller.scrollTop = saved.scrollTop;
    });
  }, [editor, currentFilename, setPanelOpenState]);

  const openReflectionAISettings = useCallback(() => {
    if (!reflectionState.current.active || reflectionState.current.exporting) return;
    aiSettingsRoute.current = true;
    setAISettingsFromReflection(true);
    setAISettingsRequested(value => value + 1);
    setPaletteOpenState(false);
    setPanelOpenState(true);
  }, [setPanelOpenState]);
  useEffect(() => {
    if (!panelOpen) {
      setAISettingsRequested(0);
      if (aiSettingsRoute.current) {
        aiSettingsRoute.current = false;
        setAISettingsFromReflection(false);
      }
    }
  }, [panelOpen]);

  const openReflection = useCallback(async (perspective: ReflectionPerspective = { kind: 'all' }) => {
    if (isFocusMode || loading || storageBusy || updateBusy || !currentFilename || reflectionState.current.exporting || reflectionState.current.navigating
      || overlays.current.exportOpen || overlays.current.updateOpen || overlays.current.restoreOpen) return;
    if (reflectionState.current.active && !reflectionPreparationError) return;
    if (!reflectionState.current.active) {
      const focus = lastWritingFocus.current ?? editor?.view.dom ?? null;
      writingBookmark.current = {
        filename: currentFilename, doc: editor?.state?.doc ?? null, selection: editor?.state?.selection ?? null,
        scrollTop: document.getElementById('silens-scroll-container')?.scrollTop ?? 0,
        focus, invoker: document.activeElement instanceof HTMLElement ? document.activeElement : null,
        titleSelection: focus instanceof HTMLTextAreaElement
          ? { start: focus.selectionStart, end: focus.selectionEnd, direction: focus.selectionDirection } : null,
      };
    }
    const request = ++reflectionRequest.current;
    reflectionState.current.active = true;
    overlays.current.reflectionActive = true;
    setReflectionPerspective(perspective);
    setReflectionPreparationError(null);
    setReflectionPhase('preparing');
    setPaletteOpenState(false);
    setPanelOpenState(false);
    try {
      await flush();
      if (request !== reflectionRequest.current || reflectionState.current.focused) return;
      setReflectionPhase('open');
    } catch {
      if (request !== reflectionRequest.current) return;
      setReflectionPhase('open');
      setReflectionPreparationError('当前文字还未保存，先收好这份草稿，再展开这段时光。');
    }
  }, [isFocusMode, loading, storageBusy, updateBusy, currentFilename, editor, reflectionPreparationError, flush, setPanelOpenState]);

  const changeReflectionContext = useCallback((perspective: ReflectionPerspective) => {
    if (reflectionState.current.active && reflectionState.current.pinned && !reflectionState.current.exporting) {
      setReflectionPerspective(perspective);
    }
  }, []);
  const changeReflectionExportBusy = useCallback((busy: boolean) => {
    reflectionState.current.exporting = busy;
    setReflectionExportBusy(busy);
  }, []);
  const toggleFocusWithReflection = useCallback(() => {
    closeReflection('dismiss', true);
    toggleFocusMode();
  }, [closeReflection, toggleFocusMode]);
  useEffect(() => {
    if (isFocusMode) closeReflection('dismiss', true);
  }, [isFocusMode, closeReflection]);
  useEffect(() => () => { reflectionRequest.current += 1; }, []);

  useAudio(atmosphere.sound, atmosphere.volume);
  useThemeCSS(activeTheme as Theme);

  useEffect(() => {
    if (editor) void openDocument(todayKey() + '.md', true);
  }, [editor, openDocument]);

  const closeState = useRef({ loading: true, storageBusy: false, updateBusy: false, reflectionExportBusy: false });
  closeState.current = { loading, storageBusy, updateBusy, reflectionExportBusy };
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested(async event => {
      event.preventDefault();
      if (closing.current || closeState.current.loading || closeState.current.storageBusy || closeState.current.updateBusy || closeState.current.reflectionExportBusy || reflectionState.current.exporting) return;
      closing.current = true;
      setStorageBusy(true);
      try {
        await flush();
        await invoke('create_backup');
        await getCurrentWindow().destroy();
      } catch (cause) {
        setStorageError(`退出前未能完成保存或备份，请重试。${String(cause)}`);
      } finally {
        closing.current = false;
        setStorageBusy(false);
      }
    }).then(stop => { if (disposed) stop(); else unlisten = stop; })
      .catch(cause => setStorageError(`无法启用退出前保存：${String(cause)}`));
    return () => { disposed = true; unlisten?.(); };
  }, [flush]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<string>('silens-index-warning', event => setStorageError(event.payload))
      .then(unlisten => { if (disposed) unlisten(); else stop = unlisten; })
      .catch(cause => console.error('Index notifications unavailable:', cause));
    return () => { disposed = true; stop?.(); };
  }, []);

  const runStorageAction = useCallback(async (action: () => Promise<unknown>) => {
    if (storageBusy || loading || reflectionState.current.active) return;
    setStorageBusy(true);
    setStorageError(null);
    try {
      await flush();
      await action();
    } catch (cause) {
      setStorageError(`操作未完成：${String(cause)}`);
    } finally {
      setStorageBusy(false);
    }
  }, [flush, storageBusy, loading]);

  useEffect(() => {
    if (notice) setToast(notice.message);
  }, [notice, setToast]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 1500);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!dialogOpen || sidebarPinned) return;
    setSidebarOpenState(false);
  }, [dialogOpen, sidebarPinned]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || dialogOpen || !visibleSidebar) return;
      setSidebarOpenState(false);
      setSidebarPinned(false);
      editor?.view.dom.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [dialogOpen, visibleSidebar, editor]);

  // Global shortcuts
  useGlobalShortcuts(
    paletteOpen, setPaletteOpen,
    sidebarOpen, setSidebarOpen, sidebarPinned, setSidebarPinned,
    panelOpen, setPanelOpen,
    toggleFocusWithReflection,
    exportOpen || storageBusy || updateOpen || restoreOpen,
  );

  // Tag click event listener
  useEffect(() => {
    const handler = (event: Event) => {
      setForcedTag((event as CustomEvent<{ tag: string }>).detail.tag);
      setSidebarOpen(true);
    };
    window.addEventListener('silens-tag-click', handler);
    return () => window.removeEventListener('silens-tag-click', handler);
  }, [setSidebarOpen]);

  // === Derived values ===
  const tagsByDoc = useMemo(() => loadTagsByDoc(), [tagsRev]);
  const knownTags = useMemo(() => {
    const freq = computeTagFrequency(tagsByDoc);
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t);
  }, [tagsByDoc]);

  const rawDisplay = decodeEmptyLines(text);
  const charCount = (title + rawDisplay).replace(/\s/g, '').length;
  const article = !!currentFilename && documentKind(currentFilename) === 'article';
  const currentTitle = currentFilename ? displayTitle(currentFilename, article ? title : '') : '正在打开笔记';
  const headerBg = `${themeConfig.bg}ed`;

  const handleExportContent = getContent;

  const createArticle = useCallback(async () => {
    if (storageBusy || loading || reflectionState.current.active) return;
    if (!await openDocument(`article-${crypto.randomUUID()}.md`, true)) return;
    setTargetSearchText(null);
    setPaletteOpen(false);
    if (!sidebarPinned) setSidebarOpen(false);
  }, [storageBusy, loading, openDocument, setPaletteOpen, sidebarPinned, setSidebarOpen]);

  // === Document navigation helper ===
  // 成功切换返回目标日期字符串；失败（文件不存在）返回 null
  const switchToDocument = useCallback(async (date: string, searchText?: NoteTarget, fromReflection = false): Promise<{ date: string | null }> => {
    if (storageBusy || (reflectionState.current.active && !fromReflection)) return { date: null };
    const filename = date.endsWith('.md') ? date : `${date}.md`;
    const request = reflectionRequest.current;
    const isCurrent = fromReflection ? () => reflectionState.current.active && request === reflectionRequest.current : undefined;
    const opened = await openDocument(filename, filename === `${todayKey()}.md`, undefined, isCurrent);
    if (!opened || (isCurrent && !isCurrent())) return { date: null };
    setTargetSearchText(searchText ?? null);
    return { date };
  }, [openDocument, storageBusy]);

  const navigateReflection = useCallback(async (filename: string, target?: NoteTarget) => {
    if (!reflectionState.current.active || reflectionState.current.navigating || reflectionState.current.exporting) return false;
    const request = reflectionRequest.current;
    reflectionState.current.navigating = true;
    try {
      const opened = await switchToDocument(filename, target, true);
      return request === reflectionRequest.current && !!opened.date;
    } finally {
      reflectionState.current.navigating = false;
    }
  }, [switchToDocument]);

  useEffect(() => {
    const handleLink = (event: Event) => {
      const docName = (event as CustomEvent<{ docName: string }>).detail.docName;
      if (storageBusy) return;
      void switchToDocument(docName);
    };
    window.addEventListener('silens-link-click', handleLink);
    return () => window.removeEventListener('silens-link-click', handleLink);
  }, [switchToDocument, storageBusy]);

  const updateRecallRange = useCallback((range: RecallRange | null, period: RecallPeriod | null = null, label?: string) => {
    if (reflectionState.current.exporting) return;
    rangeRequest.current += 1;
    setRecallPeriod(period);
    setRecallRange(range);
    setRangeLabel(range ? label ?? (range.start && range.end ? `${range.start} – ${range.end}`
      : range.start ? `${range.start} 起` : `截至 ${range.end}`) : null);
    setRangeLoading(false);
    setRangeError(null);
  }, []);
  const changeRecallPeriod = useCallback((period: RecallPeriod) => {
    updateRecallRange(periodRange(period), period, periodLabel(period));
  }, [updateRecallRange]);

  const jumpToCustomRange = useCallback(async (start?: string, end?: string, label?: string, period?: RecallPeriod) => {
    if ((!start && !end) || reflectionState.current.exporting) return;
    const range = { start: start ?? '0001-01-01', end: end ?? todayKey() };
    if (range.start > range.end) [range.start, range.end] = [range.end, range.start];
    updateRecallRange(range, period ?? null, label ?? (start && end ? `${range.start} – ${range.end}` : start ? `${start} 至今` : `截至 ${end}`));
    const request = rangeRequest.current;
    setRangeLoading(true);
    setRangeError(null);
    setSidebarOpen(true);
    try {
      const days = await invoke<RecallDay[]>('get_timeline_data');
      if (request !== rangeRequest.current) return;
      const count = days.filter(day => day.date >= range.start && day.date <= range.end).length;
      if (!count) setToast(label ? `${label}还没有笔记` : '这个区间还没有笔记');
    } catch (cause) {
      if (request !== rangeRequest.current) return;
      console.error('加载创作时间范围失败:', cause);
      setRangeError('暂时无法读取这个区间，请稍后重试');
    } finally {
      if (request === rangeRequest.current) setRangeLoading(false);
    }
  }, [setSidebarOpen, setToast, updateRecallRange]);

  const jumpToTimeRange = useCallback(async (preset: 'yesterday' | 'this-week' | 'this-month' | 'this-year') => {
    if (preset === 'yesterday') {
      await jumpToCustomRange(yesterdayKey(), yesterdayKey(), '昨天');
      return;
    }
    const period: RecallPeriod = { unit: preset === 'this-week' ? 'week' : preset === 'this-month' ? 'month' : 'year', anchor: todayKey() };
    const range = periodRange(period);
    await jumpToCustomRange(range.start, range.end, preset === 'this-week' ? '本周' : preset === 'this-month' ? '本月' : '本年', period);
  }, [jumpToCustomRange]);

  return (
    <MotionConfig reducedMotion="user">
    <div
      className="transition-colors duration-500 ease-in-out"
      style={{
        backgroundColor: themeConfig.bg,
        minHeight: '100vh',
      }}
    >
      {/* Cursor styles */}
      <style>{`
        .ProseMirror {
          caret-color: rgba(75, 85, 99, 0.7) !important;
          transition: caret-color 0.15s ease-in-out;
        }
      `}</style>
      {isTyping && !dialogOpen && !visibleSidebar && (
        <style>{`
          * { cursor: none !important; }
          .ProseMirror { caret-color: rgba(75, 85, 99, 1) !important; }
        `}</style>
      )}


      <div data-writing-surface inert={reflectionActive} aria-hidden={reflectionActive || undefined}
        onFocusCapture={event => {
          if (event.target instanceof HTMLElement && event.target.closest('[data-note-content]')) lastWritingFocus.current = event.target;
        }}>
      {/* Settings button */}
      <button
        ref={panelBtnRef}
        onClick={() => setPanelOpen(prev => !prev)}
        className="chrome-control chrome-fade fixed bottom-6 right-6 z-30"
        data-visible={isIdle || panelOpen}
        style={{
          visibility: reflectionActive ? 'hidden' : undefined,
          pointerEvents: isIdle || panelOpen ? 'auto' : 'none',
          color: themeConfig.muted,
          background: 'none', border: 'none', cursor: 'pointer', padding: '10px',
        }}
        aria-label="书写氛围"
        title="氛围设置 (⌘⇧M)"
      >
        <SlidersHorizontal size={16} strokeWidth={1.5} />
      </button>

      {/* Bottom vignette */}
      <div className="fixed bottom-0 left-0 right-0 h-32 pointer-events-none z-[25]" style={{ visibility: reflectionActive ? 'hidden' : undefined }}>
        {(['paper', 'white', 'night'] as Theme[]).map((t) => (
          <div
            key={t}
            className="absolute inset-0 transition-opacity duration-500 ease-in-out"
            style={{
              background: `linear-gradient(to top, ${themeConfigs[t].bg} 15%, transparent)`,
              opacity: activeTheme === t ? 1 : 0,
            }}
          />
        ))}
      </div>

      {/* Word count */}
      <div
        className={`chrome-footer fixed bottom-6 left-0 right-0 z-30 pointer-events-none flex justify-center ${visibleSidebar ? 'chrome-footer-shifted' : ''}`}
        style={{ visibility: reflectionActive ? 'hidden' : undefined }}
      >
        <div
          className="chrome-fade select-none flex items-center text-[11px] tracking-[0.06em]"
          data-visible={isIdle}
          style={{ color: themeConfig.muted }}
        >
          <span>{charCount} 字</span>
          <span className="ml-3" aria-live="polite">{saveStatus === 'saving' ? '保存中' : saveStatus === 'pending' ? '待保存' : saveStatus === 'error' ? '尚未保存' : '本地保存'}</span>
        </div>
      </div>

      {/* Header */}
      <div
        className="chrome-fade fixed top-0 left-0 right-0 z-40 flex flex-col items-center pt-5 pb-4"
        data-visible={isIdle && !visibleSidebar}
        style={{ backgroundColor: headerBg, pointerEvents: isIdle && !visibleSidebar ? 'auto' : 'none' }}
      >
        <button
          type="button"
          className="chrome-control absolute top-4 left-4 p-2"
          style={{
            color: themeConfig.muted,
            pointerEvents: currentFilename ? 'auto' : 'none',
          }}
          onClick={() => {
            setPaletteOpen(false);
            setSidebarOpen(true);
          }}
          title="回顾笔记 (Cmd/Ctrl + L)"
          aria-label="回顾笔记"
        >
          <Columns size={16} strokeWidth={1.5} />
        </button>
        <div
          className="select-none font-medium"
          style={{
            color: themeConfig.muted,
            fontSize: '11px',
            letterSpacing: '0.22em',
          }}
        >
          SILENS
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs" style={{ color: themeConfig.muted }}>
          <span className="max-w-[45vw] truncate">{currentTitle}</span>
          {currentFilename && currentFilename !== `${todayKey()}.md` && (
            <button className="flex items-center gap-1 hover:opacity-70" onClick={() => { void switchToDocument(todayKey()); }}>
              <ArrowLeft size={12} /> 回到今天
            </button>
          )}
        </div>
        <button aria-label="搜索笔记" title="搜索笔记 (Cmd/Ctrl + K)"
          className="chrome-control absolute right-4 top-4 p-2"
          style={{ color: themeConfig.muted }} onClick={() => setPaletteOpen(true)}>
          <Search size={16} strokeWidth={1.5} />
        </button>
      </div>

      {/* Main canvas */}
      <div
        className="h-full"
        onClick={() => {
          if (sidebarOpen && !sidebarPinned) setSidebarOpen(false);
        }}
      >
        <Canvas
          theme={activeTheme}
          uiVisible={isIdle}
          isSidebarOpen={visibleSidebar}
          onTyping={handleTyping}
          onMouseMove={() => {}}
          onChange={value => { if (!reflectionState.current.active) changeText(value); }}
          title={title}
          onTitleChange={value => { if (!reflectionState.current.active) changeTitle(value); }}
          suspended={reflectionActive}
          disabled={loading || storageBusy || updateBusy || !currentFilename}
          onEditorReady={setEditor}
          isFocusMode={isFocusMode}
          knownTags={knownTags}
          targetSearchText={targetSearchText}
          onConsumedTargetSearchText={() => setTargetSearchText(null)}
          filename={currentFilename}
          notesRevision={tagsRev}
          onNavigate={(filename, searchText) => { void switchToDocument(filename, searchText); }}
        />
      </div>
      </div>

      <PeriodReflectionScroll
        open={reflectionActive}
        preparing={reflectionPhase === 'preparing'}
        preparationError={reflectionPreparationError}
        suppressed={isFocusMode}
        range={recallRange}
        perspective={reflectionPerspective}
        revision={tagsRev}
        sidebarInteractive={sidebarPinned && visibleSidebar}
        theme={activeTheme as Theme}
        themeConfig={themeConfig}
        onRangeChange={range => updateRecallRange(range)}
        onPerspectiveChange={setReflectionPerspective}
        onClose={closeReflection}
        onNavigate={navigateReflection}
        onRetryPreparation={() => { void openReflection(reflectionPerspective); }}
        onExportBusyChange={changeReflectionExportBusy}
        aiSettingsRevision={aiSettingsRevision}
        onOpenAISettings={openReflectionAISettings}
        paused={aiSettingsFromReflection && panelOpen}
      />

      {/* Command palette */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        editor={editor}
        currentFilename={currentFilename}
        onTagManaged={() => setTagsRev(n => n + 1)}
        onNewArticle={() => { void createArticle(); }}
        onOpenReflection={isFocusMode ? undefined : () => openReflection({ kind: 'all' })}
        onToday={async () => { if ((await switchToDocument(todayKey())).date) setPaletteOpen(false); }}
        onSelectResult={async (date, searchText) => !!(await switchToDocument(date, searchText)).date}
        onQuickJump={async (preset, customRange) => {
          setPaletteOpen(false);
          setTimeViewRequest(value => value + 1);
          if (customRange) {
            await jumpToCustomRange(customRange.start, customRange.end);
            return;
          }
          if (preset) await jumpToTimeRange(preset);
        }}
        onLoadDocument={async (_content, filename, target) => {
          if (await openDocument(filename)) setTargetSearchText(target ?? null);
        }}
      />

      {/* Timeline sidebar */}
      <div>
        <TimelineSidebar
          isOpen={visibleSidebar}
          isPinned={sidebarPinned}
          reflectionOpen={reflectionActive && sidebarPinned}
          onReflectionContextChange={changeReflectionContext}
          onOpenReflection={isFocusMode ? undefined : perspective => { void openReflection(perspective); }}
          onTogglePin={() => setSidebarPinned(pinned => !pinned)}
          setIsOpen={open => { setSidebarOpen(open); if (!open) setSidebarPinned(false); }}
          isPaletteOpen={paletteOpen}
          externalForceTag={forcedTag}
          onClearForceTag={() => setForcedTag(null)}
          onNewArticle={reflectionActive ? undefined : () => { void createArticle(); }}
          currentFilename={currentFilename}
          tagsRev={tagsRev}
          theme={activeTheme}
          onBlockClick={(text) => {
            if (reflectionState.current.active) return;
            setTargetSearchText(text);
            if (!sidebarPinned) setSidebarOpen(false);
          }}
          onJumpTime={(preset, customRange) => {
            if (customRange) void jumpToCustomRange(customRange.start, customRange.end);
            else if (preset) void jumpToTimeRange(preset);
          }}
          recallRange={recallRange}
          recallPeriod={recallPeriod}
          onPeriodChange={changeRecallPeriod}
          externalForceTime={timeViewRequest}
          rangeLoading={rangeLoading}
          rangeError={rangeError}
          rangeLabel={rangeLabel}
          onClearRange={() => updateRecallRange(null)}
          onSelectResult={async (date, searchText) => {
            if (!(await switchToDocument(date, searchText)).date) return;
            if (!sidebarPinned) setSidebarOpen(false);
          }}
          onDateClick={async (date) => {
            const { date: opened } = await switchToDocument(date);
            if (opened && !sidebarPinned) setSidebarOpen(false);
          }}
        />
      </div>

      {/* Atmosphere panel */}
      <AtmospherePanel
        open={panelOpen}
        ref={panelRef}
        panelBtnRef={panelBtnRef}
        onToggle={() => setPanelOpen(prev => !prev)}
        onExport={() => setExportOpen(true)}
        onCheckUpdates={() => { setPanelOpenState(false); setUpdateOpen(true); }}
        atmosphere={atmosphere}
        onChange={handleAtmosphereChange}
        themeConfig={themeConfig}
        activeTheme={activeTheme as Theme}
        focusDuration={focusDuration}
        onFocusDurationChange={setFocusDuration}
        aiOpenRequested={aiSettingsRequested}
        onAISaved={config => setAISettingsRevision(value => Math.max(value + 1, config.revision))}
        actionsDisabled={aiSettingsFromReflection}
        storageBusy={storageBusy || loading}
        onOpenStorage={() => { void invoke('open_storage_folder').catch(cause => setStorageError(String(cause))); }}
        onOpenBackups={() => { void invoke('open_backups_folder').catch(cause => setStorageError(String(cause))); }}
        onRestore={() => { setPanelOpenState(false); setRestoreOpen(true); }}
        onBackup={() => { void runStorageAction(async () => { await invoke('create_backup'); setToast('备份已保存'); }); }}
        onMoveWorkspace={() => { void runStorageAction(async () => {
          const selected = await openFolderDialog({ directory: true, multiple: false, title: '选择笔记文件夹的位置' });
          if (typeof selected !== 'string') return;
          await invoke('change_storage_path', { newPath: selected });
          await openDocument(currentFilename ?? `${todayKey()}.md`, true, 'reload');
          setTagsRev(n => n + 1);
          setToast('笔记已迁移，原文件仍保留');
        }); }}
      />

      <UpdateManager
        open={updateOpen}
        onOpenChange={setUpdateOpen}
        canNotify={isIdle && !dialogOpen && !storageBusy && !loading && !isFocusMode}
        blocked={storageBusy || loading}
        onBusyChange={setUpdateBusy}
        prepareToInstall={async () => { await flush(); await invoke('create_backup'); }}
      />

      {/* Export dialog */}
      <RestoreDialog
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        onRestored={async () => {
          await openDocument(currentFilename ?? `${todayKey()}.md`, true, 'reload');
          setTagsRev(n => n + 1);
          setToast('已恢复备份');
        }}
        theme={activeTheme as Theme}
        themeConfig={themeConfig}
      />
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpenState(false)}
        onBusyChange={setExportBusy}
        theme={activeTheme as Theme}
        themeConfig={themeConfig}
        exportContent={handleExportContent}
        filename={article ? `${currentTitle}.md` : currentFilename ?? ''}
        title={article ? title : undefined}
      />

      {!dialogOpen && (saveError || storageError) && (
        <div role="alert" className="fixed bottom-16 left-1/2 z-[10000] w-[min(90vw,520px)] -translate-x-1/2 rounded-xl border p-4 text-sm shadow-sm"
          style={{ background: themeConfig.bg, color: themeConfig.text, borderColor: 'var(--theme-muted)' }}>
          <p>{saveError || storageError}</p>
          <div className="mt-3 flex gap-4">
            <button onClick={() => { void (currentFilename ? flush() : openDocument(`${todayKey()}.md`, true)).catch(() => {}); setStorageError(null); }}>重试</button>
            <button onClick={() => setExportOpen(true)}>导出当前文字</button>
            {saveStatus === 'error' && currentFilename && <button onClick={() => { void openDocument(currentFilename, true, 'preserve'); }}>保留副本并重新读取</button>}
            {storageError && !saveError && <button onClick={() => setStorageError(null)}>收起</button>}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && !dialogOpen && !isTyping && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] px-6 py-2 rounded-full backdrop-blur-md bg-white/20 dark:bg-black/20 text-xs tracking-widest"
          style={{ color: themeConfig.muted }}
        >
          {toast}
        </div>
      )}

      {/* Focus mode indicator */}
      {isFocusMode && (
        <div
          className="chrome-fade fixed bottom-6 left-6 z-[180] text-[11px] tracking-wide select-none pointer-events-none"
          data-visible={isIdle}
          style={{ color: themeConfig.muted }}
        >
          一期一会已开启 {focusTimeLeft !== null && focusTimeLeft > 0
            ? `· ${Math.floor(focusTimeLeft / 60).toString().padStart(2, '0')}:${(focusTimeLeft % 60).toString().padStart(2, '0')}`
            : ''}
        </div>
      )}
    </div>
    </MotionConfig>
  );
}
