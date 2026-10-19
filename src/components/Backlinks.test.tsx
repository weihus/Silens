import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { Backlinks } from './Backlinks';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const ipc = vi.mocked(invoke);
const links = [
  { filename: '2026-10-19.md', snippet: '今天继续 [[灵感]]', search_text: '[[灵感]]', occurrence: 0 },
  { filename: '2026-10-18.md', snippet: '回到 [[灵感.md]]', search_text: '[[灵感.md]]', occurrence: 0 },
];

beforeEach(() => ipc.mockReset());
afterEach(cleanup);

describe('Backlinks', () => {
  it('starts collapsed and navigates with the exact source filename and link', async () => {
    ipc.mockResolvedValue(links);
    const navigate = vi.fn();
    render(<Backlinks filename="灵感.md" revision={0} onNavigate={navigate} />);
    const summary = await screen.findByText('被 2 篇笔记引用');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    fireEvent.click(summary);
    fireEvent.click(screen.getByRole('button', { name: /2026-10-19/ }));
    expect(navigate).toHaveBeenCalledWith('2026-10-19.md', { text: '[[灵感]]', occurrence: 0 });
  });

  it('stays absent without references and refreshes on saves and window focus', async () => {
    ipc.mockResolvedValue([]);
    const props = { filename: '灵感.md', revision: 0, onNavigate: vi.fn() };
    const view = render(<Backlinks {...props} />);
    await waitFor(() => expect(ipc).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('region', { name: '反向链接' })).not.toBeInTheDocument();
    ipc.mockResolvedValue(links);
    view.rerender(<Backlinks {...props} revision={1} />);
    await screen.findByText('被 2 篇笔记引用');
    ipc.mockResolvedValue([]);
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(screen.queryByText('被 2 篇笔记引用')).not.toBeInTheDocument());
  });

  it('discards responses from an old revision and after unmount', async () => {
    let finish!: (value: typeof links) => void;
    ipc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const props = { filename: '灵感.md', revision: 0, onNavigate: vi.fn() };
    const view = render(<Backlinks {...props} />);
    ipc.mockResolvedValue([]);
    view.rerender(<Backlinks {...props} revision={1} />);
    await act(async () => finish(links));
    expect(screen.queryByText('被 2 篇笔记引用')).not.toBeInTheDocument();
    view.unmount();
    const calls = ipc.mock.calls.length;
    fireEvent(window, new Event('focus'));
    expect(ipc).toHaveBeenCalledTimes(calls);
  });

  it('offers retry after failure instead of claiming there are no references', async () => {
    ipc.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(links);
    render(<Backlinks filename="灵感.md" revision={0} onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '引用暂时无法读取，点击重试' }));
    await screen.findByText('被 2 篇笔记引用');
  });
});
