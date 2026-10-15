import { useRef, useCallback, useEffect } from 'react';
import { animate } from 'framer-motion';
import type { Editor } from '@tiptap/react';

export type ScrollMode = 'writing' | 'navigating' | 'jumping' | 'edge_case';

export function useScrollSovereign(editor: Editor | null, onModeChange?: (mode: ScrollMode) => void) {
  const modeRef = useRef<ScrollMode>('writing');
  const onModeChangeRef = useRef(onModeChange);
  onModeChangeRef.current = onModeChange;
  const scrollAnimRef = useRef<ReturnType<typeof animate> | null>(null);
  const lastWrittenTopRef = useRef<number | null>(null);
  const isComposingRef = useRef(false);
  const isDeletingRef = useRef(false);
  const typingStreakRef = useRef(0);
  const lastTypingRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const compositionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getContainer = useCallback(() =>
    document.getElementById('silens-scroll-container'), []);

  const setMode = useCallback((next: ScrollMode) => {
    if (modeRef.current === next) return;
    modeRef.current = next;
    onModeChangeRef.current?.(next);
  }, []);

  const stopAnimation = useCallback(() => {
    scrollAnimRef.current?.stop();
    scrollAnimRef.current = null;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  // Scroll events arrive asynchronously, including after animation completion.
  const writeScroll = useCallback((container: HTMLElement, top: number) => {
    container.scrollTop = top;
    lastWrittenTopRef.current = container.scrollTop;
  }, []);

  const scrollTo = useCallback((container: HTMLElement, top: number, jumping = false) => {
    stopAnimation();
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion || (!jumping && Math.abs(top - container.scrollTop) <= window.innerHeight * 0.5)) {
      writeScroll(container, top);
      if (jumping) setMode('navigating');
      return;
    }
    scrollAnimRef.current = animate(container.scrollTop, top, {
      type: 'spring',
      stiffness: jumping ? 120 : 80,
      damping: jumping ? 20 : 18,
      mass: jumping ? 0.8 : 1,
      onUpdate: (value: number) => writeScroll(container, value),
      onComplete: () => {
        scrollAnimRef.current = null;
        if (jumping && modeRef.current === 'jumping') setMode('navigating');
      },
    });
  }, [setMode, stopAnimation, writeScroll]);

  const enforceAnchor = useCallback(() => {
    if (!editor || editor.isDestroyed || modeRef.current !== 'writing' || isComposingRef.current) return;
    const container = getContainer();
    if (!container) return;
    try {
      const { state, view } = editor;
      const { from, $from } = state.selection;
      const targetY = window.innerHeight * 0.35;
      let diff = view.coordsAtPos(from).top - targetY;
      if (Math.abs(diff) < 4 && isDeletingRef.current && $from.parent.isTextblock && !$from.parent.textContent && $from.before() > 0) {
        const previous = state.doc.resolve($from.before() - 1);
        diff = view.coordsAtPos(previous.pos).top - targetY;
      }
      if (Math.abs(diff) >= 4) scrollTo(container, container.scrollTop + diff);
    } catch {
      // Coordinates can be unavailable while the view is being replaced.
    }
  }, [editor, getContainer, scrollTo]);

  const onKeystroke = useCallback(() => {
    if (!editor || isComposingRef.current || modeRef.current === 'edge_case') return;
    const now = Date.now();
    typingStreakRef.current = now - lastTypingRef.current < 1500 ? typingStreakRef.current + 1 : 1;
    lastTypingRef.current = now;
    if (modeRef.current === 'jumping') {
      stopAnimation();
      setMode('navigating');
    }
    if (modeRef.current === 'navigating') {
      const { doc, selection } = editor.state;
      if (selection.from >= doc.content.size - 20 || typingStreakRef.current >= 3) setMode('writing');
    }
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(enforceAnchor);
  }, [editor, enforceAnchor, setMode, stopAnimation]);

  const jumpToPosition = useCallback((pos: number) => {
    if (!editor) return;
    stopAnimation();
    typingStreakRef.current = 0;
    setMode('jumping');
    const container = getContainer();
    if (!container) {
      setMode('navigating');
      return;
    }
    try {
      const diff = editor.view.coordsAtPos(pos).top - window.innerHeight * 0.35;
      scrollTo(container, container.scrollTop + diff, true);
    } catch {
      setMode('navigating');
    }
  }, [editor, getContainer, scrollTo, setMode, stopAnimation]);

  const suspendForNavigation = useCallback(() => {
    stopAnimation();
    typingStreakRef.current = 0;
    if (!isComposingRef.current) setMode('navigating');
  }, [setMode, stopAnimation]);

  useEffect(() => {
    if (!editor) return;
    const container = getContainer();
    const dom = editor.view.dom;
    const handleScroll = () => {
      if (container && container.scrollTop !== lastWrittenTopRef.current) suspendForNavigation();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || isComposingRef.current || editor.view.composing) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
        suspendForNavigation();
        return;
      }
      isDeletingRef.current = event.key === 'Backspace' || event.key === 'Delete';
      if (event.key === 'Enter') {
        stopAnimation();
        setMode('writing');
        // ProseMirror handles Enter itself, so no native input event is emitted.
        onKeystroke();
      }
    };
    const handleCompositionStart = () => {
      if (compositionTimerRef.current) clearTimeout(compositionTimerRef.current);
      isComposingRef.current = true;
      stopAnimation();
      setMode('edge_case');
    };
    const handleCompositionEnd = () => {
      compositionTimerRef.current = setTimeout(() => {
        isComposingRef.current = false;
        setMode('navigating');
        onKeystroke();
      }, 0);
    };
    container?.addEventListener('scroll', handleScroll, { passive: true });
    container?.addEventListener('wheel', suspendForNavigation, { passive: true });
    container?.addEventListener('mousedown', suspendForNavigation, { passive: true });
    container?.addEventListener('touchstart', suspendForNavigation, { passive: true });
    dom.addEventListener('keydown', handleKeyDown, true);
    dom.addEventListener('compositionstart', handleCompositionStart);
    dom.addEventListener('compositionend', handleCompositionEnd);
    return () => {
      container?.removeEventListener('scroll', handleScroll);
      container?.removeEventListener('wheel', suspendForNavigation);
      container?.removeEventListener('mousedown', suspendForNavigation);
      container?.removeEventListener('touchstart', suspendForNavigation);
      dom.removeEventListener('keydown', handleKeyDown, true);
      dom.removeEventListener('compositionstart', handleCompositionStart);
      dom.removeEventListener('compositionend', handleCompositionEnd);
      stopAnimation();
      if (compositionTimerRef.current) clearTimeout(compositionTimerRef.current);
    };
  }, [editor, getContainer, onKeystroke, setMode, stopAnimation, suspendForNavigation]);

  return {
    onKeystroke,
    jumpToPosition,
    suspendForNavigation,
    allowNativeScroll: () => modeRef.current === 'navigating' || modeRef.current === 'jumping',
  };
}
