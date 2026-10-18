import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { UpdateManager } from './UpdateManager';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '1.1.0' }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));

const calls: string[] = [];
const prepare = vi.fn(async () => { calls.push('save-and-backup'); });
const busy = vi.fn();
const close = vi.fn();
const download = vi.fn(async () => { calls.push('download'); });
const install = vi.fn(async () => { calls.push('install'); });
const release = { version: '1.2.0', body: '更安静的书写体验', download, install, close: vi.fn(async () => {}) };
function view(open = true) {
  return render(<UpdateManager open={open} onOpenChange={close} canNotify blocked={false} onBusyChange={busy} prepareToInstall={prepare} />);
}

beforeEach(() => {
  vi.resetAllMocks();
  calls.length = 0;
  release.close.mockResolvedValue(undefined);
  prepare.mockImplementation(async () => { calls.push('save-and-backup'); });
  download.mockImplementation(async () => { calls.push('download'); });
  install.mockImplementation(async () => { calls.push('install'); });
  vi.mocked(check).mockResolvedValue(release as unknown as Update);
  vi.mocked(relaunch).mockImplementation(async () => { calls.push('relaunch'); });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('checks automatically without opening a dialog or downloading, and permits dismissing the notice', async () => {
  vi.useFakeTimers();
  view(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(check).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /1.2.0 可更新/ })).toBeInTheDocument();
  expect(download).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '稍后提醒更新' }));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('saves and backs up after download and before installation and relaunch', async () => {
  view();
  fireEvent.click(await screen.findByRole('button', { name: '下载并重启' }));
  await waitFor(() => expect(relaunch).toHaveBeenCalledOnce());
  expect(calls).toEqual(['download', 'save-and-backup', 'install', 'relaunch']);
  expect(busy.mock.calls).toEqual([[true], [false]]);
});

it('blocks installation if saving or backup fails and allows retry', async () => {
  prepare.mockRejectedValueOnce(new Error('DOCUMENT_CONFLICT'));
  view();
  fireEvent.click(await screen.findByRole('button', { name: '下载并重启' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('更新未完成');
  expect(install).not.toHaveBeenCalled();
  expect(relaunch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '下载并重启' }));
  await waitFor(() => expect(install).toHaveBeenCalledOnce());
});

it('keeps the dialog open and blocks dismissal during an active download', async () => {
  let finish!: () => void;
  download.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  view();
  fireEvent.click(await screen.findByRole('button', { name: '下载并重启' }));
  expect(screen.getByRole('button', { name: '关闭软件更新' })).toBeDisabled();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
  await act(async () => { finish(); });
  await waitFor(() => expect(relaunch).toHaveBeenCalledOnce());
});

it('reports network failure and retries a check', async () => {
  vi.mocked(check).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(null);
  view();
  expect(await screen.findByRole('alert')).toHaveTextContent('检查网络');
  fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
  expect(await screen.findByText('已是最新版本，安心书写吧。')).toBeInTheDocument();
});

it('explains manual upgrades for DEB installations instead of offering an AppImage', async () => {
  vi.mocked(check).mockRejectedValueOnce(new Error('None of the updater targets matched: linux-x86_64-deb, linux-x86_64'));
  view();
  expect(await screen.findByRole('alert')).toHaveTextContent('DEB 安装暂不支持应用内更新');
  expect(screen.queryByRole('button', { name: '下载并重启' })).not.toBeInTheDocument();
});

it('retries relaunch without reinstalling an already installed update', async () => {
  vi.mocked(relaunch).mockRejectedValueOnce(new Error('restart failed'));
  view();
  fireEvent.click(await screen.findByRole('button', { name: '下载并重启' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('新版本已安装');
  fireEvent.click(screen.getByRole('button', { name: '重启 Silens' }));
  await waitFor(() => expect(relaunch).toHaveBeenCalledTimes(2));
  expect(install).toHaveBeenCalledOnce();
  expect(prepare).toHaveBeenCalledTimes(2);
});
