import { useRef, useState, useEffect } from 'react';
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
  charCount: number;
  isSidebarOpen?: boolean;
}

const themeStyles: Record<Theme, { backgroundColor: string; color: string; muted: string }> = {
  paper: { backgroundColor: '#F4EAD5', color: '#2C2C2C', muted: '#8A8275' },
  white: { backgroundColor: '#FFFFFF', color: '#111827', muted: '#9CA3AF' },
  night: { backgroundColor: '#0D1424', color: '#E2E8F0', muted: '#64748B' },
};

export function Canvas({ theme, uiVisible, onTyping, onMouseMove, onChange, onEditorReady, isFocusMode, knownTags, targetSearchText, onConsumedTargetSearchText, charCount, isSidebarOpen }: CanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const ts = themeStyles[theme as Theme] ?? themeStyles.paper;
  const [scrollProgress, setScrollProgress] = useState(0);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      id="silens-scroll-container"
      className="fixed inset-0 w-screen h-screen overflow-y-auto overflow-x-hidden"
      style={{
        backgroundColor: 'transparent',
        color: ts.color,
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        transition: 'color 0.8s ease, padding-left 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        paddingLeft: isSidebarOpen ? '320px' : '0px',
      }}
      onMouseMove={onMouseMove}
      onScroll={(e) => {
        const target = e.currentTarget;

        // 计算当前的滚动进度比例 (0 ~ 1)
        const { scrollTop, scrollHeight, clientHeight } = target;
        const progress = scrollHeight > clientHeight ? scrollTop / (scrollHeight - clientHeight) : 0;
        setScrollProgress(progress);

        // 滚动反馈逻辑：滚动时变色，停止后 300ms 恢复
        setIsScrolling(true);
        if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = setTimeout(() => {
          setIsScrolling(false);
        }, 300);
      }}
    >
      <style>{`
        div::-webkit-scrollbar {
          display: none;
        }
      `}</style>

      {/* Top spacer — natural content start */}
      <div style={{ height: '96px', flexShrink: 0 }} />

      <MarkdownEditor
        theme={theme}
        onChange={onChange}
        onTyping={onTyping}
        onEditorReady={onEditorReady}
        isFocusMode={isFocusMode}
        knownTags={knownTags}
        targetSearchText={targetSearchText}
        onConsumedTargetSearchText={onConsumedTargetSearchText}
      />

      {/* Bottom spacer so text can scroll past center */}
      <div style={{ height: '80vh', flexShrink: 0 }} />

      {/* 极简左侧阅读进度指示条 */}
      <div
        className={`fixed top-0 left-0 bottom-0 w-[2px] z-50 pointer-events-none transition-opacity duration-700 ${
          uiVisible ? (theme === 'night' ? (isScrolling ? 'opacity-80' : 'opacity-40') : 'opacity-100') : 'opacity-0'
        }`}
      >
        <div
          className="w-full h-full origin-top transition-colors duration-300"
          style={{
            backgroundColor: isScrolling ? ts.color : ts.muted,
            transform: `scaleY(${scrollProgress})`,
          }}
        />
      </div>

    </div>
  );
}
