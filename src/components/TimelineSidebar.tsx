import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { ThreeSegmentDateInput, type PartialDate, toPartialKey } from './ThreeSegmentDateInput';

export interface DayRecord {
  date: string;
  tags: TagGroup[];
}

export interface TagGroup {
  tag: string;
  blocks: string[];
}

// SQLite 暗影索引区块的类型定义
export interface ShadowBlock {
  id: number;
  date: string;
  content: string;
  raw_markdown: string;
}

// 独立的文本块：长内容截断 + 尾部渐隐
const ExpandableTextBlock: React.FC<{ timeLabel: string | null; textContent: string; onClick?: () => void }> = ({ timeLabel, textContent, onClick }) => {
  const ref = useRef<HTMLParagraphElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setOverflowing(el.scrollHeight > el.clientHeight + 2));
    setOverflowing(el.scrollHeight > el.clientHeight + 2);
    observer.observe(el);
    return () => observer.disconnect();
  }, [textContent]);

  return (
    <p
      ref={ref}
      onClick={onClick}
      title={onClick ? "点击跳转到原文" : undefined}
      className={`text-[13px] leading-[1.8] tracking-[0.01em] whitespace-pre-wrap transition-opacity ${onClick ? 'cursor-pointer hover:opacity-70' : ''} ${overflowing ? 'line-clamp-5' : ''}`}
      style={{
        color: 'var(--theme-text)',
        ...(overflowing ? {
          maskImage: 'linear-gradient(to bottom, black 60%, transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent)',
        } : undefined),
      }}
    >
      {timeLabel && (
        <span className="inline-block text-[10px] font-mono mr-3 align-baseline tracking-wide" style={{ color: 'var(--theme-text)', opacity: 0.4 }}>
          <span className="inline-block w-1 h-1 rounded-full mr-1.5 align-middle relative -top-[1px]" style={{ backgroundColor: 'var(--theme-text)', opacity: 0.4 }}></span>
          {timeLabel}
        </span>
      )}
      {textContent}
    </p>
  );
};

// 测量子组件：用于向虚拟列表汇报自身动态高度
const MeasureItem: React.FC<{ index: number; onMeasure: (idx: number, h: number) => void; children: React.ReactNode }> = ({ index, onMeasure, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(entries => {
      if (entries[0]) {
        onMeasure(index, entries[0].borderBoxSize?.[0]?.blockSize ?? entries[0].contentRect.height);
      }
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [index, onMeasure]);
  return <div ref={ref}>{children}</div>;
};

// 标签透视视图：搭载动态高度虚拟滚动 (Variable-height Virtualizer) 和极简时间刻度 (Scrubber)
const TagPerspectiveView: React.FC<{ tag: string; onBlockClick?: (text: string) => void; onDateClick?: (date: string) => void; onSelectResult?: (date: string, searchText: string) => void }> = ({ tag, onBlockClick, onDateClick, onSelectResult }) => {
  const [blocks, setBlocks] = useState<ShadowBlock[]>([]);
  const [heights, setHeights] = useState<Record<number, number>>({});
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke('query_blocks_by_tag', { tag }).then(res => setBlocks(res as ShadowBlock[]));
  }, [tag]);

  useEffect(() => {
    if (containerRef.current) setViewportHeight(containerRef.current.clientHeight);
    const observer = new ResizeObserver(entries => {
      if (entries[0]) setViewportHeight(entries[0].contentRect.height);
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, []);

  const onMeasure = useCallback((index: number, height: number) => {
    setHeights(prev => (prev[index] === height ? prev : { ...prev, [index]: height }));
  }, []);

  const defaultHeight = 100;
  const getTop = (index: number) => {
    let top = 0;
    for (let i = 0; i < index; i++) top += heights[i] || defaultHeight;
    return top;
  };

  const totalHeight = getTop(blocks.length);

  // 计算可视区域（支持 Overscan 缓冲）
  let startIndex = 0;
  let currentTop = 0;
  while (currentTop < scrollTop && startIndex < blocks.length) {
    currentTop += heights[startIndex] || defaultHeight;
    startIndex++;
  }
  const originalStartIndex = startIndex; // 记录真实的视口顶部元素索引
  startIndex = Math.max(0, startIndex - 4);
  const endIndex = Math.min(blocks.length, startIndex + Math.ceil(viewportHeight / defaultHeight) + 12);

  const paddingTop = getTop(startIndex);
  const paddingBottom = Math.max(0, totalHeight - getTop(endIndex));
  const visibleBlocks = blocks.slice(startIndex, endIndex);

  // 计算当前滚动所处的年份/月份以供 Scrubber 使用
  const activeBlockIndex = Math.min(Math.max(0, blocks.length - 1), originalStartIndex);
  const activeBlock = blocks[activeBlockIndex];
  const activeYearMonth = activeBlock ? activeBlock.date.substring(0, 7).replace('-', '.') : '';
  const scrollPercent = totalHeight > viewportHeight ? scrollTop / (totalHeight - viewportHeight) : 0;

  // 手势拖拽穿梭控制逻辑
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    if (totalHeight <= viewportHeight) return;

    setIsDragging(true);
    const track = trackRef.current;
    const container = containerRef.current;
    if (!track || !container) return;

    const updateScroll = (clientY: number) => {
      const rect = track.getBoundingClientRect();
      let p = (clientY - rect.top) / rect.height;
      p = Math.max(0, Math.min(1, p)); // 限制在 0 - 1 之间
      const targetScroll = p * (totalHeight - viewportHeight);
      container.scrollTop = targetScroll;
      setScrollTop(targetScroll);
    };

    updateScroll(e.clientY); // 支持点击轨道任意位置瞬间跳转

    const onPointerMove = (ev: PointerEvent) => updateScroll(ev.clientY);
    const onPointerUp = () => {
      setIsDragging(false);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }, [totalHeight, viewportHeight]);

  return (
    <div
      className={`absolute inset-0 overflow-y-auto pl-8 pr-16 pb-24 custom-scrollbar timeline-scroll-container ${isScrolling ? 'is-scrolling' : 'is-idle'}`}
      onScroll={(e) => {
        setScrollTop(e.currentTarget.scrollTop);
        setIsScrolling(true);
        if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = setTimeout(() => setIsScrolling(false), 800);
      }}
      ref={containerRef}
    >
      <div style={{ paddingTop, paddingBottom }}>
        {visibleBlocks.map((block, i) => {
          const actualIndex = startIndex + i;
          return (
            <MeasureItem key={block.id} index={actualIndex} onMeasure={onMeasure}>
              <div className="mb-10 group">
                <div 
                  className="text-[10px] font-mono tracking-widest opacity-30 mb-3 uppercase flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity w-fit"
                  onClick={() => onDateClick?.(block.date)}
                  title="点击跳转到该天的日记"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-current opacity-50" />
                  {block.date}
                </div>
                <ExpandableTextBlock
                  textContent={block.content}
                  timeLabel={null}
                  onClick={() => {
                    const firstLine = block.content.split('\n')[0].trim();
                    const searchText = firstLine ? firstLine : `#${tag}`;
                    if (onSelectResult) {
                      onSelectResult(block.date, searchText);
                    } else {
                      onBlockClick?.(searchText);
                    }
                  }}
                />
              </div>
            </MeasureItem>
          );
        })}
      </div>

      {/* 极简时间定位器 (Scrubber) */}
      {blocks.length > 0 && (
        <div 
          ref={trackRef}
          onPointerDown={handlePointerDown}
          className="fixed right-3 top-1/2 -translate-y-1/2 h-[50vh] w-6 cursor-ns-resize flex flex-col items-center z-50 touch-none group"
        >
          <div className="absolute inset-y-0 w-[2px] rounded-full transition-opacity duration-300" style={{ backgroundColor: 'var(--theme-muted)', opacity: isDragging ? 0.3 : 0.15 }} />
          <div
            className="absolute w-1.5 h-8 rounded-full transition-all duration-100 ease-out"
            style={{
              backgroundColor: 'var(--theme-muted)',
              top: `${Math.min(100, Math.max(0, scrollPercent * 100))}%`,
              transform: 'translateY(-50%)',
              width: isDragging ? '8px' : '6px',
              opacity: isDragging ? 1 : 0.6,
            }}
          />
          <div
            className={`absolute right-7 transition-all duration-300 ease-out whitespace-nowrap bg-white/80 dark:bg-gray-900/80 backdrop-blur-md px-2 py-1 rounded-md shadow-[0_2px_8px_rgba(0,0,0,0.05)] border border-black/[0.03] dark:border-white/[0.05] text-[10px] font-mono tracking-wider text-gray-400 origin-right ${isDragging ? 'opacity-100 scale-110' : isScrolling ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none group-hover:opacity-100 group-hover:scale-100'}`}
            style={{
              top: `${Math.min(100, Math.max(0, scrollPercent * 100))}%`,
              transform: 'translateY(-50%)'
            }}
          >
            {activeYearMonth}
          </div>
        </div>
      )}
    </div>
  );
};

export interface BrowseRange {
  start?: string;
  end?: string;
}

export const TimelineSidebar: React.FC<{
  isOpen: boolean;
  setIsOpen: (o: boolean) => void;
  tagsRev: number;
  onBlockClick?: (text: string) => void;
  onDateClick?: (date: string) => void;
  onSelectResult?: (date: string, searchText: string) => void;
  onJumpTime?: (preset?: 'yesterday' | 'this-week' | 'this-month', customRange?: { start?: string; end?: string }) => void;
  rangeDocs?: { date: string; content: string }[];
  rangeLabel?: string | null;
  onClearRange?: () => void;
  theme: string;
  externalForceTag?: string | null;
  onClearForceTag?: () => void;
  isPaletteOpen?: boolean;
  onPinDate?: (date: string) => void;
}> = ({ isOpen, setIsOpen, tagsRev, onBlockClick, onDateClick, onSelectResult, onJumpTime, rangeDocs, rangeLabel, onClearRange, theme, externalForceTag, onClearForceTag, isPaletteOpen, onPinDate }) => {
  const [records, setRecords] = useState<DayRecord[]>([]);
  const [viewMode, setViewMode] = useState<'timeline' | 'tag' | 'all-tags'>('timeline');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const [showJumpPopover, setShowJumpPopover] = useState(false);
  const [customJumpMode, setCustomJumpMode] = useState(false);

  // 进入自定义区间模式时，起/止默认今天（用户只改要改的那一段）
  const enterCustomJumpMode = () => {
    const now = new Date();
    const today = {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
    };
    setCustomStart({ ...today });
    setCustomEnd({ ...today });
    setCustomJumpMode(true);
  };

  const [customStart, setCustomStart] = useState<PartialDate>({});
  const [customEnd, setCustomEnd] = useState<PartialDate>({});

  const startHasAny = customStart.year || customStart.month || customStart.day;
  const endHasAny = customEnd.year || customEnd.month || customEnd.day;

  // 区间日记浏览模式：rangeDocs / rangeLabel 有值即激活（即使 rangeDocs 为空也展示"暂无记录"占位）
  const inRangeMode = rangeLabel != null;
  const closeRangeMode = useCallback(() => { onClearRange?.(); }, [onClearRange]);

  const jumpPopoverRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 点击外部区域时关闭 Popover
  useEffect(() => {
    if (!showJumpPopover) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (jumpPopoverRef.current && !jumpPopoverRef.current.contains(e.target as Node)) {
        setShowJumpPopover(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showJumpPopover]);

  // 双边选齐（任意一边有至少一个字段）→ 通知 App 加载区间日记流（朋友圈式时间流）；单边 → 定位该侧最新日记
  // 使用 PartialDate 比较：任意字段（年/月/日）被填上即触发，避免"只改月份"时 原生 date input value 为空导致 UI 无响应
  const startKey = startHasAny ? toPartialKey(customStart) : undefined;
  const endKey = endHasAny ? toPartialKey(customEnd) : undefined;
  useEffect(() => {
    if (!customJumpMode || !(startKey && endKey)) return;
    onJumpTime?.(undefined, { start: startKey, end: endKey });
    setShowJumpPopover(false);
    setCustomJumpMode(false);
    setCustomStart({});
    setCustomEnd({});
  }, [customJumpMode, startKey, endKey, onJumpTime]);

  // 打开侧边栏时清空自定义区间子状态
  useEffect(() => {
    if (isOpen) {
      setCustomJumpMode(false);
      setCustomStart({});
      setCustomEnd({});
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, []);

  // 获取数据
  const getTimelineData = useCallback(async () => {
    try {
      const data = await invoke('get_timeline_data') as DayRecord[];
      setRecords(data);
    } catch (err) {
      console.error('Tauri IPC Error:', err);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      getTimelineData();
    }
  }, [isOpen, tagsRev, getTimelineData]);

  useEffect(() => {
    if (externalForceTag) {
      setActiveTag(externalForceTag);
      setViewMode('tag');
      onClearForceTag?.();
    }
  }, [externalForceTag, onClearForceTag]);

  // 全局标签使用频率统计
  const tagFrequencies = useMemo(() => {
    const freqs: Record<string, number> = {};
    records.forEach(r => {
      r.tags?.forEach(tg => {
        freqs[tg.tag] = (freqs[tg.tag] || 0) + tg.blocks.length;
      });
    });
    return Object.entries(freqs).sort((a, b) => b[1] - a[1]);
  }, [records]);

  return (
    <div
      className={`fixed top-0 left-0 h-full z-[9999] transition-all duration-300 ${isOpen ? 'w-80' : 'w-4'}`}
      onMouseEnter={() => !isPaletteOpen && !isOpen && setIsOpen(true)}
      onMouseLeave={() => { if (isOpen && !inRangeMode) setIsOpen(false); }}
    >
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ x: '-100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '-100%', opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="h-full w-full backdrop-blur-xl shadow-[10px_0_40px_rgba(0,0,0,0.04)] dark:shadow-[10px_0_40px_rgba(0,0,0,0.15)] flex flex-col pt-20 border-r"
            style={{
              backgroundColor: theme === 'night' ? 'rgba(13, 20, 36, 0.85)' : theme === 'paper' ? 'rgba(244, 234, 213, 0.85)' : 'rgba(255, 255, 255, 0.85)',
              borderColor: theme === 'night' ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)',
              transition: 'background-color 0.8s ease, border-color 0.8s ease'
            }}
          >
            {/* 顶部控制区：两个幽灵态模式切换指示器 */}
            <div
              className="flex items-center justify-between px-8 pt-4 pb-2 select-none shrink-0 cursor-pointer transition-opacity hover:opacity-80"
              onClick={() => setViewMode('timeline')}
            >
              {/* 左侧：时间轴模式 —— 极细竖线 + 小圆点（点击弹出极简时间穿梭菜单） */}
              <div
                ref={jumpPopoverRef}
                className="relative flex items-center gap-1.5"
                style={{ opacity: viewMode === 'timeline' ? 0.4 : 0.15 }}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowJumpPopover((v) => !v);
                }}
              >
                <div
                  className="w-[1px] h-3"
                  style={{ backgroundColor: 'var(--theme-text)' }}
                />
                <div
                  className="w-1 h-1 rounded-full"
                  style={{ backgroundColor: 'var(--theme-text)' }}
                />
                {/* 极简毛玻璃 Popover */}
                <AnimatePresence>
                  {showJumpPopover && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.15, ease: 'easeOut' }}
                      className="absolute left-0 top-full mt-1 z-50 rounded-md bg-[#2f3441]/5 backdrop-blur-md p-1"
                    >
                      {customJumpMode ? (
                        <div className="flex flex-col gap-1.5 px-1 py-1">
                          <div className="flex items-center gap-2">
                            <ThreeSegmentDateInput
                              value={customStart}
                              onChange={(v) => setCustomStart(v)}
                              size="sm"
                              theme="var"
                              label="起"
                            />
                            <span className="text-[9px] opacity-30" style={{ color: 'var(--theme-text)' }}>–</span>
                            <ThreeSegmentDateInput
                              value={customEnd}
                              onChange={(v) => setCustomEnd(v)}
                              size="sm"
                              theme="var"
                              label="止"
                            />
                          </div>
                          <button
                            onClick={() => {
                              if (startKey || endKey) {
                                onJumpTime?.(undefined, { start: startKey, end: endKey });
                                setShowJumpPopover(false);
                                setCustomJumpMode(false);
                                setCustomStart({});
                                setCustomEnd({});
                              }
                            }}
                            disabled={!startHasAny && !endHasAny}
                            className="block w-full text-left px-2.5 py-1 text-xs font-mono whitespace-nowrap opacity-80 hover:opacity-100 disabled:opacity-20 transition-opacity"
                            style={{ color: 'var(--theme-text)' }}
                          >
                            穿梭 →
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onJumpTime?.('this-week');
                              setShowJumpPopover(false);
                            }}
                            className="block w-full text-left px-2.5 py-1 text-xs font-mono whitespace-nowrap opacity-60 hover:opacity-100 transition-opacity"
                            style={{ color: 'var(--theme-text)' }}
                          >
                            本周
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onJumpTime?.('this-month');
                              setShowJumpPopover(false);
                            }}
                            className="block w-full text-left px-2.5 py-1 text-xs font-mono whitespace-nowrap opacity-60 hover:opacity-100 transition-opacity"
                            style={{ color: 'var(--theme-text)' }}
                          >
                            本月
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              enterCustomJumpMode();
                            }}
                            className="block w-full text-left px-2.5 py-1 text-xs font-mono whitespace-nowrap opacity-60 hover:opacity-100 transition-opacity"
                            style={{ color: 'var(--theme-text)' }}
                          >
                            自定
                          </button>
                        </>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {/* 右侧：标签云模式 —— 极小的 # 符号 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setViewMode('all-tags');
                }}
                className="text-[11px] font-mono transition-opacity"
                style={{ color: 'var(--theme-text)', opacity: viewMode === 'timeline' ? 0.15 : 0.5 }}
              >
                #
              </button>
            </div>

            {/* 动态透视容器：时间轴 vs 标签透视 */}
            <div className="flex-1 relative w-full h-full overflow-hidden">
              <AnimatePresence mode="wait">
                {viewMode === 'timeline' ? (
                  <motion.div
                    key="timeline"
                    initial={{ opacity: 0, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, filter: 'blur(4px)' }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                    className={`absolute inset-0 overflow-y-auto pl-12 pr-12 pb-24 custom-scrollbar timeline-scroll-container ${isScrolling ? 'is-scrolling' : 'is-idle'}`}
                    onScroll={() => {
                      setIsScrolling(true);
                      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
                      scrollTimerRef.current = setTimeout(() => setIsScrolling(false), 800);
                    }}
                  >
                    {inRangeMode ? (
                      /* 区间日记浏览模式：朋友圈式时间流（数据由 App 加载传入） */
                      <div>
                        <div
                          className="flex items-center gap-2 px-8 pb-3 select-none"
                          style={{ color: 'var(--theme-text)' }}
                        >
                          <div className="text-xs font-mono whitespace-nowrap opacity-50">
                            {rangeLabel}
                          </div>
                          <button
                            onClick={closeRangeMode}
                            className="opacity-40 hover:opacity-100 cursor-pointer transition-opacity"
                            title="退出区间浏览"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M18 6 6 18" />
                              <path d="m6 6 12 12" />
                            </svg>
                          </button>
                        </div>
                        {rangeDocs && rangeDocs.length === 0 ? (
                          <div className="text-[13px] mt-10 px-8 opacity-50" style={{ color: 'var(--theme-text)' }}>
                            正在加载…
                          </div>
                        ) : rangeDocs ? (
                        <div className="relative pl-8 pr-4">
                          {/* 时光辅助线：贯穿竖线，紧贴容器左侧 */}
                          <div
                            className="absolute left-0 top-0 bottom-0 w-[1px]"
                            style={{ backgroundColor: 'var(--theme-text)', opacity: 0.1 }}
                          />
                          {rangeDocs!.map((doc) => (
                            <div key={doc.date} className="relative mb-12 group pl-6">
                              {/* 时间轴圆点：绝对定位，与竖线重合 */}
                              <div
                                className="absolute -left-[30px] top-1.5 w-2 h-2 -translate-x-1/2 rounded-full transition-opacity duration-300 group-hover:opacity-40"
                                style={{ backgroundColor: 'var(--theme-text)', opacity: 0.15 }}
                              />
                              <div
                                onClick={() => onDateClick?.(doc.date)}
                                title="点击跳转到该天的日记"
                                className="text-[10px] font-mono tracking-widest opacity-40 hover:opacity-80 transition-opacity cursor-pointer w-fit"
                                style={{ color: 'var(--theme-text)' }}
                              >
                                {doc.date}
                              </div>
                              <div className="mt-3">
                                <p
                                  onClick={() => onDateClick?.(doc.date)}
                                  title="点击跳转到原文"
                                  className="text-[13px] leading-[1.8] tracking-[0.01em] line-clamp-3 cursor-pointer hover:opacity-70 transition-opacity"
                                  style={{ color: 'var(--theme-text)' }}
                                >
                                  {doc.content}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                        ) : null}
                      </div>
                    ) : records.length === 0 ? (
                      <div className="text-sm mt-10" style={{ color: 'var(--theme-muted)' }}>
                        暂无记录...
                      </div>
                    ) : (
                      <div className="relative">
                        {/* 贯穿时光轴 */}
                        <div
                          className="absolute left-6 top-0 bottom-0 w-px"
                          style={{ backgroundColor: 'var(--theme-text)', opacity: 0.1 }}
                        />
                        {records.map((record) => (
                          <div key={record.date} className="relative mb-16 group pl-9">
                            {/* 轴线刻度圆点（居中对齐时光轴） */}
                            <div
                              className="absolute left-6 top-1 w-2 h-2 -translate-x-1/2 rounded-full transition-opacity duration-300 group-hover:opacity-40"
                              style={{ backgroundColor: 'var(--theme-text)', opacity: 0.15 }}
                            />
                            {/* 块级图钉操作 */}
                            {onPinDate && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onPinDate(record.date);
                                }}
                                title="图钉"
                                className="absolute right-0 top-0 p-1.5 opacity-0 group-hover:opacity-30 hover:opacity-80 transition-opacity duration-300"
                                style={{ color: 'var(--theme-text)' }}
                              >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M12 17v5" />
                                  <path d="M9 10.76V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4.76a2 2 0 0 0 .59 1.41l1.7 1.7A1 1 0 0 1 17.6 15H6.4a1 1 0 0 1-.7-1.7l1.7-1.7A2 2 0 0 0 8 10.76Z" />
                                </svg>
                              </button>
                            )}
                            {/* 时间戳标记 */}
                            <div
                              onClick={() => onDateClick?.(record.date)}
                              title="点击跳转到该天的日记"
                              className="text-[10px] font-mono tracking-widest opacity-40 hover:opacity-80 transition-opacity cursor-pointer w-fit"
                              style={{ color: 'var(--theme-text)' }}
                            >
                              {record.date}
                            </div>
                            <div className="mt-5 space-y-6">
                              {(() => {
                                const displayedTags = [...(record.tags || [])];
                                return displayedTags.map(({ tag, blocks }) => {
                                  return (
                                    <div key={tag} className="group mb-8">
                                      <div
                                        onClick={() => { setActiveTag(tag); setViewMode('tag'); }}
                                        className="text-[12px] font-mono font-bold mb-3 tracking-widest cursor-pointer inline-flex items-center gap-1 transition-opacity hover:opacity-70 opacity-60"
                                        style={{ color: 'var(--theme-text)' }}
                                        title={`查看 #${tag} 的全部记录`}
                                      >
                                        #{tag} <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-sans">→</span>
                                      </div>
                                      <div className="space-y-4">
                                        {(() => {
                                          const parsedBlocks = blocks.map((content, originalIndex) => {
                                            const timeMatch = (content || '').match(/^(\d{2}:\d{2})\s*([\s\S]*)/);
                                            return {
                                              content,
                                              timeLabel: timeMatch?.[1] ?? null,
                                              textContent: timeMatch ? timeMatch[2] : content,
                                              originalIndex
                                            };
                                          });

                                          parsedBlocks.sort((a, b) => {
                                            if (a.timeLabel && b.timeLabel) {
                                              const timeCmp = a.timeLabel.localeCompare(b.timeLabel);
                                              if (timeCmp !== 0) return timeCmp;
                                            }
                                            return a.originalIndex - b.originalIndex;
                                          });

                                          return parsedBlocks.map((b) => {
                                            const firstLine = b.content.split('\n')[0].trim();
                                            const searchText = firstLine ? firstLine : `#${tag}`;
                                            return (
                                              <ExpandableTextBlock key={b.originalIndex} timeLabel={b.timeLabel} textContent={b.textContent} onClick={() => {
                                                if (onSelectResult) {
                                                  onSelectResult(record.date, searchText);
                                                } else {
                                                  onBlockClick?.(searchText);
                                                }
                                              }} />
                                            );
                                          });
                                        })()}
                                      </div>
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                ) : viewMode === 'all-tags' ? (
                  <motion.div
                    key="all-tags"
                    initial={{ opacity: 0, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, filter: 'blur(4px)' }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                    className={`absolute inset-0 overflow-y-auto px-8 pb-24 custom-scrollbar timeline-scroll-container ${isScrolling ? 'is-scrolling' : 'is-idle'}`}
                    onScroll={() => {
                      setIsScrolling(true);
                      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
                      scrollTimerRef.current = setTimeout(() => setIsScrolling(false), 800);
                    }}
                  >
                    <div className="flex flex-col mt-2">
                      {tagFrequencies.map(([t, count]) => (
                        <button
                          key={t}
                          onClick={() => { setActiveTag(t); setViewMode('tag'); }}
                          className="group flex items-center justify-between w-full py-3.5 border-b transition-colors hover:bg-black/5 dark:hover:bg-white/5 px-3 -mx-3 rounded-xl"
                          style={{ borderColor: 'rgba(150, 150, 150, 0.06)' }}
                        >
                          <span className="text-[13px] tracking-widest transition-opacity opacity-80 group-hover:opacity-100" style={{ color: 'var(--theme-text)' }}>#{t}</span>
                          <span className="text-[10px] font-mono opacity-30 group-hover:opacity-60 transition-opacity" style={{ color: 'var(--theme-muted)' }}>{count}</span>
                        </button>
                      ))}
                      {tagFrequencies.length === 0 && (
                        <div className="text-sm mt-10 opacity-50" style={{ color: 'var(--theme-muted)' }}>暂无任何标签记录...</div>
                      )}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="tag-perspective"
                    initial={{ opacity: 0, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, filter: 'blur(4px)' }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute inset-0"
                  >
                    {activeTag && (
                      <TagPerspectiveView tag={activeTag} onBlockClick={onBlockClick} onDateClick={onDateClick} onSelectResult={onSelectResult} />
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* 自定义原生滚动条的随动显隐逻辑 */}
      <style>{`
        .timeline-scroll-container::-webkit-scrollbar {
          width: 4px;
        }
        .timeline-scroll-container::-webkit-scrollbar-track {
          background: transparent;
        }
        .timeline-scroll-container::-webkit-scrollbar-thumb {
          border-radius: 4px;
          background: transparent;
        }
        .timeline-scroll-container.is-scrolling::-webkit-scrollbar-thumb,
        .timeline-scroll-container:hover::-webkit-scrollbar-thumb {
          background: rgba(156, 163, 175, 0.3); /* 克制的灰色透明材质 */
        }
      `}</style>
    </div>
  );
};