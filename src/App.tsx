import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Canvas } from './components/Canvas';
import { CommandPalette } from './components/CommandPalette';
import { AtmospherePanel } from './components/AtmospherePanel';
import { ExportDialog } from './components/ExportDialog';
import { Editor } from '@tiptap/react';
import type { AtmosphereState, Theme } from './types';
import { computeTagFrequency, loadTagsByDoc, updateDocTags } from './utils/tags';
import { useDebounce } from './hooks/useDebounce';
import { TimelineSidebar } from './components/TimelineSidebar';
import { useTypingLock } from './hooks/useTypingLock';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { usePanelMutualExclusion } from './hooks/usePanelMutualExclusion';
import { useFocusTimer } from './hooks/useFocusTimer';
import { useAtmospherePanel } from './hooks/useAtmospherePanel';
import { useAudio } from './hooks/useAudio';
import { useThemeCSS } from './hooks/useThemeCSS';
import { encodeEmptyLines, decodeEmptyLines, applyEncodedContent } from './utils/emptyLines';
import { SlidersHorizontal, Columns } from 'lucide-react';

const themeConfigs: Record<Theme, { bg: string; text: string; muted: string }> = {
  paper: { bg: '#F4EAD5', text: '#2f3441', muted: '#8A8275' },
  white: { bg: '#FFFFFF', text: '#2f3441', muted: '#9CA3AF' },
  night: { bg: '#0D1424', text: '#E2E8F0', muted: '#64748B' },
};


function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}


// 模块级单例：启动时预加载今日文档（含"今天"兜底新建逻辑），供区间浏览模式下
// 主页无匹配日记时复用（loadDocument），而不是重新调 IPC load_document
let preloadedToday: { content: string; filename: string } | null = null;

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
  const { panelOpen, setPanelOpen, panelRef, panelBtnRef } = useAtmospherePanel();
  const { isFocusMode, focusTimeLeft, focusDuration, setFocusDuration, toggleFocusMode, toast, setToast } = useFocusTimer();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [text, setText] = useState('');
  const [currentFilename, setCurrentFilename] = useState<string | null>(null);
  const lastSavedContent = useRef('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [tagsRev, setTagsRev] = useState(0);
  const [targetSearchText, setTargetSearchText] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  // 区间日记浏览模式：加载区间内所有日记，侧边栏展示朋友圈式时间流
  const [rangeDocs, setRangeDocs] = useState<{ date: string; content: string }[]>([]);
  const [rangeLabel, setRangeLabel] = useState<string | null>(null);

  const debouncedText = useDebounce(text, 1500);

  // === Side-effect hooks ===
  useAudio(atmosphere.sound, atmosphere.volume);
  useThemeCSS(activeTheme as Theme);

  // Startup: rebuild shadow index + load today's doc
  useEffect(() => {
    const initToday = async () => {
      invoke('rebuild_shadow_index').catch((err) => console.warn('Shadow index sync warning:', err));
      try {
        const t = todayKey() + '.md';
        const content = await invoke<string>('load_document', { filename: t });
        setCurrentFilename(t);
        const encoded = encodeEmptyLines(content);
        setText(encoded);
        lastSavedContent.current = content;
        if (editor) applyEncodedContent(editor, encoded);
      } catch {
        const t = todayKey() + '.md';
        setCurrentFilename(t);
        setText('');
        lastSavedContent.current = '';
      }
    };
    initToday();
  }, [editor]);

  // Auto-save
  useEffect(() => {
    const rawText = decodeEmptyLines(debouncedText);
    if (!rawText.trim() || rawText === lastSavedContent.current) return;

    const autoSave = async () => {
      try {
        const result = await invoke<string>('save_document', {
          content: rawText,
          currentFilename: currentFilename,
        });
        setCurrentFilename(result);
        lastSavedContent.current = rawText;
        updateDocTags(result, rawText);
        setTagsRev(n => n + 1);
      } catch (err) {
        console.error('Silent Auto-save Error:', err);
      }
    };
    autoSave();
  }, [debouncedText, currentFilename]);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 1500);
    return () => clearTimeout(id);
  }, [toast]);

  // Panel mutual exclusion
  usePanelMutualExclusion(paletteOpen, sidebarOpen, setPaletteOpen, setSidebarOpen, sidebarPinned);

  // 打开 Cmd+K 面板：自动退出区间浏览模式并收起侧边栏，避免两个悬浮面板叠加
  useEffect(() => {
    if (!paletteOpen) return;
    setRangeDocs([]);
    setRangeLabel(null);
    setSidebarPinned(false);
    setSidebarOpen(false);
  }, [paletteOpen]);

  // Global shortcuts
  useGlobalShortcuts(
    paletteOpen, setPaletteOpen,
    sidebarOpen, setSidebarOpen, sidebarPinned, setSidebarPinned,
    panelOpen, setPanelOpen,
    toggleFocusMode,
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
  const headerBg = activeTheme === 'night' ? 'rgba(13, 20, 36, 0.38)' : 'rgba(255, 255, 255, 0.48)';

  const handleExportContent = useCallback(() => {
    return decodeEmptyLines(text);
  }, [text]);

  // === Document navigation helper ===
  // 成功切换返回目标日期字符串；失败（文件不存在）返回 null
  const switchToDocument = useCallback(async (date: string, searchText?: string): Promise<{ date: string | null }> => {
    const filename = `${date}.md`;
    if (filename === currentFilename) return { date };
    const rawCurrent = decodeEmptyLines(text);
    if (rawCurrent !== lastSavedContent.current && currentFilename) {
      await invoke('save_document', { content: rawCurrent, currentFilename });
    }
    try {
      const content = await invoke<string>('load_document', { filename });
      const encoded = encodeEmptyLines(content);
      if (editor) applyEncodedContent(editor, encoded);
      setCurrentFilename(filename);
      setText(encoded);
      lastSavedContent.current = content;
      updateDocTags(filename, content);
      setTagsRev(n => n + 1);
      return { date };
    } catch {
      // 目标日期文件不存在：回退到"今天"新建流程（仅重置状态，由调用方决定提示）
      setTargetSearchText(searchText ?? null);
      return { date: null };
    }
  }, [currentFilename, text, editor]);

  const loadDocument = useCallback((content: string, filename: string, targetSearchText?: string) => {
    const encoded = encodeEmptyLines(content);
    if (editor) applyEncodedContent(editor, encoded);
    setCurrentFilename(filename);
    setText(encoded);
    lastSavedContent.current = content;
    updateDocTags(filename, content);
    setTagsRev(n => n + 1);
    return { targetSearchText };
  }, [editor]);

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
      return inRange.length > 0 ? inRange[inRange.length - 1].slice(0, 10) : null;
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
        setRangeDocs(merged);
        setToast(merged.length > 0
          ? `正在浏览 ${start} – ${end}，共 ${merged.length} 天`
          : `${start} – ${end} 暂无记录`);
      } catch (err) {
        console.error('加载区间日记失败:', err);
        setToast('加载失败');
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
        setToast(date ? `已穿梭至 ${date}` : `${target} 加载失败，已切换到今天`);
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
      let target: string;
      if (preset === 'yesterday') {
        const yKey = yesterdayKey();
        target = (await jumpToRange(yKey, yKey)) ?? yKey;
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
        target = (await jumpToRange(startKey, todayK)) ?? startKey;
      }

      const { date } = await switchToDocument(target);
      if (date) {
        setToast(`已穿梭至 ${date}`);
      } else {
        setToast(`${target} 暂无记录，已切换到今天`);
      }
    } catch (err) {
      console.error('时间穿梭失败:', err);
      setToast('穿梭失败');
    }
  }, [jumpToRange, switchToDocument, setToast]);

  return (
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
      {isTyping && (
        <style>{`
          * { cursor: none !important; }
          .ProseMirror { caret-color: rgba(75, 85, 99, 1) !important; }
        `}</style>
      )}

      {/* Stars background */}
      <div
        className="fixed inset-0 pointer-events-none transition-opacity duration-1000 z-0"
        style={{ opacity: activeTheme === 'night' ? 1 : 0 }}
      >
        <div className="star-layer star-layer-1"></div>
        <div className="star-layer star-layer-2"></div>
        <div className="star-layer star-layer-3"></div>
        <style>{`
          .star-layer {
            position: absolute; top: 0; left: 0; background: transparent; border-radius: 50%;
          }
          .star-layer-1 {
            width: 1px; height: 1px;
            box-shadow: 12vw 23vh rgba(255,255,255,0.8), 45vw 67vh rgba(255,255,255,0.8), 82vw 14vh rgba(255,255,255,0.8), 22vw 83vh rgba(255,255,255,0.8), 64vw 35vh rgba(255,255,255,0.8), 91vw 92vh rgba(255,255,255,0.8), 53vw 54vh rgba(255,255,255,0.8), 77vw 81vh rgba(255,255,255,0.8), 8vw 9vw rgba(255,255,255,0.8), 34vw 45vh rgba(255,255,255,0.8);
            animation: twinkle 4s infinite alternate;
          }
          .star-layer-2 {
            width: 1.5px; height: 1.5px;
            box-shadow: 17vw 18vh rgba(255,255,255,0.7), 38vw 72vh rgba(255,255,255,0.7), 71vw 28vh rgba(255,255,255,0.7), 28vw 88vh rgba(255,255,255,0.7), 61vw 48vh rgba(255,255,255,0.7), 88vw 83vh rgba(255,255,255,0.7), 6vw 53vh rgba(255,255,255,0.7), 48vw 8vw rgba(255,255,255,0.7), 96vw 42vh rgba(255,255,255,0.7), 32vw 95vh rgba(255,255,255,0.7), 10vw 60vh rgba(255,255,255,0.7), 80vw 60vh rgba(255,255,255,0.7);
            animation: twinkle 3s infinite alternate 1.5s;
          }
          .star-layer-3 {
            width: 2px; height: 2px;
            box-shadow: 33vw 35vh rgba(255,255,255,0.6), 68vw 62vh rgba(255,255,255,0.6), 55vw 94vh rgba(255,255,255,0.6), 13vw 86vh rgba(255,255,255,0.6), 84vw 38vh rgba(255,255,255,0.6), 42vw 15vh rgba(255,255,255,0.6), 90vw 20vh rgba(255,255,255,0.6);
            animation: twinkle 5s infinite alternate 2.5s;
          }
          @keyframes twinkle {
            0% { opacity: 0.2; transform: scale(0.8); }
            100% { opacity: 1; transform: scale(1.2); }
          }
        `}</style>
      </div>

      {/* Settings button */}
      <button
        ref={panelBtnRef}
        onClick={() => setPanelOpen(prev => !prev)}
        className="fixed bottom-6 right-6 z-30 transition-all duration-300 ease-in-out hover:opacity-100"
        style={{
          opacity: isIdle ? 0.35 : 0,
          pointerEvents: isIdle ? 'auto' : 'none',
          color: themeConfig.text,
          background: 'none', border: 'none', cursor: 'pointer', padding: '8px',
        }}
        title="氛围设置 (⌘⇧M)"
      >
        <SlidersHorizontal size={14} strokeWidth={1} />
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
        className="fixed bottom-6 left-0 right-0 z-30 pointer-events-none flex justify-center"
        style={{
          paddingLeft: sidebarOpen ? '320px' : '0px',
          transition: 'padding-left 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div
          className="select-none flex items-center text-[10px] tracking-[0.2em] transition-all duration-300 ease-in-out"
          style={{ opacity: isIdle ? 0.35 : 0, color: themeConfig.text }}
        >
          <span>{charCount} 字</span>
        </div>
      </div>

      {/* Header */}
      <div
        className={`fixed top-0 left-0 right-0 z-40 flex flex-col items-center pt-5 pb-4 backdrop-blur-md transition-all duration-300 ease-in-out ${
          (isIdle && !sidebarOpen) ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{ backgroundColor: headerBg }}
      >
        <button
          type="button"
          className="absolute top-5 left-4 transition-all duration-300 ease-in-out"
          style={{
            opacity: 0.25,
            color: themeConfig.text,
            pointerEvents: currentFilename ? 'auto' : 'none',
          }}
          onClick={() => {
            setPaletteOpen(false);
            setSidebarOpen(true);
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.7'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.25'; }}
          title="查看标签汇总 (Cmd/Ctrl + L)"
        >
          <Columns size={16} strokeWidth={1.5} />
        </button>
        <div
          className="transition-all duration-300 ease-in-out select-none font-semibold"
          style={{
            opacity: 0.65,
            color: themeConfig.muted,
            fontSize: '13px',
            letterSpacing: '0.25em',
          }}
        >
          SILENS
        </div>
      </div>

      {/* Main canvas */}
      <div
        className="h-full"
        onClick={() => {
          // 点击主页面：退出区间浏览模式 + 收起未固定侧边栏
          if (rangeLabel !== null || sidebarOpen) {
            setRangeDocs([]);
            setRangeLabel(null);
            setSidebarPinned(false);
            if (!sidebarPinned) setSidebarOpen(false);
          }
        }}
      >
        <Canvas
          theme={activeTheme}
          uiVisible={isIdle}
          isSidebarOpen={sidebarOpen}
          onTyping={handleTyping}
          onMouseMove={() => {}}
          onChange={setText}
          onEditorReady={setEditor}
          isFocusMode={isFocusMode}
          knownTags={knownTags}
          targetSearchText={targetSearchText}
          onConsumedTargetSearchText={() => setTargetSearchText(null)}
          charCount={charCount}
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
          setTargetSearchText(searchText);
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
        onLoadDocument={(content, filename, targetSearchText) => {
          loadDocument(content, filename, targetSearchText);
          setTargetSearchText(targetSearchText ?? null);
        }}
      />

      {/* Timeline sidebar */}
      <div style={{ pointerEvents: isTyping ? 'none' : 'auto' }}>
        <TimelineSidebar
          isOpen={sidebarOpen}
          setIsOpen={setSidebarOpen}
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
          rangeLabel={rangeLabel}
          onClearRange={() => { setRangeDocs([]); setRangeLabel(null); setSidebarPinned(false); }}
          onSelectResult={async (date, searchText) => {
            await switchToDocument(date, searchText);
            setTargetSearchText(searchText);
            setRangeDocs([]);
            setRangeLabel(null);
            setSidebarPinned(false);
            if (!sidebarPinned) setSidebarOpen(false);
          }}
          onDateClick={async (date) => {
            setRangeDocs([]);
            setRangeLabel(null);
            const filename = `${date}.md`;
            if (filename === currentFilename) {
              if (!sidebarPinned) setSidebarOpen(false);
              return;
            }
            const rawCurrent = decodeEmptyLines(text);
            if (rawCurrent !== lastSavedContent.current && currentFilename) {
              await invoke('save_document', { content: rawCurrent, currentFilename });
            }
            try {
              const content = await invoke<string>('load_document', { filename });
              const encoded = encodeEmptyLines(content);
              if (editor) applyEncodedContent(editor, encoded);
              setCurrentFilename(filename);
              setText(encoded);
              lastSavedContent.current = content;
              updateDocTags(filename, content);
              setTagsRev(n => n + 1);
              if (!sidebarPinned) setSidebarOpen(false);
              setToast(`已穿梭至 ${date}`);
            } catch (err) {
              console.error('Failed to switch document:', err);
              setToast(`加载失败，该天可能没有记录`);
            }
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
      />

      {/* Export dialog */}
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        theme={activeTheme as Theme}
        themeConfig={themeConfig}
        exportContent={handleExportContent}
        filename={currentFilename ?? ''}
      />

      {/* Toast */}
      {toast && (
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
          className="fixed bottom-6 left-6 z-[180] text-[10px] tracking-widest select-none pointer-events-none transition-all duration-300 ease-in-out"
          style={{
            color: themeConfig.muted,
            opacity: isIdle ? 0.35 : 0,
          }}
        >
          一期一会已开启 {focusTimeLeft !== null && focusTimeLeft > 0
            ? `· ${Math.floor(focusTimeLeft / 60).toString().padStart(2, '0')}:${(focusTimeLeft % 60).toString().padStart(2, '0')}`
            : ''}
        </div>
      )}
    </div>
  );
}
