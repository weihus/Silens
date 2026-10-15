import { useRef, useEffect } from 'react';
import type { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { useScrollSovereign } from './useScrollSovereign';

export function useTypewriterScroll(editor: Editor | null) {
  const suspendTypewriterRef = useRef(false);
  const { onKeystroke, jumpToPosition } = useScrollSovereign(editor, (mode) => {
    suspendTypewriterRef.current = mode !== 'writing';
  });

  useEffect(() => {
    if (!editor) return;
    // Native input represents typing intent; setContent and selection changes do not.
    const handleInput = (event: Event) => {
      if (!(event as InputEvent).isComposing && !editor.view.composing) onKeystroke();
    };
    const dom = editor.view.dom;
    dom.addEventListener('input', handleInput);
    return () => dom.removeEventListener('input', handleInput);
  }, [editor, onKeystroke]);

  return { suspendTypewriterRef, jumpToPosition };
}

export function useGhostHighlight(
  editor: Editor | null,
  targetSearchText: string | null,
  onConsumed: () => void,
  jumpToPosition?: (pos: number) => void,
) {
  const consumedRef = useRef(onConsumed);
  consumedRef.current = onConsumed;
  const highlightRef = useRef<Element | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    highlightRef.current?.classList.remove('ghost-highlight');
  }, [editor]);

  useEffect(() => {
    if (!editor || !targetSearchText) return;
    const id = window.setTimeout(() => {
      if (editor.isDestroyed) return;
      let target: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (target !== null) return false;
        if (!node.isTextblock) return true;
        // textBetween preserves offsets across marks and inline leaf nodes.
        const text = node.textBetween(0, node.content.size, '', '￼');
        const offset = text.indexOf(targetSearchText);
        if (offset !== -1) target = pos + 1 + offset;
        return false;
      });
      if (target !== null) {
        const from: number = target;
        // Set navigation mode before selection updates; only the sovereign scrolls.
        jumpToPosition?.(from);
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from)));
        editor.view.dom.focus({ preventScroll: true });
        if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
        highlightRef.current?.classList.remove('ghost-highlight');
        const { node } = editor.view.domAtPos(from);
        const element = node instanceof Element ? node : node.parentElement;
        const block = element?.closest('.ProseMirror > *') ?? null;
        highlightRef.current = block;
        if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
          block?.classList.add('ghost-highlight');
          fadeTimerRef.current = setTimeout(() => {
            block?.classList.remove('ghost-highlight');
            highlightRef.current = null;
          }, 1500);
        }
      }
      consumedRef.current();
    }, 50);
    return () => window.clearTimeout(id);
  }, [editor, targetSearchText, jumpToPosition]);
}
