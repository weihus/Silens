import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowUpRight, CalendarDays, FilePenLine, Pin, Plus, X } from 'lucide-react';
import type { Document, RecallDay, RecallRange } from '../types';
import { documentDate, withinRange } from '../utils/recall';
import { ArticleCard, RecallTimeline } from './RecallTimeline';
import { displayTitle, documentKind, parseDocument } from '../utils/documents';
import { extractTagsFromText } from '../utils/tags';
import { invoke } from '@tauri-apps/api/core';
import { ThreeSegmentDateInput, type PartialDate, toPartialKey } from './ThreeSegmentDateInput';

// SQLite 暗影索引区块的类型定义
export interface ShadowBlock {
  id: number;
  date: string;
  filename: string;
  title: string;
  kind: 'journal' | 'article';
  content: string;
  raw_markdown: string;
  created: number;
  modified: number;
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
        <span className="inline-block text-xs font-mono mr-3 align-baseline tracking-wide" style={{ color: 'var(--theme-muted)' }}>
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
  return <div ref={ref} className="flow-root">{children}</div>;
};

// 标签透视视图：搭载动态高度虚拟滚动 (Variable-height Virtualizer) 和极简时间刻度 (Scrubber)
const TagPerspectiveView: React.FC<{ tag: string; revision: number; range?: RecallRange | null; onBrowseDate: (date: string) => void; onBlockClick?: (text: string) => void; onDateClick?: (date: string) => void; onSelectResult?: (date: string, searchText: string) => void }> = ({ tag, revision, range, onBrowseDate, onBlockClick, onDateClick, onSelectResult }) => {
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [blocks, setBlocks] = useState<ShadowBlock[]>([]);
  const [heights, setHeights] = useState<Record<number, number>>({});
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    invoke<ShadowBlock[]>('query_blocks_by_tag', { tag, ...(range?.start ? { startDate: range.start } : {}), ...(range?.end ? { endDate: range.end } : {}) }).then(result => {
      if (!active) return;
      const seen = new Set<string>();
      setBlocks(result.filter(block => {
        if (!withinRange(block.date, range)) return false;
        if (block.kind !== 'article') return true;
        const filename = block.filename ?? block.date;
        if (seen.has(filename)) return false;
        seen.add(filename);
        return true;
      }).sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created || a.id - b.id));
      setHeights({});
      setLoading(false);
    }).catch(() => { if (active) { setBlocks([]); setFailed(true); setLoading(false); } });
    return () => { active = false; };
  }, [tag, revision, retry, range?.start, range?.end]);

  useEffect(() => {
    setScrollTop(0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
  }, [tag, range?.start, range?.end]);

  useEffect(() => {
    if (containerRef.current) {
      const style = getComputedStyle(containerRef.current);
      setViewportHeight(containerRef.current.clientHeight - parseFloat(style.paddingTop || '0') - parseFloat(style.paddingBottom || '0'));
    }
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
    <div className="absolute inset-0">
    <div
      className={`recall-tag-scroll h-full overflow-y-auto pl-8 pr-16 pb-24 custom-scrollbar timeline-scroll-container ${isScrolling ? 'is-scrolling' : 'is-idle'}`}
      onScroll={(e) => {
        setScrollTop(e.currentTarget.scrollTop);
        setIsScrolling(true);
        if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = setTimeout(() => setIsScrolling(false), 800);
      }}
      ref={containerRef}
    >
      {(loading || failed || !blocks.length) && (
        <div role="status" className="text-sm py-8" style={{ color: 'var(--theme-muted)' }}>
          {loading ? '正在加载…' : failed ? <button onClick={() => setRetry(n => n + 1)}>读取失败，点击重试</button> : '这个标签下还没有内容'}
        </div>
      )}
      <div style={{ paddingTop, paddingBottom }}>
        {!loading && visibleBlocks.map((block, i) => {
          const actualIndex = startIndex + i;
          return (
            <MeasureItem key={block.id} index={actualIndex} onMeasure={onMeasure}>
              <div className="mb-10 group">
                {(actualIndex === 0 || blocks[actualIndex - 1].date !== block.date) && (
                  <button type="button" onClick={() => onBrowseDate(block.date)} className="quiet-button mb-4 rounded py-1 text-xs font-mono" style={{ color: 'var(--theme-muted)' }}>{block.date}</button>
                )}
                {block.kind === 'article' ? (
                  <ArticleCard article={{ filename: block.filename, title: block.title || '未命名笔记', content: block.content, created: block.created, modified: block.modified, created_date: block.date, tags: extractTagsFromText(block.content) }} onOpen={onDateClick} dateMode="none" />
                ) : <>
                <ExpandableTextBlock
                  textContent={block.content}
                  timeLabel={null}
                  onClick={() => {
                    const firstLine = block.content.split('\n')[0].trim();
                    const searchText = firstLine ? firstLine : `#${tag}`;
                    if (onSelectResult) {
                      onSelectResult(block.filename, searchText);
                    } else {
                      onBlockClick?.(searchText);
                    }
                  }}
                />
                </>}
              </div>
            </MeasureItem>
          );
        })}
      </div>
    </div>
      {activeYearMonth && totalHeight > viewportHeight && (
        <div 
          ref={trackRef}
          onPointerDown={handlePointerDown}
          className="absolute right-0 top-1/2 -translate-y-1/2 h-[50vh] w-6 cursor-ns-resize flex flex-col items-center z-50 touch-none group"
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
            className={`absolute right-7 transition-all duration-300 ease-out whitespace-nowrap px-2 py-1 rounded-md border text-xs font-mono tracking-wider origin-right ${isDragging ? 'opacity-100 scale-110' : isScrolling ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none group-hover:opacity-100 group-hover:scale-100'}`}
            style={{
              top: `${Math.min(100, Math.max(0, scrollPercent * 100))}%`,
              backgroundColor: 'var(--theme-bg)',
              borderColor: 'var(--theme-border)',
              color: 'var(--theme-muted)',
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
  recallRange?: RecallRange | null;
  externalForceTime?: number;
  onNewArticle?: () => void;
  currentFilename?: string | null;
  rangeLabel?: string | null;
  rangeLoading?: boolean;
  rangeError?: string | null;
  onClearRange?: () => void;
  theme: string;
  externalForceTag?: string | null;
  onClearForceTag?: () => void;
  isPaletteOpen?: boolean;
  isPinned?: boolean;
  onTogglePin?: () => void;
}> = ({ isOpen, setIsOpen, tagsRev, onBlockClick, onDateClick, onSelectResult, onJumpTime, rangeLabel, rangeLoading = false, rangeError = null, onClearRange, theme, externalForceTag, onClearForceTag, isPinned = false, onTogglePin, onNewArticle, currentFilename, recallRange, externalForceTime }) => {
  const reduceMotion = useReducedMotion();
  const [records, setRecords] = useState<RecallDay[]>([]);
  const [viewMode, setViewMode] = useState<'timeline' | 'tag' | 'all-tags' | 'articles'>('timeline');
  const [articles, setArticles] = useState<Document[]>([]);
  const [articleSort, setArticleSort] = useState<'created' | 'modified'>('modified');
  const [dataLoading, setDataLoading] = useState(false);
  const [dataFailed, setDataFailed] = useState(false);
  const [retry, setRetry] = useState(0);
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

  const inRangeMode = rangeLabel != null;
  const closeRangeMode = useCallback(() => { onClearRange?.(); }, [onClearRange]);

  const jumpPopoverRef = useRef<HTMLDivElement>(null);
  const dateButtonRef = useRef<HTMLButtonElement>(null);
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

  // 自定义区间只在点击“查看”时提交，避免默认日期触发跳转。
  const startKey = startHasAny ? toPartialKey(customStart) : undefined;
  const endKey = endHasAny ? toPartialKey(customEnd) : undefined;

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

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setDataLoading(true);
    setDataFailed(false);
    Promise.all([invoke<RecallDay[]>('get_timeline_data'), invoke<Document[]>('get_all_documents')])
      .then(([timeline, docs]) => {
        if (!active) return;
        setRecords(timeline);
        setArticles(docs.filter(doc => documentKind(doc.filename) === 'article'));
        setDataLoading(false);
      }).catch(() => { if (active) { setDataFailed(true); setDataLoading(false); } });
    return () => { active = false; };
  }, [isOpen, tagsRev, retry]);

  useEffect(() => {
    if (externalForceTime) setViewMode('timeline');
  }, [externalForceTime]);

  const visibleRecords = useMemo(() => records.filter(day => withinRange(day.date, recallRange)), [records, recallRange]);
  const visibleArticles = useMemo(() => articles.filter(doc => withinRange(documentDate(doc), recallRange))
    .sort((a, b) => b[articleSort] - a[articleSort] || a.filename.localeCompare(b.filename)), [articles, recallRange, articleSort]);
  const selectTag = useCallback((tag: string) => { setActiveTag(tag); setViewMode('tag'); }, []);
  const browseDate = useCallback((date: string) => { onJumpTime?.(undefined, { start: date, end: date }); }, [onJumpTime]);

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
    visibleRecords.forEach(r => {
      r.tags?.forEach(tg => {
        freqs[tg.tag] = (freqs[tg.tag] || 0) + tg.blocks.length;
      });
    });
    visibleArticles.forEach(doc => {
      const tags = doc.tags ?? extractTagsFromText(parseDocument(doc.filename, doc.content).body);
      for (const tag of tags.length ? tags : ['默认']) freqs[tag] = (freqs[tag] || 0) + 1;
    });
    return Object.entries(freqs).sort((a, b) => b[1] - a[1]);
  }, [visibleRecords, visibleArticles]);

  return (
    <div
      className={`timeline-sidebar fixed top-0 left-0 h-full z-[80] ${isOpen ? 'timeline-sidebar-open' : 'w-0'}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          if (showJumpPopover) {
            setShowJumpPopover(false);
            dateButtonRef.current?.focus();
          } else setIsOpen(false);
        }
      }}
    >
      <AnimatePresence>
        {isOpen && (
          <motion.div
            role="complementary"
            aria-label="时间与标签"
            initial={reduceMotion ? false : { x: '-100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: reduceMotion ? 0 : '-100%', opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="h-full w-full flex flex-col pt-8 border-r"
            style={{
              backgroundColor: theme === 'night' ? '#171D1B' : theme === 'paper' ? '#FAF8F5' : '#FFFFFF',
              color: 'var(--theme-text)',
              borderColor: 'var(--theme-border)',
            }}
          >
            <div className="recall-heading">
              <span>回顾</span>
              <div className="flex items-center gap-1">
                {onNewArticle && <button type="button" aria-label="新建篇目" title="新建篇目" className="quiet-button rounded-md p-2" onClick={onNewArticle}><Plus size={16} /></button>}
                {onTogglePin && <button type="button" onClick={onTogglePin} aria-pressed={isPinned}
                  aria-label={isPinned ? '取消固定侧栏' : '固定侧栏'} title={isPinned ? '取消固定侧栏' : '固定侧栏'}
                  className="quiet-button rounded-md p-2" style={{ backgroundColor: isPinned ? 'var(--theme-selection)' : 'transparent' }}><Pin size={15} /></button>}
                <button type="button" onClick={() => setIsOpen(false)} aria-label="关闭时间与标签侧栏" className="quiet-button rounded-md p-2"><X size={16} /></button>
              </div>
            </div>
            <div className="recall-navigation">
              <div className="recall-tabs" role="group" aria-label="回顾视角">
                <button type="button" aria-pressed={viewMode === 'timeline'} onClick={() => { setViewMode('timeline'); setShowJumpPopover(false); }}>时间</button>
                <button type="button" aria-pressed={viewMode === 'tag' || viewMode === 'all-tags'} onClick={() => { setViewMode('all-tags'); setShowJumpPopover(false); }}>标签</button>
              </div>
              <div ref={jumpPopoverRef} className="relative">
                <button ref={dateButtonRef} type="button" className="quiet-button recall-date-button" aria-label="筛选创作时间" title="按创作时间筛选"
                  aria-expanded={showJumpPopover} aria-haspopup="dialog" onClick={() => setShowJumpPopover(value => !value)}>
                  <CalendarDays size={15} /><span>日期</span>
                </button>
                <AnimatePresence>
                  {showJumpPopover && (
                    <motion.div
                      role="dialog"
                      aria-label="选择时间范围"
                      initial={reduceMotion ? false : { opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
                      transition={{ duration: reduceMotion ? 0 : 0.15, ease: 'easeOut' }}
                      className="timeline-date-popover absolute right-0 top-full mt-2 z-50 rounded-lg border p-3"
                      style={{ backgroundColor: 'var(--theme-bg)', borderColor: 'var(--theme-border)' }}
                    >
                      {customJumpMode ? (
                        <div className="flex flex-col gap-1.5 px-1 py-1">
                          <div className="flex flex-col gap-3">
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
                            查看
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
            </div>
            <button type="button" className="quiet-button recall-continue" aria-label="浏览篇目" aria-pressed={viewMode === 'articles'}
              onClick={() => { setViewMode('articles'); setShowJumpPopover(false); }}>
              <FilePenLine size={15} />
              <span className="flex-1 text-left">继续写作</span>
              <span className="recall-continue-count">{visibleArticles.length} 篇</span>
              <ArrowUpRight size={14} />
            </button>

            {/* 动态透视容器：时间轴 vs 标签透视 */}
            {inRangeMode && <div className="mb-3 flex items-center gap-2 px-8 text-xs" style={{ color: 'var(--theme-muted)' }}>
              <span className="min-w-0 flex-1 break-words">创作时间 · {rangeLabel}</span>
              <button type="button" className="quiet-button rounded p-1" aria-label="清除时间筛选" onClick={closeRangeMode}><X size={13} /></button>
            </div>}
            {viewMode === 'tag' && activeTag && <div className="recall-tag-heading">
              <button type="button" className="quiet-button rounded p-1" aria-label="查看全部标签" onClick={() => setViewMode('all-tags')}><ArrowLeft size={14} /></button>
              <span>#{activeTag}</span>
            </div>}
            {(viewMode === 'timeline' || viewMode === 'all-tags') && (dataLoading || dataFailed) && (
              <div role="status" className="px-8 pb-3 text-xs" style={{ color: 'var(--theme-muted)' }}>
                {dataLoading ? '正在加载…' : <button onClick={() => setRetry(n => n + 1)}>读取失败，点击重试</button>}
              </div>
            )}
            <div className="flex-1 relative w-full h-full overflow-hidden">
              <AnimatePresence mode="wait">
                {viewMode === 'articles' ? (
                  <motion.div key="articles" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 overflow-y-auto px-6 pb-24 custom-scrollbar">
                    <div className="recall-order" role="group" aria-label="篇目排序">
                      <button type="button" className="quiet-button rounded py-1" aria-pressed={articleSort === 'modified'} style={{ color: articleSort === 'modified' ? 'var(--theme-text)' : 'var(--theme-muted)' }} onClick={() => setArticleSort('modified')}>最近修改</button>
                      <button type="button" className="quiet-button rounded py-1" aria-pressed={articleSort === 'created'} style={{ color: articleSort === 'created' ? 'var(--theme-text)' : 'var(--theme-muted)' }} onClick={() => setArticleSort('created')}>创作时间</button>
                    </div>
                    {dataLoading || dataFailed ? <div role="status" className="py-8 text-sm" style={{ color: 'var(--theme-muted)' }}>
                      {dataLoading ? '正在加载…' : <button onClick={() => setRetry(n => n + 1)}>读取失败，点击重试</button>}
                    </div> : visibleArticles.length === 0 ? <div className="py-8 text-sm leading-loose" style={{ color: 'var(--theme-muted)' }}>
                      <p>让一个想法，慢慢成为一篇。</p>
                      <button className="quiet-button mt-4 rounded px-2 py-1" onClick={onNewArticle}>新建篇目</button>
                    </div> : visibleArticles.map(doc => (
                      <ArticleCard key={doc.filename} current={currentFilename === doc.filename}
                        article={{ filename: doc.filename, title: displayTitle(doc.filename, parseDocument(doc.filename, doc.content).title), content: parseDocument(doc.filename, doc.content).body, created: doc.created, created_date: documentDate(doc), modified: doc.modified, tags: doc.tags ?? extractTagsFromText(parseDocument(doc.filename, doc.content).body) }}
                        onOpen={onDateClick} onTag={selectTag} dateMode={articleSort} />
                    ))}
                  </motion.div>
                ) : viewMode === 'timeline' ? (
                  <motion.div
                    key="timeline"
                    initial={reduceMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduceMotion ? 0 : 0.2, ease: 'easeOut' }}
                    className={`absolute inset-0 overflow-y-auto pl-12 pr-12 pb-24 custom-scrollbar timeline-scroll-container ${isScrolling ? 'is-scrolling' : 'is-idle'}`}
                    onScroll={() => {
                      setIsScrolling(true);
                      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
                      scrollTimerRef.current = setTimeout(() => setIsScrolling(false), 800);
                    }}
                  >
                    {rangeLoading || rangeError ? (
                      <div role="status" className="py-8 text-sm" style={{ color: 'var(--theme-muted)' }}>{rangeLoading ? '正在加载…' : rangeError}</div>
                    ) : visibleRecords.length === 0 ? (
                      <div className="py-8 text-sm" style={{ color: 'var(--theme-muted)' }}>{inRangeMode ? '这个区间还没有笔记' : '暂无记录…'}</div>
                    ) : <RecallTimeline days={visibleRecords} onOpen={onDateClick} onSelectResult={onSelectResult} onTag={selectTag} onBrowseDate={browseDate} />}
                  </motion.div>
                ) : viewMode === 'all-tags' ? (
                  <motion.div
                    key="all-tags"
                    initial={reduceMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduceMotion ? 0 : 0.2, ease: 'easeOut' }}
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
                          <span className="text-xs font-mono opacity-30 group-hover:opacity-60 transition-opacity" style={{ color: 'var(--theme-muted)' }}>{count}</span>
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
                    initial={reduceMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduceMotion ? 0 : 0.2, ease: 'easeOut' }}
                    className="absolute inset-0"
                  >
                    {activeTag && (
                      <TagPerspectiveView key={activeTag} tag={activeTag} revision={tagsRev} range={recallRange} onBrowseDate={browseDate} onBlockClick={onBlockClick} onDateClick={onDateClick} onSelectResult={onSelectResult} />
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