// @vitest-environment jsdom
import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { CommandPalette, type SearchResult } from './CommandPalette';
import { ExportDialog } from './ExportDialog';
import { AtmospherePanel } from './AtmospherePanel';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const themeConfig = { bg: '#fff', text: '#000', muted: '#888' };
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });

it('clears old search results immediately and ignores requests resolved after closing', async () => {
  const first = deferred<SearchResult[]>();
  const second = deferred<SearchResult[]>();
  vi.mocked(invoke).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const close = vi.fn();
  const view = render(<CommandPalette open onOpenChange={close} />);
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'first' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  await act(async () => { first.resolve([{ id: '1', date: '2026-10-15', snippet: 'old result', context_preview: 'preview' }]); });
  expect(screen.getByText('old result')).toBeTruthy();
  fireEvent.change(input, { target: { value: 'second' } });
  expect(screen.queryByText('old result')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  view.rerender(<CommandPalette open={false} onOpenChange={close} />);
  await act(async () => { second.resolve([{ id: '2', date: '2026-10-14', snippet: 'stale result', context_preview: 'stale preview' }]); });
  expect(screen.queryByText('stale result')).toBeNull();
  view.rerender(<CommandPalette open onOpenChange={close} />);
  expect(screen.queryByText('正在搜索…')).toBeNull();
});

it('shows four quick action buttons without an empty preview and preserves keyboard navigation', () => {
  const jump = vi.fn();
  const close = vi.fn();
  render(<CommandPalette open onOpenChange={close} onQuickJump={jump} />);
  expect(screen.queryByRole('region', { name: '笔记预览' })).toBeNull();
  expect(screen.getAllByText('按时间回顾')).toHaveLength(1);
  expect(screen.queryByText('时光穿梭')).toBeNull();
  expect(screen.getAllByRole('button')).toHaveLength(4);
  for (const label of ['跳转到昨天', '查看本周', '查看本月', '自定义日期...']) {
    expect(screen.getByRole('button', { name: label })).toBeTruthy();
  }
  const input = screen.getByRole('textbox');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(jump).toHaveBeenCalledWith('this-week');
  expect(close).toHaveBeenCalledWith(false);
});

it.each([
  ['跳转到昨天', 'yesterday'],
  ['查看本周', 'this-week'],
  ['查看本月', 'this-month'],
])('preserves the %s quick action button', (label, preset) => {
  const jump = vi.fn();
  const close = vi.fn();
  render(<CommandPalette open onOpenChange={close} onQuickJump={jump} />);
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(jump).toHaveBeenCalledWith(preset);
  expect(close).toHaveBeenCalledWith(false);
});

it('shows preview only for results and preserves result keyboard selection', async () => {
  vi.mocked(invoke).mockResolvedValue([
    { id: '1', date: '2026-10-15', snippet: 'first note', context_preview: 'first preview' },
    { id: '2', date: '2026-10-14', snippet: 'second note', context_preview: 'second preview' },
  ]);
  const select = vi.fn();
  const close = vi.fn();
  render(<CommandPalette open onOpenChange={close} onSelectResult={select} />);
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'note' } });
  expect(screen.getByRole('status').textContent).toBe('正在搜索…');
  expect(screen.queryByRole('region', { name: '笔记预览' })).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(screen.getByRole('region', { name: '笔记预览' }).textContent).toContain('first preview');
  expect(screen.getByRole('button', { name: /first note/ })).toBeTruthy();
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(screen.getByRole('region', { name: '笔记预览' }).textContent).toContain('second preview');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(select).toHaveBeenCalledWith('2026-10-14', 'note');
  expect(close).toHaveBeenCalledWith(false);
  expect(screen.queryByRole('region', { name: '笔记预览' })).toBeNull();
});

it('keeps no-results search free of a preview', async () => {
  vi.mocked(invoke).mockResolvedValue([]);
  render(<CommandPalette open onOpenChange={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'missing' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(screen.getByRole('status').textContent).toBe('未找到相关内容');
  expect(screen.queryByRole('region', { name: '笔记预览' })).toBeNull();
});

it('closes from a date field with Escape and never schedules a submitted close', async () => {
  const close = vi.fn();
  const jump = vi.fn();
  render(<CommandPalette open onOpenChange={close} onQuickJump={jump} />);
  fireEvent.click(screen.getByText('自定义日期...'));
  const inputs = screen.getAllByRole('textbox');
  inputs[1].focus();
  fireEvent.keyDown(inputs[1], { key: 'Escape', isComposing: true });
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(inputs[1], { key: 'Escape' });
  expect(close).toHaveBeenCalledWith(false);
  close.mockClear();
  fireEvent.click(screen.getByText('穿梭 →'));
  expect(jump).toHaveBeenCalledOnce();
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(close).not.toHaveBeenCalled();
});

it.each(['cancel', 'success', 'failure'] as const)('blocks dismissal and edits during export, then releases busy state on %s', async outcome => {
  const pending = deferred<string | null>();
  vi.mocked(save).mockReturnValue(pending.promise);
  if (outcome === 'failure') vi.mocked(writeFile).mockRejectedValue(new Error('write failed'));
  const close = vi.fn();
  const busy = vi.fn();
  render(<ExportDialog open onClose={close} onBusyChange={busy} theme="paper" themeConfig={themeConfig} exportContent={() => 'content'} filename="note.md" />);
  const input = screen.getByRole('textbox');
  expect(document.activeElement).toBe(input);
  fireEvent.click(screen.getByRole('button', { name: '导出为 Markdown' }));
  expect(busy).toHaveBeenLastCalledWith(true);
  expect((input as HTMLInputElement).disabled).toBe(true);
  for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(screen.getByRole('dialog').parentElement!);
  fireEvent.click(screen.getByRole('button', { name: '关闭导出' }));
  expect(close).not.toHaveBeenCalled();
  await act(async () => { pending.resolve(outcome === 'cancel' ? null : '/tmp/note.md'); });
  expect(busy.mock.calls).toEqual([[true], [false]]);
  expect((input as HTMLInputElement).disabled).toBe(false);
  expect(close).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 0);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(close).toHaveBeenCalledTimes(outcome === 'success' ? 2 : 1);
});

it('composes the atmosphere ref without resetting focus on rerender', () => {
  const ref = createRef<HTMLDivElement>();
  const toggle = vi.fn();
  const props = { open: true, ref, panelBtnRef: createRef<HTMLButtonElement>(), onToggle: toggle, onExport: vi.fn(), storageBusy: false, atmosphere: { theme: 'paper' as const, sound: 'none' as const, volume: 0.5, autoSync: false }, onChange: vi.fn(), themeConfig, activeTheme: 'paper' as const, focusDuration: 25, onFocusDurationChange: vi.fn() };
  const view = render(<AtmospherePanel {...props} />);
  expect(ref.current).toBe(screen.getByRole('dialog'));
  const theme = screen.getByRole('button', { name: '纸白' });
  theme.focus();
  view.rerender(<AtmospherePanel {...props} focusDuration={45} />);
  expect(document.activeElement).toBe(theme);
  fireEvent.keyDown(theme, { key: 'Escape' });
  expect(toggle).toHaveBeenCalledOnce();
  view.unmount();
  expect(ref.current).toBeNull();
});
