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
