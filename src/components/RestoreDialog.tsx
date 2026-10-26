import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

interface Snapshot {
  id: string;
  created: string;
  files: number;
}

interface RestoreDialogProps {
  open: boolean;
  onClose: () => void;
  onRestored: (id: string) => Promise<void> | void;
  theme: string;
  themeConfig: { bg: string; text: string; muted: string };
}

export function RestoreDialog({ open, onClose, onRestored, theme, themeConfig }: RestoreDialogProps) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Snapshot | null>(null);
  const requestClose = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);
  const dialogRef = useDialogFocus(open, requestClose);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    setLoading(true);
    setError(null);
    setPending(null);
    invoke<Snapshot[]>('list_backups')
      .then(list => { if (!stale) setSnapshots(list); })
      .catch(() => { if (!stale) setError('无法读取备份，请检查备份文件夹是否可用。'); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [open]);

  const restore = async (snapshot: Snapshot) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await invoke('restore_backup', { id: snapshot.id });
      await onRestored(snapshot.id);
      onClose();
    } catch (cause) {
      setError(`恢复未完成，笔记保持原样。${String(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  const night = theme === 'night';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={requestClose}
        >
          <motion.div
            ref={dialogRef}
            role="dialog" aria-modal="true" aria-label="恢复备份" aria-busy={busy}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-md mx-4 rounded-2xl overflow-hidden shadow-2xl"
            style={{
              backgroundColor: night ? 'rgba(13, 20, 36, 0.95)' : 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(20px)',
              border: `1px solid ${night ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}`,
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'rgba(150,150,150,0.1)' }}>
              <h2 className="text-sm font-medium tracking-widest uppercase" style={{ color: themeConfig.text }}>恢复备份</h2>
              <button type="button" onClick={requestClose} disabled={busy} aria-label="关闭恢复备份"
                className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors" style={{ color: themeConfig.muted }}>
                <X size={16} />
              </button>
            </div>
            <div className="px-6 py-4 flex flex-col gap-2 max-h-80 overflow-y-auto">
              {loading && <p role="status" className="text-xs py-2" style={{ color: themeConfig.muted }}>正在读取备份…</p>}
              {!loading && !error && snapshots.length === 0 && (
                <p role="status" className="text-xs py-2" style={{ color: themeConfig.muted }}>还没有备份。先在「本地文件」里点「备份副本」。</p>
              )}
              {snapshots.map(snapshot => (
                <div key={snapshot.id} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2"
                  style={{ backgroundColor: night ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }}>
                  <span className="text-xs" style={{ color: themeConfig.text }}>
                    {snapshot.created}
                    <span style={{ color: themeConfig.muted }}> · {snapshot.files} 篇</span>
                  </span>
                  <button type="button" onClick={() => setPending(snapshot)} disabled={busy}
                    className="quiet-button rounded-md px-2 py-1 text-xs disabled:opacity-50" style={{ color: themeConfig.text }}>恢复</button>
                </div>
              ))}
            </div>
            {pending && (
              <div className="mx-6 mb-4 px-3 py-3 rounded-lg text-xs flex flex-col gap-3"
                style={{ backgroundColor: night ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)', color: themeConfig.text }}>
                <p>恢复到 {pending.created}。当前笔记会先备份一份，之后可以同样恢复回来。</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => { void restore(pending); }} disabled={busy}
                    className="quiet-button rounded-md px-3 py-1.5 disabled:opacity-50">{busy ? '正在恢复…' : '确认恢复'}</button>
                  <button type="button" onClick={() => setPending(null)} disabled={busy}
                    className="quiet-button rounded-md px-3 py-1.5 disabled:opacity-50">取消</button>
                </div>
              </div>
            )}
            {error && (
              <div role="alert" className="mx-6 mb-4 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>{error}</div>
            )}
            <p className="px-6 pb-5 text-xs leading-relaxed" style={{ color: themeConfig.muted }}>
              恢复会替换整个笔记文件夹。备份之后新建或改过的笔记会被移除，但它们保留在刚才自动生成的备份里。
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
