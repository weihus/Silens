/**
 * useScrollSovereign
 *
 * Single source of truth for all scroll behavior in Silens.
 *
 * Modes:
 *   EDGE_CASE  — IME composing; typewriter fully disabled
 *   JUMPING    — Cmd+K or Timeline navigation; typewriter disabled until settle
 *   NAVIGATING — user is browsing old text with mouse/arrow keys
 *   WRITING    — typewriter active, enforces 35% anchor
 *
 * Deletion behavior:
 *   Backspace/Delete sets isDeletingRef = true. While true, enforceAnchor
 *   still runs (the cursor stays at 35%) but the mode stays 'writing'.
 *   After 800ms of no new keystrokes, isDeletingRef resets.
 */
import { useRef, useCallback, useEffect } from 'react';
import { animate } from 'framer-motion';
import type { Editor } from '@tiptap/react';

export type ScrollMode = 'writing' | 'navigating' | 'jumping' | 'edge_case';

interface ScrollSovereignState {
  mode: ScrollMode;
}

export function useScrollSovereign(editor: Editor | null, onModeChange?: (mode: ScrollMode) => void) {
  const stateRef = useRef<ScrollSovereignState>({ mode: 'writing' });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollAnimRef = useRef<ReturnType<typeof animate> | null>(null);
  const isProgrammaticRef = useRef(false);

  // Tracks whether the user is currently deleting (Backspace/Delete).
  // While true, enforceAnchor still runs so the cursor stays at 35%,
  // but we skip the anchor if the current block is empty (nothing to anchor to).
  const isDeletingRef = useRef(false);
  const deleteResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // IME composition tracking
  const isComposingRef = useRef(false);

  // Jump settle timer
  const jumpSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Typing streak for distinguishing edit-old vs write-new
  const typingStreakRef = useRef(0);
  const streakResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getContainer = useCallback(() => {
    if (containerRef.current) return containerRef.current;
    const el = document.getElementById('silens-scroll-container') as HTMLDivElement | null;
    if (el) containerRef.current = el;
    return el;
  }, []);

  const setMode = useCallback((next: ScrollMode) => {
    const prev = stateRef.current.mode;
    if (prev === next) return;
    stateRef.current.mode = next;
    onModeChange?.(next);
  }, [onModeChange]);

  // ── Spring-enforced typewriter scroll ──────────────────────────────────────

  const ENFORCE_THRESHOLD = 4;

  const enforceAnchor = useCallback(() => {
    const mode = stateRef.current.mode;
    if (mode !== 'writing') return;

    const container = getContainer();
    if (!container) return;

    try {
      const { state, view } = editor;
      const { from } = state.selection;

      const coords = view.coordsAtPos(from);
      const targetY = window.innerHeight * 0.35;
      const diff = coords.top - targetY;

      if (Math.abs(diff) < ENFORCE_THRESHOLD) {
        // If we're deleting and the current block is empty, scroll up
        // to anchor the previous non-empty block at 35%.
        if (isDeletingRef.current) {
          const blockStart = state.doc.resolve(from).start();
          const blockText = state.doc.textBetween(blockStart, from, '', '\n').trim();
          if (blockText === '') {
            // Cursor is at start of empty block — find the end of previous block
            let searchPos = blockStart - 1;
            while (searchPos > 0 && state.doc.textBetween(searchPos, searchPos + 1) === '\n') {
              searchPos--;
            }
            if (searchPos >= 0) {
              const prevBlockEnd = state.doc.resolve(searchPos).end();
              const prevCoords = view.coordsAtPos(prevBlockEnd);
              const prevDiff = prevCoords.top - targetY;
              if (Math.abs(prevDiff) >= ENFORCE_THRESHOLD) {
                if (Math.abs(prevDiff) > window.innerHeight * 0.5) {
                  if (scrollAnimRef.current) scrollAnimRef.current.stop();
                  isProgrammaticRef.current = true;
                  scrollAnimRef.current = animate(container.scrollTop, container.scrollTop + prevDiff, {
                    type: 'spring',
                    stiffness: 80,
                    damping: 18,
                    mass: 1,
                    onComplete: () => {
                      isProgrammaticRef.current = false;
                      scrollAnimRef.current = null;
                    },
                  });
                } else {
                  container.scrollTop = container.scrollTop + prevDiff;
                }
              }
            }
          }
        }
        return;
      }

      // Large jump: one-shot spring animation.
      if (Math.abs(diff) > window.innerHeight * 0.5) {
        if (scrollAnimRef.current) scrollAnimRef.current.stop();
        isProgrammaticRef.current = true;
        scrollAnimRef.current = animate(container.scrollTop, container.scrollTop + diff, {
          type: 'spring',
          stiffness: 80,
          damping: 18,
          mass: 1,
          onComplete: () => {
            isProgrammaticRef.current = false;
            scrollAnimRef.current = null;
          },
        });
        return;
      }

      // Small/medium: direct assignment — no animation overhead between keystrokes.
      container.scrollTop = container.scrollTop + diff;
    } catch {
      // view.coordsAtPos may fail during DOM paint — silently ignore
    }
  }, [editor, getContainer]);

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Tell the controller a keystroke happened. Used by the typewriter hook. */
  const onKeystroke = useCallback(() => {
    // If in edge_case (IME), wake up when user is at doc end
    if (stateRef.current.mode === 'edge_case') {
      try {
        const { from, doc } = editor.state;
        if (from >= doc.content.size - 20) {
          setMode('writing');
        }
      } catch { /* coords may be unavailable during paint */ }
      return;
    }

    if (stateRef.current.mode === 'jumping') return;

    typingStreakRef.current += 1;
    if (streakResetTimerRef.current) clearTimeout(streakResetTimerRef.current);
    streakResetTimerRef.current = setTimeout(() => {
      typingStreakRef.current = 0;
    }, 1500);

    // Resume if at doc end (creation mode) or 3+ keystrokes (rewrite mode)
    if (stateRef.current.mode === 'navigating') {
      try {
        const { from, doc } = editor.state;
        if (from >= doc.content.size - 20 || typingStreakRef.current >= 3) {
          setMode('writing');
        }
      } catch { /* coords may be unavailable during paint */ }
    }

    requestAnimationFrame(enforceAnchor);
  }, [editor, setMode, enforceAnchor]);

  /**
   * Trigger a jump to a specific editor position (used by ghost highlight).
   * Sets JUMPING mode, scrolls to position, then re-enables typewriter after settle.
   */
  const jumpToPosition = useCallback((pos: number) => {
    const container = getContainer();
    if (!container) return;

    if (jumpSettleTimerRef.current) clearTimeout(jumpSettleTimerRef.current);
    if (scrollAnimRef.current) scrollAnimRef.current.stop();

    setMode('jumping');
    isProgrammaticRef.current = true;

    try {
      const { view } = editor;
      const coords = view.coordsAtPos(pos);
      const targetY = window.innerHeight * 0.35;
      const diff = coords.top - targetY;
      const targetScrollTop = container.scrollTop + diff;

      scrollAnimRef.current = animate(container.scrollTop, targetScrollTop, {
        type: 'spring',
        stiffness: 120,
        damping: 20,
        mass: 0.8,
        onUpdate: (v: number) => {
          container.scrollTop = v;
        },
        onComplete: () => {
          isProgrammaticRef.current = false;
          scrollAnimRef.current = null;
        },
      });
    } catch (e) {
      console.error('jumpToPosition failed:', e);
      isProgrammaticRef.current = false;
    }

    // Release typing back to typewriter after settle
    jumpSettleTimerRef.current = setTimeout(() => {
      setMode('writing');
      requestAnimationFrame(enforceAnchor);
    }, 600);
  }, [editor, getContainer, setMode, enforceAnchor]);

  /**
   * Suspend typewriter for navigation browsing.
   * Called by keyboard/mouse navigation in the editor.
   */
  const suspendForNavigation = useCallback(() => {
    if (stateRef.current.mode === 'jumping' || stateRef.current.mode === 'edge_case') return;
    if (scrollAnimRef.current) scrollAnimRef.current.stop();
    setMode('navigating');
  }, [setMode]);

  /**
   * Enter edge case mode (IME composing).
   */
  const enterEdgeCase = useCallback(() => {
    if (stateRef.current.mode === 'edge_case') return;
    if (scrollAnimRef.current) scrollAnimRef.current.stop();
    setMode('edge_case');
  }, [setMode]);

  /**
   * Clear edge case mode when composition ends.
   */
  const leaveEdgeCase = useCallback(() => {
    if (stateRef.current.mode !== 'edge_case') return;
    setMode('writing');
    requestAnimationFrame(enforceAnchor);
  }, [setMode, enforceAnchor]);

  // ── Side effects ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!editor) return;

    const container = getContainer();
    if (!container) return;

    // Intercept native scroll (wheel, drag) → suspend typewriter
    const handleScroll = () => {
      if (!isProgrammaticRef.current) {
        suspendForNavigation();
      }
    };

    const handlePointerDown = () => {
      suspendForNavigation();
    };

    // Keyboard: arrow keys / page keys suspend typewriter
    const handleKeyDown = (e: KeyboardEvent) => {
      const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'];

      if (arrows.includes(e.key)) {
        suspendForNavigation();
        return;
      }

      if (e.key === 'Enter') {
        if (stateRef.current.mode !== 'writing') {
          setMode('writing');
        }
        typingStreakRef.current = Math.max(typingStreakRef.current, 3);
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        isDeletingRef.current = true;
        // Reset the flag after 800ms of no new keystrokes
        if (deleteResetTimerRef.current) clearTimeout(deleteResetTimerRef.current);
        deleteResetTimerRef.current = setTimeout(() => {
          isDeletingRef.current = false;
          deleteResetTimerRef.current = null;
        }, 800);
        return;
      }

      // Any other key: stop deletion mode and resume anchor immediately
      isDeletingRef.current = false;
      if (deleteResetTimerRef.current) {
        clearTimeout(deleteResetTimerRef.current);
        deleteResetTimerRef.current = null;
      }
      requestAnimationFrame(enforceAnchor);
    };

    // IME: compositionstart → edge case; compositionend → writing
    const handleCompositionStart = () => {
      isComposingRef.current = true;
      enterEdgeCase();
    };

    const handleCompositionEnd = () => {
      isComposingRef.current = false;
      setTimeout(() => {
        if (!isComposingRef.current) leaveEdgeCase();
      }, 100);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    container.addEventListener('mousedown', handlePointerDown, { passive: true });
    container.addEventListener('touchstart', handlePointerDown, { passive: true });
    container.addEventListener('keydown', handleKeyDown, { passive: true });
    window.addEventListener('compositionstart', handleCompositionStart, { passive: true });
    window.addEventListener('compositionend', handleCompositionEnd, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
      container.removeEventListener('mousedown', handlePointerDown);
      container.removeEventListener('touchstart', handlePointerDown);
      container.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('compositionstart', handleCompositionStart);
      window.removeEventListener('compositionend', handleCompositionEnd);
      if (scrollAnimRef.current) scrollAnimRef.current.stop();
      if (jumpSettleTimerRef.current) clearTimeout(jumpSettleTimerRef.current);
      if (streakResetTimerRef.current) clearTimeout(streakResetTimerRef.current);
      if (deleteResetTimerRef.current) clearTimeout(deleteResetTimerRef.current);
    };
  }, [editor, getContainer, suspendForNavigation, setMode, enterEdgeCase, leaveEdgeCase]);

  return {
    onKeystroke,
    jumpToPosition,
    suspendForNavigation,
    allowNativeScroll: () =>
      stateRef.current.mode === 'navigating' || stateRef.current.mode === 'jumping',
  };
}
