import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import App from './App';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('./hooks/useAudio', () => ({ useAudio: vi.fn() }));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  Element.prototype.scrollIntoView = vi.fn();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('creates an article through the real canvas and flushes title and body before returning to today', async () => {
  const files = new Map<string, string>();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const input = args as { filename?: string; currentFilename?: string; content?: string; expectedContent?: string | null };
    if (command === 'load_document') {
      if (!files.has(input.filename!)) throw 'DOCUMENT_NOT_FOUND';
      return files.get(input.filename!);
    }
    if (command === 'save_document') {
      expect(input.expectedContent).toBe(files.get(input.currentFilename!) ?? null);
      files.set(input.currentFilename!, input.content!);
      return input.currentFilename;
    }
    if (command === 'get_all_documents') return Array.from(files, ([filename, content]) => ({ filename, content, modified: 1 }));
    return [];
  });
  render(<App />);
  await waitFor(() => expect(screen.queryByText('加载中')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /^搜索笔记$/ }));
  const palette = screen.getByRole('dialog', { name: '搜索笔记' });
  fireEvent.click(within(palette).getByRole('button', { name: '新建篇目' }));
  const title = await screen.findByRole('textbox', { name: '篇目标题' });
  fireEvent.change(title, { target: { value: '持续思考' } });
  fireEvent.keyDown(title, { key: 'Enter' });
  const body = screen.getByRole('textbox', { name: '笔记正文' });
  await waitFor(() => expect(document.activeElement).toBe(body));
  act(() => {
    body.textContent = '正文内容';
    fireEvent.input(body);
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: '回到今天' }));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: '篇目标题' })).not.toBeInTheDocument());
  const article = Array.from(files).find(([filename]) => filename.startsWith('article-'));
  expect(article).toBeDefined();
  expect(article![1]).toBe('# 持续思考\n\n正文内容');
  expect(screen.getByRole('textbox', { name: '笔记正文' }).textContent).toBe('');
}, 15000);

it.each([false, true])('expands a journal selection once and preserves its source (write failure: %s)', async fail => {
  const source = '今天想到一个问题。';
  const writes = new Map<string, string>();
  let attempts = 0;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const input = args as { filename: string; currentFilename: string; content: string };
    if (command === 'load_document') return writes.get(input.filename) ?? source;
    if (command === 'save_document') {
      if (input.currentFilename.startsWith('article-')) {
        attempts++;
        if (fail) throw new Error('目录只读');
      }
      writes.set(input.currentFilename, input.content);
      return input.currentFilename;
    }
    return [];
  });
  render(<App />);
  const body = await screen.findByRole('textbox', { name: '笔记正文' });
  await waitFor(() => expect(body).toHaveTextContent(source));
  const editor = (body as HTMLElement & { editor: import('@tiptap/react').Editor }).editor;
  act(() => { editor.commands.setTextSelection({ from: 3, to: 5 }); });
  fireEvent.click(screen.getByRole('button', { name: /^搜索笔记$/ }));
  const expand = await screen.findByRole('button', { name: '展开为篇目' });
  act(() => { expand.click(); expand.click(); });
  if (fail) {
    expect(await screen.findByRole('alert')).toHaveTextContent('目录只读');
    expect(writes.size).toBe(0);
    expect(body).toHaveTextContent(source);
  } else {
    await screen.findByRole('textbox', { name: '篇目标题' });
    const article = [...writes].find(([filename]) => filename.startsWith('article-'))!;
    expect(article[1]).toBe('# \n\n想到');
    const journal = [...writes].find(([filename]) => !filename.startsWith('article-'))!;
    expect(journal[1]).toContain(source);
    expect(journal[1]).toContain(`[[${article[0].slice(0, -3)}|展开的篇目]]`);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '回到今天' }));
    await waitFor(() => expect(body.querySelector('[data-doc-name]')).toHaveAttribute('data-doc-name', article[0].slice(0, -3)));
  }
  expect(attempts).toBe(1);
}, 15000);

it('retries the folder operation that failed', async () => {
  let attempts = 0;
  vi.mocked(invoke).mockImplementation(async command => {
    if (command === 'load_document') return '';
    if (command === 'open_storage_folder' && ++attempts === 1) throw '目录不可用';
    return [];
  });
  render(<App />);
  await screen.findByRole('textbox', { name: '笔记正文' });
  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  fireEvent.click(screen.getByText('笔记与备份'));
  fireEvent.click(screen.getByRole('button', { name: '打开笔记文件夹' }));
  fireEvent.click(await screen.findByRole('button', { name: '重新打开文件夹' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(attempts).toBe(2);
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'save_document')).toBe(false);
});

it('opens a recently modified article directly from the empty palette', async () => {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'recent_articles') return [['older.md', '去年的草稿']];
    if (command === 'load_document') return (args as { filename: string }).filename === 'older.md' ? '# 去年的草稿\n\n继续思考' : '';
    return [];
  });
  render(<App />);
  await screen.findByRole('textbox', { name: '笔记正文' });
  fireEvent.click(screen.getByRole('button', { name: /^搜索笔记$/ }));
  fireEvent.click(await screen.findByRole('button', { name: '继续写作 · 去年的草稿' }));
  expect(await screen.findByRole('textbox', { name: '篇目标题' })).toHaveValue('去年的草稿');
});
