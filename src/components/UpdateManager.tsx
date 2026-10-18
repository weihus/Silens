import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { ArrowUpRight, X } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';

type Phase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'preparing' | 'installing' | 'installed' | 'error';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canNotify: boolean;
  blocked: boolean;
  onBusyChange: (busy: boolean) => void;
  prepareToInstall: () => Promise<void>;
}

export function UpdateManager({ open, onOpenChange, canNotify, blocked, onBusyChange, prepareToInstall }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [version, setVersion] = useState('');
  const [release, setRelease] = useState<{ version: string; body?: string } | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const pending = useRef<Update | null>(null);
  const working = useRef(false);
  const phaseRef = useRef(phase);
  useLayoutEffect(() => { phaseRef.current = phase; }, [phase]);
  const mounted = useRef(false);
  const busy = ['downloading', 'preparing', 'installing'].includes(phase);
  const close = () => { if (!busy) { setDismissed(true); onOpenChange(false); } };
  const dialogRef = useDialogFocus(open, close);

  const checkNow = useCallback(async () => {
    if (working.current || phaseRef.current === 'installed') return;
    if (!isTauri()) {
      setError('请在 Silens 桌面应用中检查更新。');
      setPhase('error');
      return;
    }
    working.current = true;
    setPhase('checking');
    setError('');
    try {
      const update = await check({ timeout: 20000 });
      if (!mounted.current) { await update?.close(); return; }
      await pending.current?.close();
      pending.current = update;
      setRelease(update ? { version: update.version, body: update.body } : null);
      setPhase(update ? 'available' : 'current');
      setDismissed(false);
    } catch (cause) {
      if (mounted.current) {
        setError(String(cause).includes('linux-x86_64-deb')
          ? 'DEB 安装暂不支持应用内更新，请前往 Silens 的 GitHub Releases 下载新版 DEB 安装包。'
          : '暂时无法连接更新服务，请检查网络后重试。');
        setPhase('error');
      }
    } finally { working.current = false; }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (isTauri()) void getVersion().then(setVersion).catch(() => {});
    const timer = window.setTimeout(() => { void checkNow(); }, 10000);
    const interval = window.setInterval(() => { void checkNow(); }, 4 * 60 * 60 * 1000);
    return () => {
      mounted.current = false;
      window.clearTimeout(timer);
      window.clearInterval(interval);
      void pending.current?.close().catch(() => {});
      pending.current = null;
    };
  }, [checkNow]);

  useEffect(() => {
    if (open && !pending.current && phaseRef.current !== 'installed') void checkNow();
  }, [open, checkNow]);

  const install = async () => {
    if (working.current || blocked) return;
    const update = pending.current;
    if (!update && phase !== 'installed') return;
    working.current = true;
    onBusyChange(true);
    setError('');
    let installed = phase === 'installed';
    try {
      if (!installed && update) {
        setPhase('downloading');
        setProgress(null);
        let received = 0;
        let total: number | undefined;
        await update.download(event => {
          if (event.event === 'Started') { total = event.data.contentLength; received = 0; }
          if (event.event === 'Progress') received += event.data.chunkLength;
          setProgress(total ? Math.min(100, Math.round(received / total * 100)) : null);
        }, { timeout: 120000 });
      }
      setPhase('preparing');
      await prepareToInstall();
      if (!installed && update) {
        setPhase('installing');
        await update.install();
        installed = true;
        pending.current = null;
        await update.close().catch(() => {});
      }
      setPhase('installed');
      await relaunch();
    } catch {
      setError(installed
        ? '新版本已安装，请重试重启，或保存后手动关闭并重新打开 Silens。'
        : '更新未完成。请检查网络、笔记保存状态或安装权限后重试，当前文字仍保留在这里。');
      setPhase(installed ? 'installed' : 'error');
    } finally {
      working.current = false;
      onBusyChange(false);
    }
  };

  return <>
    {!open && release && !dismissed && canNotify && phase !== 'installed' && (
      <div role="status" className="fixed bottom-16 right-6 z-40 flex items-center gap-3 rounded-xl border px-4 py-3 text-xs shadow-sm" style={{ background: 'var(--theme-bg)', color: 'var(--theme-text)', borderColor: 'var(--theme-border)' }}>
        <button type="button" className="flex items-center gap-2" onClick={() => onOpenChange(true)}><ArrowUpRight size={14} />Silens {release.version} 可更新</button>
        <button type="button" aria-label="稍后提醒更新" onClick={() => setDismissed(true)}><X size={14} /></button>
      </div>
    )}
    {open && <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/15 p-5" onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="update-title" aria-busy={busy} className="max-h-[calc(100dvh-40px)] w-full max-w-md overflow-y-auto rounded-2xl border p-6 shadow-xl" style={{ background: 'var(--theme-bg)', color: 'var(--theme-text)', borderColor: 'var(--theme-border)' }}>
        <div className="flex items-center justify-between gap-4">
          <h2 id="update-title" className="text-lg font-medium">软件更新</h2>
          <button type="button" aria-label="关闭软件更新" className="quiet-button rounded-md p-2 disabled:opacity-40" disabled={busy} onClick={close}><X size={18} /></button>
        </div>
        <p className="mt-2 text-xs" style={{ color: 'var(--theme-muted)' }}>Silens{version && ` · 当前版本 ${version}`}</p>
        <div className="my-6 text-sm leading-relaxed" aria-live="polite">
          {phase === 'checking' && <p>正在检查更新…</p>}
          {phase === 'current' && <p>已是最新版本，安心书写吧。</p>}
          {release && <>
            <p className="font-medium">新版本 {release.version}</p>
            <div className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-xs" style={{ color: 'var(--theme-muted)' }}>{release.body || '这个版本包含体验改善与问题修复。'}</div>
          </>}
          {phase === 'downloading' && <div className="mt-4"><p>正在下载{progress !== null ? ` · ${progress}%` : '…'}</p><progress aria-label="更新下载进度" value={progress ?? undefined} max={100} className="mt-2 w-full accent-[#718474]" /></div>}
          {phase === 'preparing' && <p className="mt-4">正在保存笔记并创建备份…</p>}
          {phase === 'installing' && <p className="mt-4">正在安装，请勿关闭应用…</p>}
          {phase === 'installed' && <p className="mt-4">已安装新版本，正在准备重启。</p>}
          {error && <p role="alert" className="mt-4">{error}</p>}
        </div>
        {release && phase !== 'installed' && <p className="mb-5 text-xs leading-relaxed" style={{ color: 'var(--theme-muted)' }}>确认后将下载更新，保存笔记并备份，然后安装并重启。更新检查仅请求版本信息，不上传笔记。</p>}
        <div className="flex justify-end gap-3 text-xs">
          <button type="button" className="quiet-button rounded-lg px-4 py-2 disabled:opacity-40" disabled={busy} onClick={close}>稍后</button>
          {phase === 'installed'
            ? <button type="button" className="quiet-button rounded-lg border px-4 py-2" disabled={busy || blocked} onClick={() => { void install(); }}>重启 Silens</button>
            : release && phase !== 'checking'
              ? <button type="button" className="quiet-button rounded-lg border px-4 py-2 disabled:opacity-40" disabled={busy || blocked} onClick={() => { void install(); }}>{busy ? '更新中…' : '下载并重启'}</button>
              : <button type="button" className="quiet-button rounded-lg border px-4 py-2 disabled:opacity-40" disabled={phase === 'checking' || blocked} onClick={() => { void checkNow(); }}>检查更新</button>}
        </div>
      </div>
    </div>}
  </>;
}
