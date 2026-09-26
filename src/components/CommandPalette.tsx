import React, { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Search } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
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
          <span key={i} className="text-gray-900 font-medium bg-gray-200/40 px-0.5 rounded-sm">{part}</span>
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

  // 零状态：时光穿梭快捷选项（查询为空时渲染，键盘可导航，回车触发）
  const QUICK_JUMP_ACTIONS = [
    { id: 'yesterday', icon: '📅', label: '跳转到昨天', action: () => onQuickJump?.('yesterday') },
    { id: 'this-week', icon: '🗓️', label: '查看本周', action: () => onQuickJump?.('this-week') },
    { id: 'this-month', icon: '🈷️', label: '查看本月', action: () => onQuickJump?.('this-month') },
    {
      id: 'custom-range',
      icon: '🔍',
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
      // 微小延时确保动画渲染后焦点正常获取
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // 2. 防抖搜索与 IPC 调用
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        // 调用 Tauri 后端的 search_notes (待后端实现)
        const res = await invoke<SearchResult[]>('search_notes', { query: query.trim() });
        setResults(res || []);
        setSelectedIndex(0);
      } catch (err) {
        console.error('Search error:', err);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300); // 300ms 防抖

    return () => clearTimeout(timer);
  }, [query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setQuery('');
        setSelectedIndex(0);
        setCustomMode(false);
        onOpenChange(false);
        return;
      }

      // 零状态：查询为空时时光穿梭列表优先接管键盘
      if (!query.trim()) {
        // 自定义日期模式：仅手动"穿梭 →"触发，Esc 退出
        if (customMode) {
          if (e.key === 'Escape') {
            e.preventDefault();
            setCustomMode(false);
            setQuery('');
            onOpenChange(false);
          }
          return;
        }
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
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setQuery('');
            onOpenChange(false);
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

  // 自定义区间：仅手动"穿梭 →"按钮触发；面板保留显示回执后 1.2s 自动关闭
  useEffect(() => {
    if (!customMode || !submitted) return;
    const timer = setTimeout(() => onOpenChange(false), 1200);
    return () => clearTimeout(timer);
  }, [customMode, submitted, onOpenChange]);

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
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] bg-black/5 backdrop-blur-[2px]"
            onClick={() => onOpenChange(false)}
          >
            {/* 悬浮 Spotlight 容器 */}
            <motion.div
              initial={{ opacity: 0, y: -15, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[640px] rounded-2xl bg-white/90 backdrop-blur-xl border border-black/5 shadow-[0_0_0_1px_rgba(0,0,0,0.03),0_30px_60px_rgba(0,0,0,0.12)] overflow-hidden flex flex-col"
            >
              {/* 顶部纯粹输入框 */}
              <div className="flex items-center px-4">
                <Search size={20} className="text-gray-400 shrink-0 mr-3" strokeWidth={2} />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
                  onKeyDown={handleKeyDown}
                  placeholder="搜索笔记与灵感..."
                  className="w-full h-16 text-lg bg-transparent border-none focus:outline-none focus:ring-0 text-gray-800 placeholder-gray-400"
                  spellCheck={false}
                />
              </div>

            {/* 零状态：时光穿梭快捷选项（输入为空时渲染，输入任意字符即卸载） */}
            {query.trim() === '' ? (
              <div className="border-t border-gray-100/60 flex h-[50vh]">
                {customMode ? (
                  /* 自定义日期区间输入 */
                  <div className="w-full flex flex-col items-center justify-center gap-4">
                    <div className="text-[10px] font-mono tracking-widest text-gray-400 uppercase">自定义日期</div>
                    <div className="flex items-center gap-4">
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
                  <div ref={listRef} className="w-[40%] overflow-y-auto p-2 custom-scrollbar flex flex-col border-r border-gray-100/50">
                    {QUICK_JUMP_ACTIONS.map((item, idx) => (
                      <div
                        key={item.id}
                        onClick={() => {
                          item.action();
                          if (item.id !== 'custom-range') onOpenChange(false);
                        }}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={`px-4 py-3 rounded-xl cursor-pointer flex flex-col gap-1.5 transition-colors duration-150 ${
                          idx === selectedIndex ? 'bg-gray-100/70' : 'hover:bg-gray-50/40'
                        }`}
                      >
                        <div className="text-[10px] font-mono tracking-widest text-gray-400 uppercase">
                          时光穿梭
                        </div>
                        <div className="text-[13px] text-gray-700 leading-relaxed line-clamp-2">
                          <span className="mr-2 opacity-60">{item.icon}</span>{item.label}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {/* 右侧留白区：与结果态透视卡片同尺寸占位 */}
                <div className="w-[60%] bg-gray-50/30" />
              </div>
            ) : (
            <div className="border-t border-gray-100/60 flex h-[50vh]">
              {results.length > 0 ? (
                <>
                  {/* 左侧：列表区 (占 40%) */}
                  <div ref={listRef} className="w-[40%] overflow-y-auto p-2 custom-scrollbar flex flex-col border-r border-gray-100/50">
                    {results.map((res, idx) => (
                      <div
                        key={res.id || idx}
                        onClick={() => {
                          if (onSelectResult) onSelectResult(res.date, query);
                        setQuery('');
                        setResults([]);
                          onOpenChange(false);
                        }}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={`px-4 py-3 rounded-xl cursor-pointer flex flex-col gap-1.5 transition-colors duration-150 ${
                          idx === selectedIndex ? 'bg-gray-100/70' : 'hover:bg-gray-50/40'
                        }`}
                      >
                        <div className="text-[10px] font-mono tracking-widest text-gray-400 uppercase">
                          {res.date}
                        </div>
                        <div className="text-[13px] text-gray-700 leading-relaxed line-clamp-2">
                          <HighlightText text={res.snippet} query={query} />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* 右侧：透视卡片预览区 (占 60%) */}
                  <div className="w-[60%] bg-gray-50/30 overflow-y-auto custom-scrollbar p-8 relative">
                    <AnimatePresence mode="wait">
                      {selectedResult && (
                        <motion.div
                          key={selectedResult.id}
                          initial={{ opacity: 0, filter: 'blur(2px)' }}
                          animate={{ opacity: 1, filter: 'blur(0px)' }}
                          exit={{ opacity: 0, filter: 'blur(2px)', transition: { duration: 0.1 } }}
                          transition={{ duration: 0.2 }}
                          className="h-full flex flex-col"
                        >
                          <div className="text-xs text-gray-400 mb-4 tracking-widest font-mono uppercase">{selectedResult.date}</div>
                          <div className="text-sm leading-[1.8] text-gray-600 whitespace-pre-wrap tracking-[0.01em]">
                            <HighlightText text={selectedResult.context_preview} query={query} />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </>
              ) : (
                <div className="w-full flex items-center justify-center text-[13px] tracking-widest text-gray-400">
                  {isSearching ? '正在潜入暗影索引...' : '未找到相关内容'}
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