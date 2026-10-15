import React, { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { Search } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ThreeSegmentDateInput, type PartialDate, toPartialKey } from './ThreeSegmentDateInput';

export interface SearchResult {
  id: string;
  date: string;
  snippet: string;
  context_preview: string;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // 保留原有接口以兼容 App.tsx，后续可在此扩展具体业务逻辑
  editor?: any;
  currentFilename?: string | null;
  onTagManaged?: () => void;
  onSelectResult?: (date: string, searchText: string) => void;
  onQuickJump?: (preset?: 'yesterday' | 'this-week' | 'this-month', customRange?: { start?: string; end?: string }) => void;
  onLoadDocument?: (content: string, filename: string, targetSearchText?: string) => void;
}

// 辅助组件：安全切割文本，将匹配的查询关键词高亮为深色加粗
const HighlightText = ({ text, query }: { text: string; query: string }) => {
  if (!query.trim()) return <>{text}</>;
  // 对搜索词转义，避免正则表达式解析错误
  const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <span key={i} className="font-medium px-0.5 rounded-sm" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-text) 8%, transparent)' }}>{part}</span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
};

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onOpenChange,
  onSelectResult,
  onQuickJump,
}) => {
  const reducedMotion = useReducedMotion();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  // 自定义日期零状态（PartialDate：年/月/日 独立可编辑，任意部分有值即可提交）
  const [customMode, setCustomMode] = useState(false);
  const [customStart, setCustomStart] = useState<PartialDate>({});
  const [customEnd, setCustomEnd] = useState<PartialDate>({});
  const [submitted, setSubmitted] = useState(false);

  // 当前"已部分填写"的判定
  const startHasAny = customStart.year || customStart.month || customStart.day;
  const endHasAny = customEnd.year || customEnd.month || customEnd.day;

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useDialogFocus(open, () => onOpenChange(false), inputRef);

  // 零状态：时光穿梭快捷选项（查询为空时渲染，键盘可导航，回车触发）
  const QUICK_JUMP_ACTIONS = [
    { id: 'yesterday', label: '跳转到昨天', action: () => onQuickJump?.('yesterday') },
    { id: 'this-week', label: '查看本周', action: () => onQuickJump?.('this-week') },
    { id: 'this-month', label: '查看本月', action: () => onQuickJump?.('this-month') },
    {
      id: 'custom-range',
      label: '自定义日期...',
      action: () => {
        // 起/止默认今天，用户只改要改的那一段
        const now = new Date();
        const today: PartialDate = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
        setCustomStart({ ...today });
        setCustomEnd({ ...today });
        setCustomMode(true);
      },
    },
  ];

  // 打开时重置自定义区间子状态
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setCustomMode(false);
      setCustomStart({});
      setCustomEnd({});
      setSubmitted(false);
    }
  }, [open]);

  // 2. 防抖搜索与 IPC 调用
  useEffect(() => {
    setResults([]);
    if (!open || !query.trim()) {
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        // 调用 Tauri 后端的 search_notes (待后端实现)
        const res = await invoke<SearchResult[]>('search_notes', { query: query.trim() });
        if (cancelled) return;
        setResults(res || []);
        setSelectedIndex(0);
      } catch (err) {
        console.error('Search error:', err);
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 300);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;

      // 零状态：查询为空时时光穿梭列表优先接管键盘
      if (!query.trim()) {
        // 自定义日期模式：仅手动"穿梭 →"触发，Esc 退出
        if (customMode) return;
        if (QUICK_JUMP_ACTIONS.length > 0) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex((prev) => (prev + 1) % QUICK_JUMP_ACTIONS.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex((prev) => (prev - 1 + QUICK_JUMP_ACTIONS.length) % QUICK_JUMP_ACTIONS.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const selected = QUICK_JUMP_ACTIONS[selectedIndex];
            if (selected) selected.action();
            if (selected?.id !== 'custom-range') {
              setQuery('');
              onOpenChange(false);
            }
          }
          return;
        }
      }

      if (results.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % results.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = results[selectedIndex];
        if (selected) {
          if (onSelectResult) onSelectResult(selected.date, query);
          setQuery('');
          setResults([]);
          onOpenChange(false);
        }
      }
    },
    [query, results, selectedIndex, onOpenChange, onSelectResult, onQuickJump, customMode]
  );

  // 4. 列表滚动跟随 (Scroll into view)
  useEffect(() => {
    if (listRef.current && results.length > 0) {
      const activeEl = listRef.current.children[selectedIndex] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex, results]);

  const selectedResult = results[selectedIndex] ?? null;

  return (
    <AnimatePresence>
      {open && (
          <motion.div
            key="command-palette-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] bg-black/5 backdrop-blur-[2px]"
            onClick={() => onOpenChange(false)}
          >
            {/* 悬浮 Spotlight 容器 */}
            <motion.div
              initial={{ opacity: 0, y: reducedMotion ? 0 : -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reducedMotion ? 0 : -6 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
              ref={dialogRef}
              role="dialog"
              aria-label="搜索笔记"
              aria-modal="true"
              className="command-palette w-[calc(100%-32px)] rounded-xl border shadow-lg overflow-hidden flex flex-col"
              style={{
                maxWidth: results.length > 0 ? 680 : 460,
                transition: reducedMotion ? 'none' : 'max-width 180ms ease-out',
                backgroundColor: 'var(--theme-bg)',
                borderColor: 'var(--theme-border)',
                color: 'var(--theme-text)',
              }}
            >
              {/* 顶部纯粹输入框 */}
              <div className="flex items-center px-4">
                <Search size={17} className="shrink-0 mr-3 opacity-45" strokeWidth={1.5} />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setResults([]); setSelectedIndex(0); }}
                  onKeyDown={handleKeyDown}
                  placeholder="搜索笔记与灵感..."
                  className="w-full h-[60px] text-[15px] bg-transparent border-none focus:outline-none focus:ring-0 text-inherit placeholder:text-current placeholder:opacity-40"
                  spellCheck={false}
                />
              </div>

            {/* 零状态：时光穿梭快捷选项（输入为空时渲染，输入任意字符即卸载） */}
            {query.trim() === '' ? (
              <div className="border-t" style={{ borderColor: 'var(--theme-border)' }}>
                {customMode ? (
                  /* 自定义日期区间输入 */
                  <div className="w-full flex flex-col items-center justify-center gap-4 px-4 py-6">
                    <div className="text-[10px] font-mono tracking-widest text-gray-400 uppercase">自定义日期</div>
                    <div className="search-date-fields flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-400 font-mono">起</span>
                        <ThreeSegmentDateInput
                          value={customStart}
                          onChange={setCustomStart}
                          size="md"
                          theme="light"
                        />
                      </div>
                      <span className="text-gray-300 text-xs">–</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-400 font-mono">止</span>
                        <ThreeSegmentDateInput
                          value={customEnd}
                          onChange={setCustomEnd}
                          size="md"
                          theme="light"
                        />
                      </div>
                    </div>
                    {submitted ? (
                      <div className="text-[11px] text-gray-400 font-mono tracking-widest uppercase">已提交 →</div>
                    ) : (
                      <div className="flex items-center gap-4">
                        <button
                          onClick={() => {
                            if (startHasAny || endHasAny) {
                              onQuickJump?.(undefined, {
                                start: startHasAny ? toPartialKey(customStart) : undefined,
                                end: endHasAny ? toPartialKey(customEnd) : undefined,
                              });
                              setSubmitted(true);
                            }
                          }}
                          disabled={!startHasAny && !endHasAny}
                          className="text-[11px] text-gray-500 hover:text-gray-800 disabled:opacity-30 transition-colors font-mono tracking-widest"
                        >
                          穿梭 →
                        </button>
                        <button
                          onClick={() => onOpenChange(false)}
                          className="text-[11px] text-gray-400 hover:text-gray-700 transition-colors font-mono tracking-widest"
                        >
                          关闭
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-2">
                    <div className="px-3 pt-2 pb-1 text-[11px] opacity-45">按时间回顾</div>
                    <div ref={listRef} className="flex flex-col">
                      {QUICK_JUMP_ACTIONS.map((item, idx) => (
                        <button
                          type="button"
                          key={item.id}
                          onClick={() => {
                            item.action();
                            if (item.id !== 'custom-range') onOpenChange(false);
                          }}
                          onMouseEnter={() => setSelectedIndex(idx)}
                          className="w-full px-3 py-2.5 rounded-md text-left text-[13px] text-inherit transition-colors duration-150"
                          style={{ backgroundColor: idx === selectedIndex ? 'color-mix(in srgb, var(--theme-text) 5%, transparent)' : 'transparent' }}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
            <div className="border-t flex" style={{ borderColor: 'var(--theme-border)', maxHeight: 'min(50vh, 400px)' }}>
              {results.length > 0 ? (
                <>
                  {/* 左侧：列表区 (占 40%) */}
                  <div ref={listRef} className="search-results-list w-[40%] min-w-0 overflow-y-auto p-2 custom-scrollbar flex flex-col">
                    {results.map((res, idx) => (
                      <button
                        type="button"
                        key={res.id || idx}
                        aria-label={`${res.date} ${res.snippet}`}
                        onClick={() => {
                          if (onSelectResult) onSelectResult(res.date, query);
                          setQuery('');
                          setResults([]);
                          onOpenChange(false);
                        }}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className="w-full shrink-0 px-3 py-3 rounded-md text-left text-inherit flex flex-col gap-1.5 transition-colors duration-150"
                        style={{ backgroundColor: idx === selectedIndex ? 'color-mix(in srgb, var(--theme-text) 5%, transparent)' : 'transparent' }}
                      >
                        <div className="text-[10px] opacity-45">
                          {res.date}
                        </div>
                        <div className="text-[13px] leading-relaxed line-clamp-2">
                          <HighlightText text={res.snippet} query={query} />
                        </div>
                      </button>
                    ))}
                  </div>

                  {selectedResult && (
                    <section
                      aria-label="笔记预览"
                      className="search-preview w-[60%] min-w-0 border-l overflow-y-auto custom-scrollbar p-5"
                      style={{ borderColor: 'var(--theme-border)' }}
                    >
                      <motion.div
                        key={selectedResult.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                      >
                        <div className="text-xs opacity-45 mb-3">{selectedResult.date}</div>
                        <div className="text-sm leading-[1.8] whitespace-pre-wrap break-words opacity-80">
                          <HighlightText text={selectedResult.context_preview} query={query} />
                        </div>
                      </motion.div>
                    </section>
                  )}
                </>
              ) : (
                <div role="status" className="w-full h-[112px] flex items-center justify-center text-[13px] opacity-45">
                  {isSearching ? '正在搜索…' : '未找到相关内容'}
                </div>
              )}
            </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};