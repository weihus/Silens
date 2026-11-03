import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { TimelineSidebar } from './TimelineSidebar';
import { ArticleCard } from './RecallTimeline';
import type { Document, RecallArticle, RecallDay } from '../types';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
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
  expect(screen.getByText('创作时间 · 本月')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '浏览篇目' }));
  expect(await screen.findByText(/修改于 2026-11-03/)).toBeInTheDocument();
  expect(screen.queryByText('旧篇目')).not.toBeInTheDocument();
  expect(clear).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '清除时间筛选' }));
  expect(clear).toHaveBeenCalledOnce();
});
