import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { Editor } from '@tiptap/core';
import type { PeriodReflectionResult, ReflectionQuery } from './types';
import { calendarDate } from './utils/recall';
import App from './App';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('./hooks/useAudio', () => ({ useAudio: vi.fn() }));

const today = () => calendarDate(Date.now() / 1000);
let files: Map<string, string>;

function reflection(query: ReflectionQuery): PeriodReflectionResult {
  return {
    query: { startDate: query.startDate ?? null, endDate: query.endDate ?? null, perspective: query.perspective ?? { kind: 'all' }, pageSeed: query.pageSeed ?? 0 },
    overview: { activeDaysCount: 1, dailyBlocksCount: 1, titledArticlesCount: 0, favoriteTimeBucket: null, richestDay: null },
    themes: { topTags: [{ tag: '读书', count: 2 }], untaggedBlocksCount: 1, totalDistinctWorksCount: 0, deepWorks: [] },
    articles: { longestBrewed: [], mostReferenced: [] },
    sampledQuotes: [{ blockId: 8, filename: '2026-05-03_旧.md', date: '2026-05-03', content: '旧日里安静的一句话。', tags: [], slot: 'untaggedMoment', contextAnchor: { text: '安静的一句话', occurrence: 1 } }],
  };
}

async function handleInvoke(command: string, args?: unknown): Promise<unknown> {
  const input = args as { filename?: string; currentFilename?: string; content?: string; query?: ReflectionQuery };
  if (command === 'load_document') {
    if (!files.has(input.filename!)) throw 'DOCUMENT_NOT_FOUND';
    return files.get(input.filename!);
  }
  if (command === 'save_document') {
    files.set(input.currentFilename!, input.content!);
    return input.currentFilename;
  }
  if (command === 'get_period_reflection') return reflection(input.query!);
  if (command === 'query_blocks_by_tag') return [{ id: 1, date: today(), filename: `${today()}.md`, content: '读书的片段', tag: '读书', created: 0, modified: 0 }];
  if (command === 'get_all_documents') return [];
  if (command === 'get_timeline_data') return [{ date: today(), tags: [{ tag: '读书', filename: `${today()}.md`, blocks: ['读书的片段'] }], articles: [] }];
  return [];
}

beforeEach(() => {
  localStorage.clear();
  files = new Map([[`${today()}.md`, '安静书写。\n\n还有一句话。'], ['2026-05-03_旧.md', '安静的一句话\n\n安静的一句话']]);
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(handleInvoke as typeof invoke);
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('prefers-reduced-motion'), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  Element.prototype.scrollIntoView = vi.fn();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function ready() {
  render(<App />);
  await waitFor(() => expect(screen.queryByText('加载中')).not.toBeInTheDocument());
  const body = screen.getByRole('textbox', { name: '笔记正文' }) as HTMLElement & { editor: Editor };
  await waitFor(() => expect(body.textContent).toContain('安静书写'));
  return body;
}

async function openFromCommand() {
  fireEvent.click(screen.getByRole('button', { name: '搜索笔记' }));
  const palette = await screen.findByRole('dialog', { name: '搜索笔记' });
  fireEvent.click(within(palette).getByRole('button', { name: '时光拾遗（周期回顾）' }));
  return screen.findByRole('dialog', { name: '时光拾遗' });
}

it('preserves the real editor, document, cursor, undo and scroll through opening and closing', async () => {
  const body = await ready();
  const editor = body.editor;
  expect(editor).toBeDefined();
  act(() => { editor.commands.focus(); editor.commands.setTextSelection(3); editor.commands.insertContent('新句'); });
  const content = editor.getJSON();
  const selection = editor.state.selection.toJSON();
  const canUndo = editor.can().undo();
  const scroller = document.getElementById('silens-scroll-container')!;
  scroller.scrollTop = 147;
  const loads = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'load_document').length;
  const scroll = await openFromCommand();
  await waitFor(() => expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'get_period_reflection')).toBe(true));
  const commands = vi.mocked(invoke).mock.calls.map(([command]) => command);
  expect(commands.indexOf('save_document')).toBeLessThan(commands.indexOf('get_period_reflection'));
  expect(document.querySelector('[aria-label="笔记正文"]')).toBe(body);
  expect(editor.getJSON()).toEqual(content);
  expect(editor.state.selection.toJSON()).toEqual(selection);
  fireEvent.keyDown(scroll, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '时光拾遗' })).not.toBeInTheDocument());
  expect(screen.getByRole('textbox', { name: '笔记正文' })).toBe(body);
  expect(body.editor).toBe(editor);
  expect(editor.getJSON()).toEqual(content);
  expect(editor.state.selection.toJSON()).toEqual(selection);
  expect(editor.can().undo()).toBe(canUndo);
  expect(scroller.scrollTop).toBe(147);
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'load_document')).toHaveLength(loads);
}, 15000);

it.each(['sidebar', 'title'])('returns from an empty period to the current body after opening from %s', async source => {
  vi.mocked(invoke).mockImplementation(((command: string, args?: unknown) => {
    if (command === 'get_period_reflection') {
      const result = reflection((args as { query: ReflectionQuery }).query);
      return Promise.resolve({ ...result,
        overview: { activeDaysCount: 0, dailyBlocksCount: 0, titledArticlesCount: 0, favoriteTimeBucket: null, richestDay: null },
        themes: { topTags: [], untaggedBlocksCount: 0, totalDistinctWorksCount: 0, deepWorks: [] }, sampledQuotes: [],
      });
    }
    return handleInvoke(command, args);
  }) as typeof invoke);
  const body = await ready(); const editor = body.editor;
  if (source === 'title') {
    fireEvent.click(screen.getByRole('button', { name: '搜索笔记' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '搜索笔记' })).getByRole('button', { name: '新建篇目' }));
    const title = await screen.findByRole('textbox', { name: '篇目标题' });
    fireEvent.change(title, { target: { value: '留在这篇文章' } });
    act(() => title.focus());
  } else {
    act(() => { editor.commands.focus(); editor.commands.setTextSelection(3); editor.commands.insertContent('仍在书写'); });
  }
  const doc = editor.getJSON(); const selection = editor.state.selection.toJSON(); const undo = editor.can().undo();
  const scroller = document.getElementById('silens-scroll-container')!; scroller.scrollTop = 81;
  const loads = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'load_document').length;
  const settings = screen.getByRole('button', { name: '书写氛围' });
  if (source === 'sidebar') {
    fireEvent.click(screen.getByRole('button', { name: '回顾笔记' }));
    const sidebar = await screen.findByRole('complementary', { name: '时间与标签' });
    const entry = await within(sidebar).findByRole('button', { name: '展开时光拾遗' });
    act(() => entry.focus()); fireEvent.click(entry);
  } else await openFromCommand();
  const action = await screen.findByRole('button', { name: '回到今日落笔 →' });
  expect(settings).toHaveStyle({ visibility: 'hidden' });
  expect(document.querySelector('.chrome-footer')).toHaveStyle({ visibility: 'hidden' });
  fireEvent.click(action);
  await waitFor(() => expect(document.activeElement).toBe(body));
  expect(screen.getByRole('textbox', { name: '笔记正文' })).toBe(body);
  expect(editor.getJSON()).toEqual(doc); expect(editor.state.selection.toJSON()).toEqual(selection);
  expect(editor.can().undo()).toBe(undo); expect(scroller.scrollTop).toBe(81);
  expect(settings.style.visibility).toBe('');
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'load_document')).toHaveLength(loads);
}, 15000);

it('does not query before a pending save and does not reopen after preparation is canceled', async () => {
  let finish!: (filename: string) => void;
  vi.mocked(invoke).mockImplementation(((command: string, args?: unknown) => command === 'save_document'
    ? new Promise<string>(resolve => { finish = resolve; }) : handleInvoke(command, args)) as typeof invoke);
  const body = await ready();
  act(() => { body.editor.commands.insertContent('未保存'); });
  const scroll = await openFromCommand();
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'get_period_reflection')).toBe(false);
  fireEvent.keyDown(scroll, { key: 'Escape' });
  await act(async () => { finish(`${today()}.md`); });
  expect(screen.queryByRole('dialog', { name: '时光拾遗' })).not.toBeInTheDocument();
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'get_period_reflection')).toBe(false);
  expect(body.textContent).toContain('未保存');
});

it('keeps the draft visible and skips reflection IPC when saving fails', async () => {
  vi.mocked(invoke).mockImplementation(((command: string, args?: unknown) => command === 'save_document'
    ? Promise.reject('DOCUMENT_CONFLICT') : handleInvoke(command, args)) as typeof invoke);
  const body = await ready();
  act(() => { body.editor.commands.insertContent('保留草稿'); });
  await openFromCommand();
  await waitFor(() => expect(screen.getAllByRole('alert').some(alert => /保存|修改|草稿/.test(alert.textContent ?? ''))).toBe(true));
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'get_period_reflection')).toBe(false);
  expect(body.textContent).toContain('保留草稿');
});

it('uses pinned sidebar dates and tag context, while syncing date controls in both directions', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: '回顾笔记' }));
  const sidebar = await screen.findByRole('complementary', { name: '时间与标签' });
  fireEvent.click(within(sidebar).getByRole('button', { name: '固定侧栏' }));
  fireEvent.click(within(sidebar).getByRole('button', { name: '标签' }));
  await waitFor(() => expect(Array.from(sidebar.querySelectorAll('button')).map(button => button.textContent)).toContain('#读书1'));
  fireEvent.click(within(sidebar).getByRole('button', { name: /^#读书\s*1$/ }));
  await waitFor(() => expect(sidebar.querySelector('.recall-tag-heading')).toHaveTextContent('#读书'));
  fireEvent.click(await within(sidebar).findByRole('button', { name: '展开时光拾遗' }));
  const scroll = await screen.findByRole('dialog', { name: '时光拾遗' });
  await waitFor(() => expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'get_period_reflection')
    .map(([, args]) => (args as { query: ReflectionQuery }).query.perspective)).toContainEqual({ kind: 'tag', tag: '读书' }));
  expect(scroll).toHaveAttribute('aria-modal', 'false');
  expect(sidebar).toBeInTheDocument();
  fireEvent.click(within(sidebar).getByRole('button', { name: '上一月' }));
  const label = within(sidebar).getByRole('button', { name: '选择回顾周期' }).textContent;
  await waitFor(() => {
    const calls = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'get_period_reflection');
    expect(calls.some(([, args]) => label?.includes((args as {query: ReflectionQuery}).query.startDate?.slice(0, 4) ?? 'never'))).toBe(true);
  });
  fireEvent.click(within(scroll).getByRole('button', { name: '全部时光' }));
  await waitFor(() => expect(within(sidebar).queryByText(/创作时间 ·/)).not.toBeInTheDocument());
});

it('restores an article title selection without replacing the body editor', async () => {
  const body = await ready();
  fireEvent.click(screen.getByRole('button', { name: '搜索笔记' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '搜索笔记' })).getByRole('button', { name: '新建篇目' }));
  const title = await screen.findByRole('textbox', { name: '篇目标题' }) as HTMLTextAreaElement;
  fireEvent.change(title, { target: { value: '一篇正在慢慢写的文章' } });
  act(() => { title.focus(); title.setSelectionRange(2, 6, 'backward'); });
  const editor = body.editor;
  const content = editor.getJSON();
  const scroll = await openFromCommand();
  fireEvent.keyDown(scroll, { key: 'Escape' });
  await waitFor(() => expect(document.activeElement).toBe(title));
  expect([title.selectionStart, title.selectionEnd, title.selectionDirection]).toEqual([2, 6, 'backward']);
  expect(title.value).toBe('一篇正在慢慢写的文章');
  expect(screen.getByRole('textbox', { name: '笔记正文' })).toBe(body);
  expect(body.editor).toBe(editor);
  expect(editor.getJSON()).toEqual(content);
});

it('does not commit a delayed reflection navigation after entering focus mode', async () => {
  let complete!: (content: string) => void;
  vi.mocked(invoke).mockImplementation(((command: string, args?: unknown) => {
    if (command === 'load_document' && (args as {filename: string}).filename === '2026-05-03_旧.md') {
      return new Promise<string>(resolve => { complete = resolve; });
    }
    return handleInvoke(command, args);
  }) as typeof invoke);
  const body = await ready();
  const content = body.editor.getJSON();
  await openFromCommand();
  const card = await screen.findByRole('button', { name: /回到未命名的瞬间/ });
  await waitFor(() => expect(card).toBeEnabled());
  fireEvent.click(card);
  await waitFor(() => expect(complete).toBeTypeOf('function'));
  fireEvent.keyDown(document.body, { key: 'F', code: 'KeyF', metaKey: true, shiftKey: true });
  await act(async () => { complete('迟到的另一篇文字'); });
  expect(screen.queryByRole('dialog', { name: '时光拾遗' })).not.toBeInTheDocument();
  expect(body.editor.getJSON()).toEqual(content);
  expect(body.textContent).not.toContain('迟到的另一篇文字');
});

it('hides the scroll and its entries immediately when entering focus mode', async () => {
  await ready();
  await openFromCommand();
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'F', code: 'KeyF', metaKey: true, shiftKey: true });
  expect(screen.queryByRole('dialog', { name: '时光拾遗' })).not.toBeInTheDocument();
  fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK', metaKey: true });
  const palette = await screen.findByRole('dialog', { name: '搜索笔记' });
  expect(within(palette).queryByRole('button', { name: '时光拾遗（周期回顾）' })).not.toBeInTheDocument();
});
