import { useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { periodLabel, periodRange, type RecallPeriod } from '../utils/recall';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { TimelineSidebar } from './TimelineSidebar';
import { ArticleCard, RecallTimeline } from './RecallTimeline';
import type { Document, RecallArticle, RecallDay } from '../types';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('framer-motion', async importOriginal => ({
  ...await importOriginal<typeof import('framer-motion')>(),
  useReducedMotion: vi.fn(() => true),
}));
const timestamp = (year: number, month: number, day: number) => new Date(year, month - 1, day, 12).getTime() / 1000;
const old: RecallArticle = { filename: 'article-old.md', title: '旧篇目', content: '很早开始的思考', created: timestamp(2020, 1, 2), created_date: '2020-01-02', modified: timestamp(2026, 11, 4), tags: ['研究', '写作'] };
const recent: RecallArticle = { filename: 'article-new.md', title: '新篇目', content: '最近开始的思考', created: timestamp(2026, 11, 3), created_date: '2026-11-03', modified: timestamp(2026, 11, 3), tags: ['研究'] };
const days: RecallDay[] = [
  { date: '2026-11-03', articles: [recent], tags: [{ filename: '2026-11-03_补记.md', tag: '研究', blocks: ['当日随记内容'] }] },
  { date: '2020-01-02', articles: [old], tags: [] },
];
const documents: Document[] = [old, recent].map(article => ({ ...article, content: `# ${article.title}\n\n${article.content}`, kind: 'article', journal_date: null }));
const blocks = [old, recent].map((article, id) => ({ ...article, id, date: article.created_date, kind: 'article', raw_markdown: article.content }));

beforeEach(() => {
  vi.mocked(useReducedMotion).mockReturnValue(true);
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'get_timeline_data') return days;
    if (command === 'get_all_documents') return documents;
    if (command === 'query_blocks_by_tag') {
      const range = args as { startDate?: string; endDate?: string };
      return blocks.filter(block => (!range.startDate || block.date >= range.startDate) && (!range.endDate || block.date <= range.endDate));
    }
    throw new Error(`Unexpected ${command}`);
  });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const props = { isOpen: true, setIsOpen: vi.fn(), tagsRev: 0, theme: 'paper' };
const reflectionEntry = () => screen.queryByRole('button', { name: '展开时光拾遗' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

it('counts actual records across timeline, all tags and filtered articles', async () => {
  const open = vi.fn();
  const view = render(<TimelineSidebar {...props} onOpenReflection={open} />);
  expect(reflectionEntry()).not.toBeInTheDocument();
  expect(await screen.findByText('拾遗这段时光 · 3 段记录')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '标签' }));
  expect(reflectionEntry()).toHaveTextContent('3 段记录');
  fireEvent.click(screen.getByRole('button', { name: '浏览篇目' }));
  expect(reflectionEntry()).toHaveTextContent('2 段记录');
  fireEvent.click(reflectionEntry()!);
  expect(open).toHaveBeenLastCalledWith({ kind: 'articlesOnly' });
  view.rerender(<TimelineSidebar {...props} onOpenReflection={open} recallRange={{ start: '2026-11-01' }} />);
  expect(reflectionEntry()).toHaveTextContent('1 段记录');
  view.rerender(<TimelineSidebar {...props} onOpenReflection={open} recallRange={{ end: '2019-12-31' }} />);
  expect(reflectionEntry()).not.toBeInTheDocument();
});

it('counts filtered tag blocks, preserving identical journal text and deduplicating article filenames', async () => {
  const query = deferred<unknown[]>();
  vi.mocked(invoke).mockImplementation(async command => command === 'get_timeline_data' ? days : command === 'get_all_documents' ? documents : query.promise);
  render(<TimelineSidebar {...props} externalForceTag="研究" recallRange={{ start: '2026-11-01' }} onOpenReflection={vi.fn()} />);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('query_blocks_by_tag', { tag: '研究', startDate: '2026-11-01' }));
  expect(reflectionEntry()).not.toBeInTheDocument();
  await act(async () => query.resolve([
    blocks[0], blocks[1], { ...blocks[1], id: 20 },
    { ...blocks[1], id: 21, kind: 'journal', content: '相同文字' },
    { ...blocks[1], id: 22, kind: 'journal', content: '相同文字' },
  ]));
  expect(reflectionEntry()).toHaveTextContent('3 段记录');
  expect(screen.getAllByText('相同文字')).toHaveLength(2);
});

it('hides retained parent results during revision, failure and reopening', async () => {
  const open = vi.fn();
  const view = render(<TimelineSidebar {...props} onOpenReflection={open} />);
  await screen.findByText('拾遗这段时光 · 3 段记录');
  const query = deferred<RecallDay[]>();
  vi.mocked(invoke).mockImplementation(async command => command === 'get_timeline_data' ? query.promise : documents);
  view.rerender(<TimelineSidebar {...props} tagsRev={1} onOpenReflection={open} />);
  expect(reflectionEntry()).not.toBeInTheDocument();
  await act(async () => query.reject(new Error('offline')));
  expect(reflectionEntry()).not.toBeInTheDocument();
  const reopened = deferred<RecallDay[]>();
  vi.mocked(invoke).mockImplementation(async command => command === 'get_timeline_data' ? reopened.promise : documents);
  view.rerender(<TimelineSidebar {...props} tagsRev={1} isOpen={false} onOpenReflection={open} />);
  view.rerender(<TimelineSidebar {...props} tagsRev={1} onOpenReflection={open} />);
  expect(reflectionEntry()).not.toBeInTheDocument();
  await act(async () => reopened.resolve(days));
  expect(await screen.findByText('拾遗这段时光 · 3 段记录')).toBeInTheDocument();
});

it('ignores stale tag and range responses and hides errors until retry succeeds', async () => {
  const queries: ReturnType<typeof deferred<unknown[]>>[] = [];
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === 'get_timeline_data') return days;
    if (command === 'get_all_documents') return documents;
    const query = deferred<unknown[]>();
    queries.push(query);
    return query.promise;
  });
  const open = vi.fn();
  const view = render(<TimelineSidebar {...props} externalForceTag="研究" onOpenReflection={open} />);
  await waitFor(() => expect(queries).toHaveLength(1));
  view.rerender(<TimelineSidebar {...props} externalForceTag="写作" onOpenReflection={open} />);
  await waitFor(() => expect(queries).toHaveLength(2));
  await act(async () => queries[1].resolve([blocks[1]]));
  expect(reflectionEntry()).toHaveTextContent('1 段记录');
  await act(async () => queries[0].resolve(blocks));
  expect(reflectionEntry()).toHaveTextContent('1 段记录');
  fireEvent.click(reflectionEntry()!);
  expect(open).toHaveBeenLastCalledWith({ kind: 'tag', tag: '写作' });
  view.rerender(<TimelineSidebar {...props} externalForceTag="写作" recallRange={{ start: '2026-11-01' }} onOpenReflection={open} />);
  expect(reflectionEntry()).not.toBeInTheDocument();
  await waitFor(() => expect(queries).toHaveLength(3));
  view.rerender(<TimelineSidebar {...props} tagsRev={1} externalForceTag="写作" recallRange={{ start: '2026-11-01' }} onOpenReflection={open} />);
  await waitFor(() => expect(queries).toHaveLength(4));
  await act(async () => queries[3].reject(new Error('offline')));
  await act(async () => queries[2].resolve(blocks));
  expect(reflectionEntry()).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: '读取失败，点击重试' }));
  await waitFor(() => expect(queries).toHaveLength(5));
  await act(async () => queries[4].resolve([]));
  expect(reflectionEntry()).not.toBeInTheDocument();
});

it('keeps the active timeline count when an outgoing tag request completes', async () => {
  const query = deferred<unknown[]>();
  vi.mocked(invoke).mockImplementation(async command => command === 'get_timeline_data' ? days : command === 'get_all_documents' ? documents : query.promise);
  const open = vi.fn();
  const view = render(<TimelineSidebar {...props} externalForceTag="研究" onOpenReflection={open} />);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('query_blocks_by_tag', { tag: '研究' }));
  fireEvent.click(screen.getByRole('button', { name: '时间' }));
  expect(await screen.findByText('拾遗这段时光 · 3 段记录')).toBeInTheDocument();
  await act(async () => query.resolve(blocks));
  expect(reflectionEntry()).toHaveTextContent('3 段记录');
  fireEvent.click(reflectionEntry()!);
  expect(open).toHaveBeenLastCalledWith({ kind: 'all' });
  view.rerender(<TimelineSidebar {...props} rangeLoading onOpenReflection={open} />);
  expect(reflectionEntry()).not.toBeInTheDocument();
  view.rerender(<TimelineSidebar {...props} rangeError="读取失败" onOpenReflection={open} />);
  expect(reflectionEntry()).not.toBeInTheDocument();
});

it('does not count empty days as records', async () => {
  vi.mocked(invoke).mockImplementation(async command => command === 'get_timeline_data' ? [{ date: '2026-11-03', articles: [], tags: [] }] : []);
  render(<TimelineSidebar {...props} onOpenReflection={vi.fn()} />);
  await waitFor(() => expect(screen.queryByText('正在加载…')).not.toBeInTheDocument());
  expect(reflectionEntry()).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '标签' }));
  expect(reflectionEntry()).not.toBeInTheDocument();
});

it('consolidates natural period text and keeps an accessible clear action with the picker open', async () => {
  const clear = vi.fn();
  const period: RecallPeriod = { unit: 'month', anchor: '2026-11-01' };
  const view = render(<TimelineSidebar {...props} recallPeriod={period} recallRange={periodRange(period)} rangeLabel={periodLabel(period)} onPeriodChange={vi.fn()} onClearRange={clear} />);
  await screen.findByText('新篇目');
  expect(screen.getAllByText(periodLabel(period))).toHaveLength(1);
  expect(screen.queryByText(`创作时间 · ${periodLabel(period)}`)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '清除时间筛选' }).parentElement)
    .toBe(screen.getByRole('button', { name: '选择回顾周期' }).parentElement);
  fireEvent.click(screen.getByRole('button', { name: '选择回顾周期' }));
  fireEvent.click(screen.getByRole('button', { name: '清除时间筛选' }));
  expect(clear).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog', { name: '跳转到指定周期' })).not.toBeInTheDocument();
  view.rerender(<TimelineSidebar {...props} recallRange={{ start: '2026-11-01' }} rangeLabel="2026.11.01 起" onPeriodChange={vi.fn()} onClearRange={clear} />);
  expect(screen.getByText('2026.11.01 起')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '清除时间筛选' }));
  expect(clear).toHaveBeenCalledTimes(2);
});

function PeriodSidebar({ initial = { unit: 'month', anchor: '2026-11-04' } }: { initial?: RecallPeriod }) {
  const [period, setPeriod] = useState(initial);
  const [open, setOpen] = useState(true);
  return <>
    <button onClick={() => setOpen(true)}>重新打开回顾</button>
    <TimelineSidebar {...props} isOpen={open} setIsOpen={setOpen} recallPeriod={period}
      recallRange={periodRange(period)} rangeLabel={periodLabel(period)} onPeriodChange={setPeriod} />
  </>;
}

it('flips empty months and directly selects a historical month without replacing the view', async () => {
  render(<PeriodSidebar />);
  await screen.findByText('新篇目');
  fireEvent.click(screen.getByRole('button', { name: '上一月' }));
  expect(await screen.findByText('这一月还没有记录')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '选择回顾周期' })).toHaveTextContent('2026 年 10 月');
  fireEvent.click(screen.getByRole('button', { name: '下一月' }));
  await screen.findByText('新篇目');
  fireEvent.click(screen.getByRole('button', { name: '选择回顾周期' }));
  fireEvent.change(screen.getByLabelText('选择月份'), { target: { value: '2020-01' } });
  fireEvent.submit(screen.getByLabelText('选择月份').closest('form')!);
  expect(await screen.findByText('旧篇目')).toBeInTheDocument();
  expect(screen.queryByText('新篇目')).not.toBeInTheDocument();
});

it.each([true, false].flatMap(reduced => ['周', '月', '年'].map(unit => ({ reduced, unit }))))('switches from the timeline to tags after selecting $unit (reduced motion: $reduced)', async ({ reduced, unit }) => {
  vi.mocked(useReducedMotion).mockReturnValue(reduced);
  render(<PeriodSidebar initial={{ unit: 'week', anchor: '2026-11-04' }} />);
  await screen.findByText('新篇目');
  fireEvent.click(screen.getByRole('button', { name: '时间' }));
  fireEvent.click(screen.getByRole('button', { name: unit }));
  const label = screen.getByRole('button', { name: '选择回顾周期' }).textContent;
  fireEvent.click(screen.getByRole('button', { name: '标签' }));
  expect(screen.getByRole('button', { name: '标签' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('region', { name: '2026-11-03 的笔记' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /#研究/ }));
  expect(await screen.findByText('新篇目')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '选择回顾周期' })).toHaveTextContent(label!);
  fireEvent.click(screen.getByRole('button', { name: '时间' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '查看全部标签' })).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole('region', { name: '2026-11-03 的笔记' })).toHaveTextContent('新篇目'));
});

it('keeps the selected tag when changing the period and updates the backend range', async () => {
  render(<PeriodSidebar />);
  await screen.findByText('新篇目');
  fireEvent.click(screen.getByRole('button', { name: '标签' }));
  fireEvent.click(await screen.findByRole('button', { name: /#研究/ }));
  await screen.findByText('新篇目');
  fireEvent.click(screen.getByRole('button', { name: '上一月' }));
  await waitFor(() => expect(invoke).toHaveBeenLastCalledWith('query_blocks_by_tag', { tag: '研究', startDate: '2026-10-01', endDate: '2026-10-31' }));
  expect(screen.getByRole('button', { name: '标签' })).toHaveAttribute('aria-pressed', 'true');
  expect(await screen.findByText('这个标签下还没有内容')).toBeInTheDocument();
});

it('groups a year into months and retains the return path while browsing months', async () => {
  render(<PeriodSidebar initial={{ unit: 'year', anchor: '2026-01-01' }} />);
  const month = await screen.findByRole('region', { name: '2026-11 的回顾' });
  expect(screen.queryByText('旧篇目')).not.toBeInTheDocument();
  fireEvent.click(within(month).getByRole('button', { name: '查看 11 月全部内容 →' }));
  expect(screen.getByRole('button', { name: '月' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '上一月' }));
  fireEvent.click(screen.getByRole('button', { name: '返回 2026 年' }));
  expect(await screen.findByRole('region', { name: '2026-11 的回顾' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '年' })).toHaveAttribute('aria-pressed', 'true');
});

it('restores the timeline position after visiting a tag', async () => {
  const view = render(<PeriodSidebar />);
  await screen.findByText('新篇目');
  fireEvent.scroll(view.container.querySelector('[data-recall-scroll]')!, { target: { scrollTop: 180 } });
  fireEvent.click(screen.getByRole('button', { name: '标签' }));
  fireEvent.click(await screen.findByRole('button', { name: /#研究/ }));
  await screen.findByText('新篇目');
  fireEvent.click(screen.getByRole('button', { name: '时间' }));
  await screen.findByRole('region', { name: '2026-11-03 的笔记' });
  expect(view.container.querySelector('[data-recall-scroll]')?.scrollTop).toBe(180);
});

it('expands a busy day in month view and retains expansion and scroll after reopening', async () => {
  const busyDays = [{ ...days[0], tags: [{ filename: '2026-11-03.md', tag: '研究', blocks: ['随记一', '随记二', '随记三', '随记四'] }] }];
  vi.mocked(invoke).mockImplementation(async command => command === 'get_timeline_data' ? busyDays : documents);
  const view = render(<PeriodSidebar />);
  await screen.findByText('新篇目');
  expect(screen.queryByText('随记四')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '查看当天其余 2 条内容' }));
  expect(screen.getByText('随记四')).toBeInTheDocument();
  const scroller = view.container.querySelector('[data-recall-scroll]')!;
  fireEvent.scroll(scroller, { target: { scrollTop: 240 } });
  fireEvent.click(screen.getByRole('button', { name: '关闭时间与标签侧栏' }));
  await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument());
  let resolve!: (value: RecallDay[]) => void;
  vi.mocked(invoke).mockImplementation(async command => command === 'get_timeline_data' ? new Promise<RecallDay[]>(done => { resolve = done; }) : documents);
  fireEvent.click(screen.getByRole('button', { name: '重新打开回顾' }));
  await screen.findByText('正在加载…');
  fireEvent.scroll(view.container.querySelector('[data-recall-scroll]')!, { target: { scrollTop: 0 } });
  resolve(busyDays);
  await screen.findByText('随记四');
  expect(view.container.querySelector('[data-recall-scroll]')?.scrollTop).toBe(240);
});

it('shows articles and tagged journal fragments together on their creation days', async () => {
  const select = vi.fn();
  const open = vi.fn();
  render(<TimelineSidebar {...props} onDateClick={open} onSelectResult={select} />);
  const today = await screen.findByRole('region', { name: '2026-11-03 的笔记' });
  const oldDay = screen.getByRole('region', { name: '2020-01-02 的笔记' });
  expect(within(today).getByText('新篇目')).toBeInTheDocument();
  expect(within(oldDay).getByText('旧篇目')).toBeInTheDocument();
  expect(within(today).queryByText('旧篇目')).not.toBeInTheDocument();
  fireEvent.click(within(today).getByRole('button', { name: '当日随记内容' }));
  expect(select).toHaveBeenCalledWith('2026-11-03_补记.md', '当日随记内容');
  fireEvent.click(within(oldDay).getByRole('button', { name: /旧篇目/ }));
  expect(open).toHaveBeenCalledWith('article-old.md');
});

it('keeps time and tags as the two primary views with a separate writing entry', async () => {
  render(<TimelineSidebar {...props} />);
  await screen.findByRole('region', { name: '2020-01-02 的笔记' });
  const views = within(screen.getByRole('group', { name: '回顾视角' }));
  expect(views.getAllByRole('button')).toHaveLength(2);
  expect(views.getByRole('button', { name: '时间' })).toHaveAttribute('aria-pressed', 'true');
  expect(views.getByRole('button', { name: '标签' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '浏览篇目' })).toHaveTextContent('继续写作');
});

it('opens recently modified articles for continuation while retaining creation sorting', async () => {
  render(<TimelineSidebar {...props} />);
  await screen.findByRole('region', { name: '2020-01-02 的笔记' });
  fireEvent.click(screen.getByRole('button', { name: '浏览篇目' }));
  const oldButton = await screen.findByRole('button', { name: /旧篇目.*修改于/ });
  const newButton = screen.getByRole('button', { name: /新篇目.*修改于/ });
  expect(oldButton.compareDocumentPosition(newButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(oldButton.title).toContain('创作：2020-01-02');
  expect(oldButton.title).toContain('最后修改：2026-11-04');
  expect(within(oldButton).queryByText(/创作于/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^创作时间$/ }));
  expect(newButton.compareDocumentPosition(oldButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(oldButton).getByText('创作于 2020-01-02')).toBeInTheDocument();
  expect(within(oldButton).queryByText(/修改于/)).not.toBeInTheDocument();
});

it('filters creation dates without leaving the selected tag and offers a clear way back', async () => {
  const jump = vi.fn();
  render(<TimelineSidebar {...props} onJumpTime={jump} />);
  await screen.findByRole('region', { name: '2020-01-02 的笔记' });
  fireEvent.click(screen.getByRole('button', { name: '标签' }));
  fireEvent.click(await screen.findByRole('button', { name: /#研究/ }));
  await screen.findByText('旧篇目');
  fireEvent.click(screen.getByRole('button', { name: '筛选创作时间' }));
  fireEvent.click(screen.getByRole('button', { name: '本月' }));
  expect(jump).toHaveBeenCalledWith('this-month');
  expect(screen.getByRole('button', { name: '标签' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('region', { name: '2020-01-02 的笔记' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '查看全部标签' }));
  expect(await screen.findByRole('button', { name: /#写作/ })).toBeInTheDocument();
});

it('separates untagged and literal default entries and keeps pinned reflection context stable', async () => {
  const context = vi.fn();
  const open = vi.fn();
  const untaggedDoc = { ...documents[0], filename: 'untagged.md', tags: [] };
  const literalDoc = { ...documents[0], filename: 'literal.md', tags: ['默认'] };
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === 'get_all_documents') return [untaggedDoc, literalDoc];
    if (command === 'get_timeline_data') return [{ date: '2020-01-02', articles: [], tags: [
      { filename: '2020-01-02.md', tag: '默认', is_untagged: true, blocks: ['plain'] },
      { filename: '2020-01-02.md', tag: '默认', is_untagged: false, blocks: ['literal'] },
    ] }];
    return [blocks[0]];
  });
  const view = render(<TimelineSidebar {...props} isPinned onReflectionContextChange={context} onOpenReflection={open} />);
  await screen.findByText('plain');
  fireEvent.click(screen.getByRole('button', { name: '标签' }));
  const unnamed = await screen.findByRole('button', { name: /^未命名的时刻\s*2$/ });
  expect(screen.getByRole('button', { name: /^#默认\s*2$/ })).toBeInTheDocument();
  fireEvent.click(unnamed);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('query_blocks_by_tag', { tag: '默认', untagged: true }));
  expect(context).toHaveBeenLastCalledWith({ kind: 'untagged' });
  fireEvent.click(await screen.findByRole('button', { name: '展开时光拾遗' }));
  expect(open).toHaveBeenLastCalledWith({ kind: 'untagged' });
  const calls = context.mock.calls.length;
  view.rerender(<TimelineSidebar {...props} isPinned reflectionOpen onReflectionContextChange={context} onOpenReflection={open} />);
  expect(context).toHaveBeenCalledTimes(calls);
  fireEvent.click(screen.getByRole('button', { name: '查看全部标签' }));
  fireEvent.click(await screen.findByRole('button', { name: /^#默认\s*2$/ }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('query_blocks_by_tag', { tag: '默认', untagged: false }));
  expect(context).toHaveBeenLastCalledWith({ kind: 'tag', tag: '默认' });
  view.rerender(<TimelineSidebar {...props} isPinned onReflectionContextChange={context} onOpenReflection={open} />);
  fireEvent.click(await screen.findByRole('button', { name: '展开时光拾遗' }));
  expect(open).toHaveBeenLastCalledWith({ kind: 'tag', tag: '默认' });
  fireEvent.click(screen.getByRole('button', { name: '查看全部标签' }));
  fireEvent.click(await screen.findByRole('button', { name: /^未命名的时刻\s*2$/ }));
  view.rerender(<TimelineSidebar {...props} isPinned externalForceTag="默认" onReflectionContextChange={context} onOpenReflection={open} />);
  await waitFor(() => expect(context).toHaveBeenLastCalledWith({ kind: 'tag', tag: '默认' }));
});

it('routes journal groups by the parsed flag, including legacy default fixtures', () => {
  const tag = vi.fn();
  render(<RecallTimeline days={[{ date: '2020-01-02', articles: [], tags: [
    { filename: '2020-01-02.md', tag: '默认', blocks: ['plain'], is_untagged: true },
    { filename: '2020-01-02.md', tag: '默认', blocks: ['literal'], is_untagged: false },
    { filename: '2020-01-02_legacy.md', tag: '默认', blocks: ['legacy'] },
    { filename: '2020-01-02_code.md', tag: 'code', blocks: ['code only'], is_untagged: true },
  ] }]} onTag={tag} onBrowseDate={vi.fn()} />);
  const unnamed = screen.getAllByRole('button', { name: '未命名的时刻' });
  expect(unnamed).toHaveLength(3);
  fireEvent.click(unnamed[0]);
  expect(tag).toHaveBeenLastCalledWith('默认', true);
  fireEvent.click(screen.getByRole('button', { name: '#默认' }));
  expect(tag).toHaveBeenLastCalledWith('默认', false);
  fireEvent.click(unnamed[1]);
  expect(tag).toHaveBeenLastCalledWith('默认', true);
  fireEvent.click(unnamed[2]);
  expect(tag).toHaveBeenLastCalledWith('code', true);
});

it('shows an untagged chip for articles with an empty actual tag list', () => {
  const tag = vi.fn();
  render(<ArticleCard article={{ ...old, tags: [], is_untagged: true }} onTag={tag} />);
  fireEvent.click(screen.getByRole('button', { name: '未命名的时刻' }));
  expect(tag).toHaveBeenCalledWith('默认', true);
});

it.each([true, false, undefined])('routes default article chips with is_untagged=%s', flag => {
  const tag = vi.fn();
  render(<ArticleCard article={{ ...old, tags: ['默认'], is_untagged: flag }} onTag={tag} />);
  const untagged = flag !== false;
  fireEvent.click(screen.getByRole('button', { name: untagged ? '未命名的时刻' : '#默认' }));
  expect(tag).toHaveBeenCalledWith('默认', untagged);
});

it('removes redundant tag-only preview lines while keeping inline tags and both exact timestamps available', () => {
  const content = '## 分析\n\n正文 #研究 中仍保留这个词。\n\n#研究 #写作';
  const article = { ...old, content };
  const open = vi.fn();
  const tag = vi.fn();
  render(<ArticleCard article={article} onOpen={open} onTag={tag} dateMode="none" />);
  const note = screen.getByRole('button', { name: /旧篇目/ });
  expect(note.querySelector('.recall-note-excerpt')?.textContent).toBe('分析\n\n正文 #研究 中仍保留这个词。');
  expect(note.querySelector('time')).toBeNull();
  expect(note.title).toContain('创作：2020-01-02');
  expect(note.title).toContain('最后修改：2026-11-04');
  fireEvent.click(screen.getByRole('button', { name: '#写作' }));
  expect(tag).toHaveBeenCalledWith('写作');
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(note);
  expect(open).toHaveBeenCalledWith('article-old.md');
  expect(article.content).toBe(content);
});

it('keeps a creation-date range across time, tag and article views and sends it to tag queries', async () => {
  const clear = vi.fn();
  const range = { start: '2026-11-01', end: '2026-11-30' };
  render(<TimelineSidebar {...props} recallRange={range} rangeLabel="本月" onClearRange={clear} isPinned />);
  await screen.findByRole('region', { name: '2026-11-03 的笔记' });
  expect(screen.queryByText('旧篇目')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^标签$/ }));
  fireEvent.click(await screen.findByRole('button', { name: /#研究/ }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('query_blocks_by_tag', { tag: '研究', startDate: range.start, endDate: range.end }));
  expect(await screen.findByText('新篇目')).toBeInTheDocument();
  expect(screen.queryByText('旧篇目')).not.toBeInTheDocument();
  expect(screen.getByText('本月')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '浏览篇目' }));
  expect(await screen.findByText(/修改于 2026-11-03/)).toBeInTheDocument();
  expect(screen.queryByText('旧篇目')).not.toBeInTheDocument();
  expect(clear).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '清除时间筛选' }));
  expect(clear).toHaveBeenCalledOnce();
});
