import type { HTMLAttributes, ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import type { PeriodReflectionResult, ReflectionQuery } from '../types';
import { getPeriodReflection } from '../utils/reflection';
import { captureImage } from '../utils/imageExport';
import { reflectionQuickRange } from '../utils/reflectionPresentation';
import { PeriodReflectionScroll, type PeriodReflectionScrollProps } from './PeriodReflectionScroll';

const motionState = vi.hoisted(() => ({ reduced: false }));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  useIsPresent: () => true,
  useReducedMotion: () => motionState.reduced,
  motion: { div: ({ initial, animate: _animate, exit: _exit, transition, ...props }: HTMLAttributes<HTMLDivElement> & {
    initial: unknown; animate: unknown; exit?: unknown; transition: { duration: number };
  }) => <div {...props} data-motion-initial={JSON.stringify(initial)} data-motion-duration={transition.duration} /> },
}));
vi.mock('../utils/reflection', () => ({ getPeriodReflection: vi.fn() }));
vi.mock('../utils/imageExport', () => ({ captureImage: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn() }));
const get = vi.mocked(getPeriodReflection);
const capture = vi.mocked(captureImage);
const saveImage = vi.mocked(save);
const write = vi.mocked(writeFile);
const anchor = { text: '完整段落，不能用截断预览定位。', occurrence: 2 };
const bytes = new Uint8Array([1, 2, 3]);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(query: ReflectionQuery = {}): PeriodReflectionResult {
  return {
    query: { startDate: query.startDate ?? null, endDate: query.endDate ?? null, perspective: query.perspective ?? { kind: 'all' }, pageSeed: query.pageSeed ?? 0 },
    overview: { activeDaysCount: 3, dailyBlocksCount: 4, titledArticlesCount: 1, favoriteTimeBucket: null, richestDay: null },
    themes: { topTags: [{ tag: query.perspective?.kind === 'tag' ? '筛选标签' : '读书', count: 4 }], untaggedBlocksCount: 0, totalDistinctWorksCount: 1,
      deepWorks: [{ workName: '山间来信', mentionCount: 2, distinctDaysCount: 2, effectiveChars: 234, filenames: ['journal-suffix.md'],
        representativeQuote: { blockId: 10, filename: 'journal-suffix.md', date: '2026-05-04', content: '作品的回响', contextAnchor: anchor } }] },
    articles: { longestBrewed: [{ filename: 'old-article.md', title: '慢慢生长的文字', createdDate: '2025-01-01', modifiedDate: '2026-05-04', spanDays: 488 }], mostReferenced: [] },
    sampledQuotes: [{ blockId: query.pageSeed ?? 0, filename: 'journal-suffix.md', date: '2026-05-04', content: `光影 ${query.pageSeed ?? 0}`, contextAnchor: anchor, slot: 'nightMonologue', tags: ['读书'] }],
  };
}
function empty(query: ReflectionQuery): PeriodReflectionResult {
  return { query: fixture(query).query,
    overview: { activeDaysCount: 0, dailyBlocksCount: 0, titledArticlesCount: 0, favoriteTimeBucket: null, richestDay: null },
    themes: { topTags: [], untaggedBlocksCount: 0, totalDistinctWorksCount: 0, deepWorks: [] },
    articles: { longestBrewed: [], mostReferenced: [] }, sampledQuotes: [] };
}
function props(overrides: Partial<PeriodReflectionScrollProps> = {}): PeriodReflectionScrollProps {
  return { open: true, range: { start: '2026-05-01', end: '2026-05-31' }, perspective: { kind: 'all' }, revision: 1,
    theme: 'paper', themeConfig: { bg: '#faf8f2', text: '#333333', muted: '#777777' },
    onRangeChange: vi.fn(), onPerspectiveChange: vi.fn(), onClose: vi.fn(), onNavigate: vi.fn(async () => true),
    onRetryPreparation: vi.fn(), onExportBusyChange: vi.fn(), ...overrides };
}
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
async function ready() { await waitFor(() => expect(button('导出为长图信笺').disabled).toBe(false)); }
beforeEach(() => {
  vi.clearAllMocks();
  get.mockReset(); get.mockImplementation(async query => fixture(query));
  capture.mockReset(); capture.mockResolvedValue(bytes);
  saveImage.mockReset(); saveImage.mockResolvedValue('/exports/letter.png');
  write.mockReset(); write.mockResolvedValue(undefined);
  motionState.reduced = false;
});
afterEach(cleanup);

it('renders the real four chapters, capture root, seal, and empty AI slot', async () => {
  const { container } = render(<PeriodReflectionScroll {...props()} />);
  await ready();
  for (const title of ['光阴刻度', '万象与深潜', '慢火长卷', '吉光片羽']) expect(screen.getByRole('heading', { name: title })).toBeTruthy();
  expect(screen.getByRole('region', { name: '光阴刻度' })).toHaveTextContent('在 3 个日子落笔');
  expect(screen.queryByText('被你再次想起')).toBeNull();
  const letter = container.querySelector('[data-reflection-letter]')!;
  expect(within(letter as HTMLElement).getByText('Silens')).toBeTruthy();
  expect(letter.querySelector('[data-reflection-ai-slot]')?.childNodes.length).toBe(0);
  expect(letter.querySelector('[aria-label="导出为长图信笺"]')).toBeNull();
  expect(button('换一束光').hasAttribute('data-export-exclude')).toBe(true);
});

it('silently hides missing modules and uses one whole-result empty message', async () => {
  get.mockImplementation(async query => empty(query));
  render(<PeriodReflectionScroll {...props()} />);
  await ready();
  expect(screen.getAllByText('这段时光留白如纸，尚无落笔痕迹')).toHaveLength(1);
  expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
  expect(screen.queryByRole('button', { name: '换一束光' })).toBeNull();
  expect(screen.queryByText(/0 篇|暂无作品/)).toBeNull();
});

it('keeps modification-only results and navigates richest day to its real article fallback', async () => {
  get.mockImplementation(async query => ({ ...empty(query), overview: { ...empty(query).overview,
    richestDay: { date: '2026-05-04', tags: [], untaggedBlocksCount: 0, articles: [{ filename: 'old-real.md', title: '旧篇新写' }], preview: '', previewSource: null } } }));
  const p = props(); render(<PeriodReflectionScroll {...p} />); await ready();
  expect(screen.queryByText('这段时光留白如纸，尚无落笔痕迹')).toBeNull();
  fireEvent.click(button('回到 2026-05-04'));
  expect(p.onNavigate).toHaveBeenCalledWith('old-real.md', undefined);
  await waitFor(() => expect(p.onClose).toHaveBeenCalledWith('navigate'));
});

it('prefers richest-day previewSource with the exact occurrence and suffixed filename', async () => {
  get.mockImplementation(async query => ({ ...empty(query), overview: { ...empty(query).overview,
    richestDay: { date: '2026-05-04', tags: ['读书'], untaggedBlocksCount: 1, articles: [{ filename: 'fallback.md', title: '文章' }], preview: '短预览',
      previewSource: { blockId: 12, filename: '2026-05-04-suffix.md', date: '2026-05-04', content: '全文', contextAnchor: anchor } } } }));
  const p = props(); render(<PeriodReflectionScroll {...p} />); await ready();
  fireEvent.click(button('回到 2026-05-04'));
  expect(p.onNavigate).toHaveBeenCalledWith('2026-05-04-suffix.md', anchor);
  await waitFor(() => expect(p.onClose).toHaveBeenCalledWith('navigate'));
});

it('issues no IPC before preparation succeeds, supports retry, and gates closed/suppressed views', async () => {
  const p = props({ preparing: true });
  const { rerender } = render(<PeriodReflectionScroll {...p} />);
  expect(screen.getByRole('status').textContent).toContain('正在保存'); expect(get).not.toHaveBeenCalled();
  rerender(<PeriodReflectionScroll {...p} preparing={false} preparationError="保存失败" />);
  expect(screen.getByRole('alert').textContent).toBe('保存失败');
  fireEvent.click(button('重试准备')); expect(p.onRetryPreparation).toHaveBeenCalledTimes(1); expect(get).not.toHaveBeenCalled();
  rerender(<PeriodReflectionScroll {...p} preparing={false} suppressed />); expect(screen.queryByRole('dialog')).toBeNull(); expect(get).not.toHaveBeenCalled();
  rerender(<PeriodReflectionScroll {...p} preparing={false} open={false} />); expect(get).not.toHaveBeenCalled();
  rerender(<PeriodReflectionScroll {...p} preparing={false} />); await ready();
  expect(get).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledWith({ startDate: '2026-05-01', endDate: '2026-05-31', perspective: { kind: 'all' }, pageSeed: 0 });
});

it('queries exact controlled perspectives/dates/seeds and keeps All-scope capsules', async () => {
  const p = props(); const { rerender } = render(<PeriodReflectionScroll {...p} />); await ready();
  fireEvent.click(button('#读书')); expect(p.onPerspectiveChange).toHaveBeenLastCalledWith({ kind: 'tag', tag: '读书' });
  rerender(<PeriodReflectionScroll {...p} perspective={{ kind: 'tag', tag: '非热门' }} />); await ready();
  expect(get).toHaveBeenLastCalledWith({ startDate: '2026-05-01', endDate: '2026-05-31', perspective: { kind: 'tag', tag: '非热门' }, pageSeed: 0 });
  expect(screen.queryByRole('button', { name: '#非热门' })).toBeNull(); expect(button('#读书')).toBeTruthy();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('#非热门');
  expect(screen.queryByRole('button', { name: '#筛选标签' })).toBeNull();
  fireEvent.click(button('换一束光')); await waitFor(() => expect(screen.getByText('光影 1')).toBeTruthy());
  expect(get).toHaveBeenCalledTimes(3);
  expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ perspective: { kind: 'tag', tag: '非热门' }, pageSeed: 1 }));
  fireEvent.click(button('未命名')); expect(p.onPerspectiveChange).toHaveBeenLastCalledWith({ kind: 'untagged' });
  rerender(<PeriodReflectionScroll {...p} range={{ end: '2026-06-30' }} perspective={{ kind: 'articlesOnly' }} />); await ready();
  expect(get).toHaveBeenLastCalledWith({ startDate: null, endDate: '2026-06-30', perspective: { kind: 'articlesOnly' }, pageSeed: 0 });
  fireEvent.click(button('独立篇目')); expect(p.onPerspectiveChange).toHaveBeenLastCalledWith({ kind: 'articlesOnly' });
});

it('limits capsule tags to five positive frequencies in the current All result', async () => {
  get.mockImplementation(async query => {
    const result = fixture(query);
    result.themes.topTags = [{ tag: '空标签', count: 0 }, ...Array.from({ length: 7 }, (_, i) => ({ tag: `标签${i}`, count: 7 - i }))];
    return result;
  });
  render(<PeriodReflectionScroll {...props({ perspective: { kind: 'tag', tag: '标签6' } })} />);
  await ready();
  const controls = screen.getByRole('group', { name: '回顾视角' });
  expect(within(controls).getAllByRole('button').filter(node => node.textContent?.startsWith('#')).map(node => node.textContent))
    .toEqual(['#标签0', '#标签1', '#标签2', '#标签3', '#标签4']);
});

it('offers All for an empty perspective and excludes the action from the letter image', async () => {
  get.mockImplementation(async query => query.perspective?.kind === 'all' ? fixture(query) : empty(query));
  const p = props({ perspective: { kind: 'untagged' } });
  render(<PeriodReflectionScroll {...p} />); await ready();
  const action = button('查看这段时光的全部随想 →');
  expect(action.closest('[data-export-exclude]')).not.toBeNull();
  fireEvent.click(action);
  expect(p.onPerspectiveChange).toHaveBeenCalledExactlyOnceWith({ kind: 'all' });
  expect(p.onRangeChange).not.toHaveBeenCalled();
  expect(p.onClose).not.toHaveBeenCalled();
});

it('returns to writing only when the full period is empty and hides stale actions during refresh', async () => {
  get.mockImplementation(async query => empty(query));
  const p = props(); const { rerender } = render(<PeriodReflectionScroll {...p} />); await ready();
  fireEvent.click(button('回到今日落笔 →'));
  expect(p.onClose).toHaveBeenCalledExactlyOnceWith('write');
  const pending = deferred<PeriodReflectionResult>(); get.mockReturnValueOnce(pending.promise);
  rerender(<PeriodReflectionScroll {...p} range={{ start: '2026-06-01' }} />);
  expect(screen.queryByRole('button', { name: '回到今日落笔 →' })).toBeNull();
  await act(async () => pending.resolve(empty({ startDate: '2026-06-01' })));
});

it('waits for All and retries its failure without claiming the full period is empty', async () => {
  const all = deferred<PeriodReflectionResult>();
  get.mockImplementation(query => query.perspective?.kind === 'all' ? all.promise : Promise.resolve(empty(query)));
  const p = props({ perspective: { kind: 'untagged' } });
  render(<PeriodReflectionScroll {...p} />); await ready();
  expect(screen.getByText('正在查看这段时光…')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '回到今日落笔 →' })).toBeNull();
  await act(async () => all.reject(new Error('读取全部失败')));
  expect(screen.queryByRole('button', { name: '回到今日落笔 →' })).toBeNull();
  get.mockImplementation(async query => fixture(query));
  fireEvent.click(button('重新查看这段时光 →'));
  await waitFor(() => expect(button('查看这段时光的全部随想 →')).toBeEnabled());
  expect(get.mock.calls.filter(([query]) => query.perspective?.kind === 'all')).toHaveLength(2);
  expect(get.mock.calls.filter(([query]) => query.perspective?.kind === 'untagged')).toHaveLength(1);
});

it('submits local quick and custom ranges only on explicit actions, validating reversed dates', async () => {
  const p = props(); render(<PeriodReflectionScroll {...p} />); await ready();
  for (const [label, preset] of [['近一月', 'month'], ['这一季', 'quarter'], ['今年', 'year'], ['全部时光', 'all']] as const) {
    fireEvent.click(button(label)); expect(p.onRangeChange).toHaveBeenLastCalledWith(reflectionQuickRange(preset));
  }
  vi.mocked(p.onRangeChange).mockClear();
  fireEvent.click(button('自定义'));
  fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-06-30' } });
  fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-06-01' } });
  expect(p.onRangeChange).not.toHaveBeenCalled();
  fireEvent.click(button('应用日期')); expect(screen.getByRole('alert').textContent).toContain('开始日期不能晚于结束日期');
  expect(p.onRangeChange).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '' } });
  fireEvent.click(button('应用日期')); expect(p.onRangeChange).toHaveBeenLastCalledWith({ end: '2026-06-01' });
});

it('preserves old content while refreshing, disables card/export, and ignores stale success and close failure', async () => {
  const p = props(); const { rerender } = render(<PeriodReflectionScroll {...p} />); await ready();
  const stale = deferred<PeriodReflectionResult>(); get.mockReturnValueOnce(stale.promise);
  rerender(<PeriodReflectionScroll {...p} revision={2} range={{ start: '2026-06-01' }} />);
  expect(screen.getByText('光影 0')).toBeTruthy(); expect(button('导出为长图信笺').disabled).toBe(true);
  expect(button('回到深夜独白 · 2026-05-04').disabled).toBe(true);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('2026 年 5 月');
  rerender(<PeriodReflectionScroll {...p} revision={3} />); await ready();
  await act(async () => stale.resolve(fixture({ pageSeed: 99 })));
  expect(screen.queryByText('光影 99')).toBeNull();
  const closed = deferred<PeriodReflectionResult>(); get.mockReturnValueOnce(closed.promise);
  rerender(<PeriodReflectionScroll {...p} revision={4} />);
  rerender(<PeriodReflectionScroll {...p} open={false} />);
  await act(async () => closed.reject(new Error('迟到错误')));
  expect(screen.queryByRole('dialog')).toBeNull();
  rerender(<PeriodReflectionScroll {...p} />); await ready(); expect(screen.queryByText('迟到错误')).toBeNull();
});

it('retries query failures without closing the scroll', async () => {
  get.mockRejectedValueOnce(new Error('读取失败'));
  const p = props(); render(<PeriodReflectionScroll {...p} />);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('读取失败'));
  fireEvent.click(button('重新拾遗')); await ready(); expect(get).toHaveBeenCalledTimes(2); expect(p.onClose).not.toHaveBeenCalled();
});

it('closes only on successful navigation and locks repeated actions while navigating', async () => {
  const navigation = deferred<boolean>(); const p = props({ onNavigate: vi.fn(() => navigation.promise) });
  render(<PeriodReflectionScroll {...p} />); await ready();
  const card = button('回到深夜独白 · 2026-05-04'); fireEvent.click(card); fireEvent.click(card);
  expect(p.onNavigate).toHaveBeenCalledTimes(1); expect(p.onNavigate).toHaveBeenCalledWith('journal-suffix.md', anchor);
  expect(p.onClose).not.toHaveBeenCalled(); expect(button('收起时光拾遗').disabled).toBe(true);
  expect(button('今年').disabled).toBe(true); expect(screen.getByRole('dialog').getAttribute('aria-busy')).toBe('true');
  await act(async () => navigation.resolve(true)); expect(p.onClose).toHaveBeenCalledExactlyOnceWith('navigate');
});

it.each(['false', 'throw'] as const)('preserves the letter after navigation failure (%s)', async mode => {
  const p = props({ onNavigate: vi.fn(async () => { if (mode === 'throw') throw new Error('无法打开'); return false; }) });
  render(<PeriodReflectionScroll {...p} />); await ready(); fireEvent.click(button('回到深夜独白 · 2026-05-04'));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(mode === 'throw' ? '无法打开' : '未能打开原文'));
  expect(p.onClose).not.toHaveBeenCalled(); expect(screen.getByText('光影 0')).toBeTruthy(); await ready();
});

it('ignores navigation completion from a previous opening without unlocking the new navigation', async () => {
  const first = deferred<boolean>(); const second = deferred<boolean>();
  const onNavigate = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const p = props({ onNavigate }); const { rerender } = render(<PeriodReflectionScroll {...p} />); await ready();
  fireEvent.click(button('回到深夜独白 · 2026-05-04'));
  rerender(<PeriodReflectionScroll {...p} suppressed />);
  rerender(<PeriodReflectionScroll {...p} />); await ready();
  fireEvent.click(button('回到深夜独白 · 2026-05-04'));
  await act(async () => first.resolve(true)); expect(p.onClose).not.toHaveBeenCalled(); expect(button('今年').disabled).toBe(true);
  await act(async () => second.resolve(true)); expect(p.onClose).toHaveBeenCalledExactlyOnceWith('navigate');
});

it('traps modal focus, closes custom dates first, ignores IME Escape, and keeps the scroll open on backdrop clicks', async () => {
  const p = props(); const { container } = render(<PeriodReflectionScroll {...p} />); await ready();
  expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
  const close = button('收起时光拾遗'); close.focus(); fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(button('导出为长图信笺'));
  fireEvent.keyDown(document.activeElement!, { key: 'Tab' }); expect(document.activeElement).toBe(close);
  fireEvent.click(button('自定义')); fireEvent.keyDown(screen.getByLabelText('开始日期'), { key: 'Escape' });
  expect(screen.queryByLabelText('开始日期')).toBeNull(); expect(p.onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(close, { key: 'Escape', isComposing: true }); expect(p.onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Silens')); expect(p.onClose).not.toHaveBeenCalled();
  fireEvent.click(container.querySelector('.period-reflection-backdrop')!); expect(p.onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(close, { key: 'Escape' }); expect(p.onClose).toHaveBeenCalledExactlyOnceWith('dismiss');
});

it.each([false, true])('explicitly closes with custom dates open (pinned sidebar: %s)', async sidebarInteractive => {
  const p = props({ sidebarInteractive }); render(<PeriodReflectionScroll {...p} />); await ready();
  fireEvent.click(button('自定义'));
  expect(screen.getByLabelText('开始日期')).toBeInTheDocument();
  expect(button('收起时光拾遗')).toHaveTextContent('收起');
  fireEvent.click(button('收起时光拾遗'));
  expect(p.onClose).toHaveBeenCalledExactlyOnceWith('dismiss');
});

it('leaves focus restoration to App when the scroll is suppressed', async () => {
  const p = props({ open: false });
  const { rerender } = render(<><button>展卷入口</button><PeriodReflectionScroll {...p} /></>);
  const entry = button('展卷入口'); entry.focus();
  rerender(<><button>展卷入口</button><PeriodReflectionScroll {...p} open /></>); await ready();
  expect(document.activeElement).toBe(button('收起时光拾遗'));
  rerender(<><button>展卷入口</button><PeriodReflectionScroll {...p} open suppressed /></>);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).not.toBe(entry);
});

it('allows pinned sidebar focus outside the nonmodal dialog and handles local Escape', async () => {
  const p = props({ sidebarInteractive: true });
  render(<><button>侧栏筛选</button><PeriodReflectionScroll {...p} /></>); await ready();
  expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('false');
  button('侧栏筛选').focus();
  expect(fireEvent.keyDown(button('侧栏筛选'), { key: 'Tab', cancelable: true })).toBe(true);
  expect(document.activeElement).toBe(button('侧栏筛选'));
  fireEvent.keyDown(button('侧栏筛选'), { key: 'Escape' }); expect(p.onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(button('收起时光拾遗'), { key: 'Escape' }); expect(p.onClose).toHaveBeenCalledWith('dismiss');
});

it('removes entry animation for reduced motion and hides immediately when suppressed', async () => {
  motionState.reduced = true; const p = props(); const { container, rerender } = render(<PeriodReflectionScroll {...p} />); await ready();
  const backdrop = container.querySelector('.period-reflection-backdrop')!;
  expect(backdrop.getAttribute('data-motion-initial')).toBe('false'); expect(backdrop.getAttribute('data-motion-duration')).toBe('0');
  rerender(<PeriodReflectionScroll {...p} suppressed />); expect(container.childElementCount).toBe(0);
});

it.each(['png', 'jpg'] as const)('exports %s through the shared capture helper with the complete letter and theme', async format => {
  const p = props({ theme: 'night', themeConfig: { bg: '#222222', text: '#eeeeee', muted: '#999999' } });
  render(<PeriodReflectionScroll {...p} />); await ready();
  fireEvent.change(screen.getByLabelText('图片格式'), { target: { value: format } }); fireEvent.click(button('导出为长图信笺'));
  await waitFor(() => expect(write).toHaveBeenCalledWith('/exports/letter.png', bytes));
  expect(capture).toHaveBeenCalledTimes(1);
  const [source, options] = capture.mock.calls[0];
  expect(source.hasAttribute('data-reflection-letter')).toBe(true); expect(source.textContent).toContain('Silens'); expect(source.textContent).toContain('慢火长卷');
  expect(options).toEqual({ format, backgroundColor: '#222222', color: '#eeeeee', fullHeight: true });
  expect(saveImage).toHaveBeenCalledWith({ defaultPath: `时光拾遗-2026-05-01-2026-05-31-全部.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
  expect(p.onExportBusyChange).toHaveBeenNthCalledWith(1, true); expect(p.onExportBusyChange).toHaveBeenLastCalledWith(false);
  expect(screen.getByText('长图信笺已保存。')).toBeTruthy(); expect(p.onClose).not.toHaveBeenCalled();
});

it('locks export/close/filter actions until capture, save, and write finish; suppression still removes the UI', async () => {
  const pendingCapture = deferred<Uint8Array>(); const pendingWrite = deferred<void>();
  capture.mockReturnValueOnce(pendingCapture.promise); write.mockReturnValueOnce(pendingWrite.promise);
  const p = props(); const { rerender, container } = render(<PeriodReflectionScroll {...p} />); await ready();
  fireEvent.click(button('导出为长图信笺')); fireEvent.click(button('导出为长图信笺'));
  expect(capture).toHaveBeenCalledTimes(1); expect(saveImage).not.toHaveBeenCalled();
  for (const name of ['收起时光拾遗', '今年', '自定义', '全部', '换一束光']) expect(button(name).disabled).toBe(true);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); fireEvent.click(container.querySelector('.period-reflection-backdrop')!);
  expect(p.onClose).not.toHaveBeenCalled();
  rerender(<PeriodReflectionScroll {...p} suppressed />); expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => pendingCapture.resolve(bytes)); expect(write).toHaveBeenCalledWith('/exports/letter.png', bytes);
  expect(p.onExportBusyChange).toHaveBeenLastCalledWith(true);
  await act(async () => pendingWrite.resolve()); expect(p.onExportBusyChange).toHaveBeenLastCalledWith(false);
  rerender(<PeriodReflectionScroll {...p} />); await ready(); expect(screen.queryByText('长图信笺已保存。')).toBeNull();
});

it('preserves range, perspective, seed and letter when the native save dialog is cancelled', async () => {
  saveImage.mockResolvedValueOnce(null); const p = props({ perspective: { kind: 'tag', tag: '读书' } });
  render(<PeriodReflectionScroll {...p} />); await ready(); fireEvent.click(button('换一束光'));
  await waitFor(() => expect(screen.getByText('光影 1')).toBeTruthy());
  const calls = get.mock.calls.length; fireEvent.click(button('导出为长图信笺')); await ready();
  expect(write).not.toHaveBeenCalled(); expect(get).toHaveBeenCalledTimes(calls);
  expect(screen.getByText('光影 1')).toBeTruthy(); expect(button('#读书').getAttribute('aria-pressed')).toBe('true');
  expect(p.onRangeChange).not.toHaveBeenCalled(); expect(p.onPerspectiveChange).not.toHaveBeenCalled(); expect(p.onClose).not.toHaveBeenCalled();
  expect(p.onExportBusyChange).toHaveBeenLastCalledWith(false); expect(screen.queryByRole('alert')).toBeNull();
});

it.each(['capture', 'save', 'write'] as const)('preserves the scroll and supports retry after %s failure', async stage => {
  if (stage === 'capture') capture.mockRejectedValueOnce(new Error('导出错误'));
  if (stage === 'save') saveImage.mockRejectedValueOnce(new Error('导出错误'));
  if (stage === 'write') write.mockRejectedValueOnce(new Error('导出错误'));
  const p = props(); render(<PeriodReflectionScroll {...p} />); await ready(); fireEvent.click(button('导出为长图信笺'));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('导出错误'));
  expect(p.onClose).not.toHaveBeenCalled(); expect(p.onExportBusyChange).toHaveBeenLastCalledWith(false); expect(screen.getByText('光影 0')).toBeTruthy();
  if (stage === 'capture') expect(saveImage).not.toHaveBeenCalled();
  if (stage !== 'write') expect(write).not.toHaveBeenCalled();
  fireEvent.click(button('导出为长图信笺')); await waitFor(() => expect(screen.getByText('长图信笺已保存。')).toBeTruthy());
  expect(screen.queryByRole('alert')).toBeNull();
});

it('finishes the export busy callback after unmount', async () => {
  const pending = deferred<Uint8Array>(); capture.mockReturnValueOnce(pending.promise);
  const p = props(); const { unmount } = render(<PeriodReflectionScroll {...p} />); await ready();
  fireEvent.click(button('导出为长图信笺')); unmount();
  await act(async () => pending.resolve(bytes));
  expect(write).toHaveBeenCalledWith('/exports/letter.png', bytes); expect(p.onExportBusyChange).toHaveBeenLastCalledWith(false);
});
