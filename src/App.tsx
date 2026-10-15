import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openFolderDialog } from '@tauri-apps/plugin-dialog';
import { MotionConfig } from 'framer-motion';
import { Canvas } from './components/Canvas';
import { CommandPalette } from './components/CommandPalette';
import { AtmospherePanel } from './components/AtmospherePanel';
import { ExportDialog } from './components/ExportDialog';
import { Editor } from '@tiptap/react';
import type { AtmosphereState, Theme } from './types';
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
  const [targetSearchText, setTargetSearchText] = useState<string | null>(null);
  const [exportOpen, setExportOpenState] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const overlays = useRef({ paletteOpen, panelOpen, sidebarOpen, exportOpen, exportBusy });
  overlays.current = { paletteOpen, panelOpen, sidebarOpen, exportOpen, exportBusy };
  const setPaletteOpen = useCallback((value: React.SetStateAction<boolean>) => {
    const state = overlays.current;
    if (state.exportOpen) return;
    const next = typeof value === 'function' ? value(state.paletteOpen) : value;
    setPaletteOpenState(next);
    if (next) setPanelOpenState(false);
  }, [setPanelOpenState]);
  const setPanelOpen = useCallback((value: React.SetStateAction<boolean>) => {
    const state = overlays.current;
    if (state.exportOpen) return;
    const next = typeof value === 'function' ? value(state.panelOpen) : value;
    setPanelOpenState(next);
    if (next) setPaletteOpenState(false);
  }, [setPanelOpenState]);
  const setSidebarOpen = useCallback((value: React.SetStateAction<boolean>) => {
    const state = overlays.current;
    if (state.exportOpen) return;
    const next = typeof value === 'function' ? value(state.sidebarOpen) : value;
    setSidebarOpenState(next);
    if (next) { setPaletteOpenState(false); setPanelOpenState(false); }
  }, [setPanelOpenState]);
  const setExportOpen = useCallback((open: boolean) => {
    if (overlays.current.exportBusy) return;
    setExportOpenState(open);
    if (open) { setPaletteOpenState(false); setPanelOpenState(false); }
  }, [setPanelOpenState]);
  const dialogOpen = paletteOpen || panelOpen || exportOpen;
  const visibleSidebar = sidebarOpen && !dialogOpen;
  // 区间日记浏览模式：加载区间内所有日记，侧边栏展示朋友圈式时间流
  const [rangeDocs, setRangeDocs] = useState<{ date: string; content: string }[]>([]);
  const [rangeLabel, setRangeLabel] = useState<string | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const rangeRequest = useRef(0);
  useEffect(() => {
    if (!sidebarOpen || rangeLabel === null) {
      rangeRequest.current += 1;
      setRangeLoading(false);
    }
  }, [sidebarOpen, rangeLabel]);

  const onSaved = useCallback((filename: string, content: string) => {
    updateDocTags(filename, content);
    setTagsRev(n => n + 1);
  }, []);
  const { text, filename: currentFilename, loading, status: saveStatus, error: saveError, notice,
    change: changeText, open: openDocument, flush } = useDocumentSession(editor, onSaved);

  useAudio(atmosphere.sound, atmosphere.volume);
  useThemeCSS(activeTheme as Theme);

  useEffect(() => {
    if (editor) void openDocument(todayKey() + '.md', true);
  }, [editor, openDocument]);

  const closeState = useRef({ loading: true, storageBusy: false });
  closeState.current = { loading, storageBusy };
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested(async event => {
      event.preventDefault();
      if (closing.current || closeState.current.loading || closeState.current.storageBusy) return;
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

  const runStorageAction = useCallback(async (action: () => Promise<unknown>) => {
    if (storageBusy || loading) return;
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
    setRangeDocs([]);
    setRangeLabel(null);
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
    toggleFocusMode,
    exportOpen || storageBusy,
  );

  // Tag click event listener
  useEffect(() => {
    const handler = (_e: any) => {
      setSidebarOpen(true);
    };
    window.addEventListener('silens-tag-click', handler);
    return () => window.removeEventListener('silens-tag-click', handler);
  }, []);

  // === Derived values ===
  const tagsByDoc = useMemo(() => loadTagsByDoc(), [tagsRev]);
  const knownTags = useMemo(() => {
    const freq = computeTagFrequency(tagsByDoc);
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t);
  }, [tagsByDoc]);

  const rawDisplay = decodeEmptyLines(text);
  const charCount = rawDisplay.replace(/\s/g, '').length;
  const headerBg = `${themeConfig.bg}ed`;

  const handleExportContent = useCallback(() => {
    return decodeEmptyLines(text);
  }, [text]);

  // === Document navigation helper ===
  // 成功切换返回目标日期字符串；失败（文件不存在）返回 null
  const switchToDocument = useCallback(async (date: string, searchText?: string): Promise<{ date: string | null }> => {
    if (storageBusy) return { date: null };
    const filename = date.endsWith('.md') ? date : `${date}.md`;
    const opened = await openDocument(filename, filename === `${todayKey()}.md`);
    if (opened) setTargetSearchText(searchText ?? null);
    return { date: opened ? date : null };
  }, [openDocument, storageBusy]);

  useEffect(() => {
    const handleLink = (event: Event) => {
      const docName = (event as CustomEvent<{ docName: string }>).detail.docName;
      if (storageBusy) return;
      void openDocument(docName.endsWith('.md') ? docName : `${docName}.md`);
    };
    window.addEventListener('silens-link-click', handleLink);
    return () => window.removeEventListener('silens-link-click', handleLink);
  }, [openDocument, storageBusy]);

  // 定位到 [startKey, endKey] 区间内最新的日记；兼容带后缀文件名（YYYY-MM-DD_xxx.md）
  const jumpToRange = useCallback(async (startKey: string, endKey: string): Promise<string | null> => {
    try {
      const data = await invoke<{ filename: string }[]>('get_all_documents');
      const docNames = (data || []).map((d) => d.filename).filter((f: unknown): f is string =>
        typeof f === 'string' && /^\d{4}-\d{2}-\d{2}(_|\.md$)/.test(f)
      );
      const inRange = docNames
        .filter((f) => { const k = f.slice(0, 10); return k >= startKey && k <= endKey; })
        .sort();
      return inRange.length > 0 ? inRange[inRange.length - 1] : null;
    } catch (err) {
      console.error('区间查询失败:', err);
      return null;
    }
  }, []);

  // 自定义日期区间穿梭：
  // - 双边（start + end）→ 加载区间内全部日记并展示时间流（朋友圈式）
  // - 单边 → 定位到该侧最新一篇日记并打开主编辑器
  const jumpToCustomRange = useCallback(async (start?: string, end?: string) => {
    if (start && end) {
      const request = ++rangeRequest.current;
      setRangeDocs([]);
      setRangeLoading(true);
      setRangeError(null);
      // 双边：同步激活区间浏览模式（侧边栏时间流），主页保持当前文档不动。
      // 固定侧边栏，防止 mouseleave / 面板互斥逻辑把刚打开的区间侧边栏关掉
      setRangeLabel(`${start} – ${end}`);
      setSidebarOpen(true);
      setSidebarPinned(true);
      try {
        const data = await invoke<{ filename: string; content: string }[]>('get_all_documents');
        const inRange = (data || [])
          .filter((d) => {
            const k = d.filename.slice(0, 10);
            return /^\d{4}-\d{2}-\d{2}/.test(k) && k >= start && k <= end;
          })
          .sort((a, b) => a.filename.localeCompare(b.filename));
        // 同一日期可能有多篇（带不同后缀），按日期归并
        const merged: { date: string; content: string }[] = [];
        for (const d of inRange) {
          const date = d.filename.slice(0, 10);
          const existing = merged.find((m) => m.date === date);
          if (existing) existing.content += (existing.content ? '\n\n' : '') + d.content;
          else merged.push({ date, content: d.content });
        }
        if (request !== rangeRequest.current) return;
        setRangeDocs(merged);
        setToast(merged.length > 0
          ? `正在浏览 ${start} – ${end}，共 ${merged.length} 天`
          : `${start} – ${end} 暂无记录`);
      } catch (err) {
        if (request !== rangeRequest.current) return;
        console.error('加载区间日记失败:', err);
        setRangeError('暂时无法读取这个区间，请稍后重试');
      } finally {
        if (request === rangeRequest.current) setRangeLoading(false);
      }
      return;
    }
    // 单边：定位到该侧最新一篇日记
    try {
      let target: string | null = null;
      if (start) {
        target = await jumpToRange(start, todayKey());
      } else if (end) {
        target = await jumpToRange('1970-01-01', end);
      }
      if (target) {
        const { date } = await switchToDocument(target);
        setToast(date ? `已打开 ${date}` : `${target} 未能打开，当前页面保持不变`);
      } else {
        const rangeDesc = start ? `${start} 至今` : `截至 ${end}`;
        setToast(`${rangeDesc} 暂无记录`);
      }
    } catch (err) {
      console.error('区间穿梭失败:', err);
      setToast('穿梭失败');
    }
  }, [jumpToRange, switchToDocument, setToast, todayKey]);

  // 时间穿梭（昨天/本周/本月）：定位到范围内最新的日记
  const jumpToTimeRange = useCallback(async (preset: 'yesterday' | 'this-week' | 'this-month') => {
    try {
      let target: string | null;
      if (preset === 'yesterday') {
        const yKey = yesterdayKey();
        target = await jumpToRange(yKey, yKey);
      } else {
        const todayK = todayKey();
        const startKey = preset === 'this-week'
          ? (() => {
              const now = new Date();
              const day = now.getDay() || 7;
              const monday = new Date(now);
              monday.setDate(now.getDate() - day + 1);
              return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
            })()
          : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`;
        target = await jumpToRange(startKey, todayK);
      }
      if (!target) {
        setToast(`${{ yesterday: '昨天', 'this-week': '本周', 'this-month': '本月' }[preset]}还没有笔记`);
        return;
      }

      const { date } = await switchToDocument(target);
      if (date) {
        setToast(`已穿梭至 ${date}`);
      } else {
        setToast(`${target} 未能打开，当前页面保持不变`);
      }
    } catch (err) {
      console.error('时间穿梭失败:', err);
      setToast('穿梭失败');
    }
  }, [jumpToRange, switchToDocument, setToast]);

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


      {/* Settings button */}
      <button
        ref={panelBtnRef}
        onClick={() => setPanelOpen(prev => !prev)}
        className="chrome-control chrome-fade fixed bottom-6 right-6 z-30"
        data-visible={isIdle || panelOpen}
        style={{
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
      <div className="fixed bottom-0 left-0 right-0 h-32 pointer-events-none z-[25]">
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
          <span>{currentFilename ? currentFilename.replace(/\.md$/, '') : '正在打开笔记'}</span>
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
          // 点击主页面：退出区间浏览模式 + 收起未固定侧边栏
          if (rangeLabel !== null || sidebarOpen) {
            setRangeDocs([]);
            setRangeLabel(null);
            if (!sidebarPinned) { setSidebarPinned(false); setSidebarOpen(false); }
          }
        }}
      >
        <Canvas
          theme={activeTheme}
          uiVisible={isIdle}
          isSidebarOpen={visibleSidebar}
          onTyping={handleTyping}
          onMouseMove={() => {}}
          onChange={changeText}
          disabled={loading || storageBusy || !currentFilename}
          onEditorReady={setEditor}
          isFocusMode={isFocusMode}
          knownTags={knownTags}
          targetSearchText={targetSearchText}
          onConsumedTargetSearchText={() => setTargetSearchText(null)}
        />
      </div>

      {/* Command palette */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        editor={editor}
        currentFilename={currentFilename}
        onTagManaged={() => setTagsRev(n => n + 1)}
        onSelectResult={async (date, searchText) => {
          await switchToDocument(date, searchText);
          setPaletteOpen(false);
        }}
        onQuickJump={async (preset, customRange) => {
          setPaletteOpen(false);
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
          onTogglePin={() => setSidebarPinned(pinned => !pinned)}
          setIsOpen={open => { setSidebarOpen(open); if (!open) setSidebarPinned(false); }}
          isPaletteOpen={paletteOpen}
          externalForceTag={undefined}
          onClearForceTag={() => {}}
          tagsRev={tagsRev}
          theme={activeTheme}
          onBlockClick={(text) => {
            setTargetSearchText(text);
            if (!sidebarPinned) setSidebarOpen(false);
          }}
          onJumpTime={(preset, customRange) => {
            // 双边区间 → 加载区间日记流（侧边栏时间流浏览，保持侧边栏打开）
            // 单边 / preset → 定位单篇文档（收起未固定的侧边栏）
            if (customRange) {
              void jumpToCustomRange(customRange.start, customRange.end);
            } else if (preset) {
              void jumpToTimeRange(preset);
            }
            const isBoth = !!(customRange && customRange.start && customRange.end);
            // 双边区间保持侧边栏打开；单边/preset 收起未固定的侧边栏
            if (!isBoth && !sidebarPinned) setSidebarOpen(false);
          }}
          rangeDocs={rangeDocs}
          rangeLoading={rangeLoading}
          rangeError={rangeError}
          rangeLabel={rangeLabel}
          onClearRange={() => { setRangeDocs([]); setRangeLabel(null); setSidebarPinned(false); }}
          onSelectResult={async (date, searchText) => {
            await switchToDocument(date, searchText);
            setRangeDocs([]);
            setRangeLabel(null);
            if (!sidebarPinned) { setSidebarPinned(false); setSidebarOpen(false); }
          }}
          onDateClick={async (date) => {
            setRangeDocs([]);
            setRangeLabel(null);
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
        atmosphere={atmosphere}
        onChange={handleAtmosphereChange}
        themeConfig={themeConfig}
        activeTheme={activeTheme as Theme}
        focusDuration={focusDuration}
        onFocusDurationChange={setFocusDuration}
        storageBusy={storageBusy || loading}
        onOpenStorage={() => { void invoke('open_storage_folder').catch(cause => setStorageError(String(cause))); }}
        onOpenBackups={() => { void invoke('open_backups_folder').catch(cause => setStorageError(String(cause))); }}
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

      {/* Export dialog */}
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpenState(false)}
        onBusyChange={setExportBusy}
        theme={activeTheme as Theme}
        themeConfig={themeConfig}
        exportContent={handleExportContent}
        filename={currentFilename ?? ''}
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
