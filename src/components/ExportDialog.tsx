import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, FileText, File, Image } from 'lucide-react';

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  theme: string;
  themeConfig: { bg: string; text: string; muted: string };
  exportContent: () => string;
  filename: string;
}

type ExportFormat = 'md' | 'txt' | 'png' | 'jpg';

export function ExportDialog({ open, onClose, theme, themeConfig, exportContent, filename }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('md');
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customName, setCustomName] = useState(filename.replace('.md', ''));

  const handleExport = async () => {
    setIsExporting(true);
    setError(null);

    try {
      const content = exportContent();
      const finalName = customName.trim() || 'untitled';

      if (format === 'md' || format === 'txt') {
        const ext = format === 'md' ? '.md' : '.txt';
        const outputContent = format === 'txt'
          ? content.replace(/```[\s\S]*?```/g, '') // Remove code blocks for txt
          : content;

        await invoke('save_file_as', {
          content: outputContent,
          filename: `${finalName}${ext}`,
        });
      } else {
        // PNG/JPG export using html-to-image
        const element = document.querySelector('.tiptap') as HTMLElement;
        if (!element) throw new Error('Editor not found');

        const { toPng, toJpeg } = await import('html-to-image');
        const getDataUrl = format === 'png' ? toPng : toJpeg;

        const dataUrl = await getDataUrl(element, {
          quality: 0.95,
          pixelRatio: 2,
          backgroundColor: theme === 'night' ? '#0D1424' : theme === 'white' ? '#FFFFFF' : '#F4EAD5',
        });

        const blob = await fetch(dataUrl).then(r => r.blob());
        const ext = format === 'png' ? '.png' : '.jpg';

        // Use Tauri dialog to save
        const { save } = await import('@tauri-apps/plugin-dialog');
        const path = await save({
          filters: [{
            name: 'Image',
            extensions: [ext.replace('.', '')],
          }],
          defaultPath: `${finalName}${ext}`,
        });

        if (path) {
          const { writeTextFile } = await import('@tauri-apps/plugin-fs');
          const buffer = await blob.arrayBuffer();
          await writeTextFile(path, buffer as unknown as string);
        }
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败');
    } finally {
      setIsExporting(false);
    }
  };

  if (!open) return null;

  const formats: { id: ExportFormat; icon: typeof FileText; label: string; desc: string }[] = [
    { id: 'md', icon: FileText, label: 'Markdown', desc: '.md 文件，保留格式' },
    { id: 'txt', icon: File, label: '纯文本', desc: '.txt 文件，无格式' },
    { id: 'png', icon: Image, label: '图片 (PNG)', desc: '高质量 PNG 图片' },
    { id: 'jpg', icon: Image, label: '图片 (JPG)', desc: '压缩图片，体积更小' },
  ];

  const currentFormat = formats.find(f => f.id === format)!;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-md mx-4 rounded-2xl overflow-hidden shadow-2xl"
            style={{
              backgroundColor: theme === 'night' ? 'rgba(13, 20, 36, 0.95)' : 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(20px)',
              border: `1px solid ${theme === 'night' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}`,
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'rgba(150,150,150,0.1)' }}>
              <h2 className="text-sm font-medium tracking-widest uppercase" style={{ color: themeConfig.text }}>
                导出
              </h2>
              <button
                onClick={onClose}
                className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                style={{ color: themeConfig.muted }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Format selection */}
            <div className="p-6 space-y-3">
              <p className="text-xs uppercase tracking-wider opacity-50 mb-4" style={{ color: themeConfig.text }}>
                选择格式
              </p>
              <div className="grid grid-cols-2 gap-2">
                {formats.map(({ id, icon: Icon, label, desc }) => (
                  <button
                    key={id}
                    onClick={() => setFormat(id)}
                    className="flex items-start gap-3 p-3 rounded-xl text-left transition-all"
                    style={{
                      backgroundColor: format === id
                        ? (theme === 'night' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)')
                        : 'transparent',
                      border: `1px solid ${format === id ? (theme === 'night' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)') : 'transparent'}`,
                    }}
                  >
                    <Icon size={18} style={{ color: themeConfig.text, opacity: format === id ? 1 : 0.6 }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: themeConfig.text }}>{label}</p>
                      <p className="text-xs opacity-60 truncate" style={{ color: themeConfig.muted }}>{desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Filename input */}
            <div className="px-6 pb-4">
              <label className="text-xs uppercase tracking-wider opacity-50 mb-2 block" style={{ color: themeConfig.text }}>
                文件名
              </label>
              <input
                type="text"
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{
                  backgroundColor: theme === 'night' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                  color: themeConfig.text,
                  border: '1px solid rgba(150,150,150,0.2)',
                }}
                placeholder="输入文件名..."
              />
            </div>

            {/* Error message */}
            {error && (
              <div className="mx-6 mb-4 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
                {error}
              </div>
            )}

            {/* Export button */}
            <div className="px-6 pb-6">
              <button
                onClick={handleExport}
                disabled={isExporting}
                className="w-full py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2"
                style={{
                  backgroundColor: isExporting ? 'rgba(150,150,150,0.3)' : (theme === 'night' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)'),
                  color: themeConfig.text,
                }}
              >
                {isExporting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    导出中...
                  </>
                ) : (
                  <>
                    <currentFormat.icon size={16} />
                    导出为 {currentFormat.label}
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
