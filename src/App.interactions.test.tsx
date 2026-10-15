import { useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import App from './App';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('./hooks/useAudio', () => ({ useAudio: vi.fn() }));
vi.mock('./utils/emptyLines', async importOriginal => ({
  ...await importOriginal<typeof import('./utils/emptyLines')>(),
  applyEncodedContent: vi.fn(),
}));
vi.mock('./components/Canvas', () => ({
  Canvas: function MockCanvas({ onEditorReady, disabled }: {
    onEditorReady: (editor: Editor) => void;
    disabled: boolean;
  }) {
    // Keep the editor identity stable across App updates, as the real Canvas does.
    const editor = useRef({ view: { dom: document.createElement('div') } });
    useEffect(() => {
      onEditorReady(editor.current as unknown as Editor);
    }, [onEditorReady]);
    return <textarea aria-label="笔记编辑器" disabled={disabled} />;
  },
}));

const ipc = vi.mocked(invoke);
const sidebarName = '时间与标签';

function shortcut(key: string, shiftKey = false) {
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key, code: `Key${key.toUpperCase()}`, metaKey: true, shiftKey,
  });
}

async function renderReadyApp() {
  render(<App />);
  await waitFor(() => expect(screen.getByRole('textbox', { name: '笔记编辑器' })).toBeEnabled());
}

async function expectNoSidebar() {
  await waitFor(() => expect(screen.queryByRole('complementary', { name: sidebarName })).not.toBeInTheDocument());
}

beforeEach(() => {
  localStorage.clear();
  ipc.mockReset();
  ipc.mockImplementation(async command => {
    if (command === 'load_document') return '';
    return [];
  });
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App overlay interactions', () => {
  it('reports an empty current week with a transient toast, without a persistent error alert', async () => {
    await renderReadyApp();
    fireEvent.click(screen.getByRole('button', { name: '搜索笔记' }));
    const search = await screen.findByRole('dialog', { name: '搜索笔记' });
    fireEvent.click(within(search).getByText('查看本周'));

    expect(await screen.findByText('本周还没有笔记')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '搜索笔记' })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText('本周还没有笔记')).not.toBeInTheDocument(), { timeout: 3000 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '笔记编辑器' })).toBeEnabled();
  }, 10000);

  it('keeps settings and search mutually exclusive in both directions', async () => {
    await renderReadyApp();
    fireEvent.click(screen.getByTitle('氛围设置 (⌘⇧M)'));
    expect(screen.getByRole('dialog', { name: '书写氛围' })).toBeInTheDocument();

    shortcut('k');
    expect(await screen.findByRole('dialog', { name: '搜索笔记' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '书写氛围' })).not.toBeInTheDocument();

    shortcut('m', true);
    expect(await screen.findByRole('dialog', { name: '书写氛围' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '搜索笔记' })).not.toBeInTheDocument());
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('temporarily hides a pinned sidebar during search and restores its pin on close', async () => {
    await renderReadyApp();
    fireEvent.click(screen.getByRole('button', { name: '回顾笔记' }));
    const sidebar = await screen.findByRole('complementary', { name: sidebarName });
    fireEvent.click(within(sidebar).getByRole('button', { name: '固定侧栏' }));
    expect(screen.getByRole('button', { name: '取消固定侧栏' })).toHaveAttribute('aria-pressed', 'true');

    shortcut('k');
    const search = await screen.findByRole('dialog', { name: '搜索笔记' });
    await expectNoSidebar();
    fireEvent.keyDown(search, { key: 'Escape' });

    const restored = await screen.findByRole('complementary', { name: sidebarName });
    expect(within(restored).getByRole('button', { name: '取消固定侧栏' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '搜索笔记' })).not.toBeInTheDocument());
  });

  it('hides an existing error during export and blocks Cmd+K and Cmd+L without deferred toggles', async () => {
    ipc.mockImplementation(async command => {
      if (command === 'load_document') throw new Error('Storage unavailable');
      return [];
    });
    render(<App />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('无法读取笔记');
    fireEvent.click(within(alert).getByRole('button', { name: '导出当前文字' }));
    expect(await screen.findByRole('dialog', { name: '导出' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    for (const key of ['k', 'l']) {
      shortcut(key);
      expect(screen.getByRole('dialog', { name: '导出' })).toBeInTheDocument();
      expect(screen.queryByRole('dialog', { name: '搜索笔记' })).not.toBeInTheDocument();
      expect(screen.queryByRole('complementary', { name: sidebarName })).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole('button', { name: '关闭导出' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取笔记');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await expectNoSidebar();
    // The shortcuts resume working after the modal closes.
    shortcut('l');
    expect(await screen.findByRole('complementary', { name: sidebarName })).toBeInTheDocument();
  });

  it('keeps the unpinned sidebar open when the pointer leaves until explicitly closed', async () => {
    await renderReadyApp();
    fireEvent.click(screen.getByRole('button', { name: '回顾笔记' }));
    const sidebar = await screen.findByRole('complementary', { name: sidebarName });
    fireEvent.mouseLeave(sidebar.parentElement!);
    expect(sidebar).toBeInTheDocument();
    fireEvent.click(within(sidebar).getByRole('button', { name: '关闭时间与标签侧栏' }));
    await expectNoSidebar();
  });

  it('closes a pinned sidebar with Escape and clears the pin when reopened', async () => {
    await renderReadyApp();
    shortcut('l');
    const sidebar = await screen.findByRole('complementary', { name: sidebarName });
    fireEvent.click(within(sidebar).getByRole('button', { name: '固定侧栏' }));

    fireEvent.keyDown(screen.getByRole('textbox', { name: '笔记编辑器' }), { key: 'Escape' });
    await expectNoSidebar();
    shortcut('l');
    const reopened = await screen.findByRole('complementary', { name: sidebarName });
    expect(within(reopened).getByRole('button', { name: '固定侧栏' })).toHaveAttribute('aria-pressed', 'false');
  });
});
