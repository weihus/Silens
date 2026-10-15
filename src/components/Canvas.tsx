import { useRef, useEffect } from 'react';
import type { Theme } from '../types';
import { MarkdownEditor } from './MarkdownEditor';
import { Editor } from '@tiptap/react';

interface CanvasProps {
  theme: Theme;
  uiVisible: boolean;
  onTyping: () => void;
  onMouseMove: () => void;
  onChange: (value: string) => void;
  onEditorReady: (editor: Editor) => void;
  isFocusMode: boolean;
  knownTags: string[];
  targetSearchText: string | null;
  onConsumedTargetSearchText: () => void;
  isSidebarOpen?: boolean;
  disabled?: boolean;
}

export function Canvas({ theme, uiVisible, onTyping, onMouseMove, onChange, onEditorReady, isFocusMode, knownTags, targetSearchText, onConsumedTargetSearchText, isSidebarOpen, disabled = false }: CanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
  }, []);

  return (
    <div
      ref={wrapperRef}
      id="silens-scroll-container"
      className={`canvas-scroll fixed inset-0 overflow-y-auto overflow-x-hidden ${isSidebarOpen ? 'canvas-sidebar-open' : ''}`}
      aria-busy={disabled}
      style={{ color: theme === 'night' ? '#E3E7E0' : '#343C38', scrollbarWidth: 'none' }}
      onMouseMove={onMouseMove}
      onScroll={(e) => {
        const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
        const progress = scrollHeight > clientHeight ? Math.max(0, Math.min(1, scrollTop / (scrollHeight - clientHeight))) : 0;
        if (progressRef.current) {
          progressRef.current.style.transform = `scaleY(${progress})`;
          progressRef.current.style.backgroundColor = 'var(--theme-text)';
        }
        if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = setTimeout(() => {
          if (progressRef.current) progressRef.current.style.backgroundColor = 'var(--theme-muted)';
        }, 300);
      }}
    >
      <div className="canvas-writing-area" inert={disabled}>
        <div className="h-24" />
        <MarkdownEditor
          theme={theme}
          onChange={(value) => { if (!disabled) onChange(value); }}
          onTyping={() => { if (!disabled) onTyping(); }}
          onEditorReady={onEditorReady}
          isFocusMode={isFocusMode}
          knownTags={knownTags}
          targetSearchText={disabled ? null : targetSearchText}
          onConsumedTargetSearchText={onConsumedTargetSearchText}
        />
        <div style={{ height: '80vh' }} />
      </div>
      {disabled && (
        <div className="canvas-loading fixed inset-0 z-40 flex items-center justify-center" style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-muted)' }}>
          <span role="status" className="text-sm">加载中</span>
        </div>
      )}
      <div aria-hidden="true" className={`fixed top-0 left-0 bottom-0 w-px z-50 pointer-events-none transition-opacity duration-300 ${uiVisible ? 'opacity-60' : 'opacity-0'}`}>
        <div ref={progressRef} className="w-full h-full origin-top transition-colors duration-300" style={{ backgroundColor: 'var(--theme-muted)', transform: 'scaleY(0)' }} />
      </div>
    </div>
  );
}
