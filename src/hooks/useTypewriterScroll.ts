import { useRef, useEffect } from 'react';
import type { Editor } from '@tiptap/react';
import { useScrollSovereign } from './useScrollSovereign';

/**
 * useTypewriterScroll
 *
 * Wires keystroke intent into the Scroll Sovereign.
 * Exposes suspendTypewriterRef (for TipTap editorProps compat) and jumpToPosition.
 */
export function useTypewriterScroll(editor: Editor | null) {
  const suspendTypewriterRef = useRef(false);
  const sovereign = useScrollSovereign(editor, (mode) => {
    suspendTypewriterRef.current = mode === 'navigating' || mode === 'edge_case' || mode === 'jumping';
  });

  useEffect(() => {
    if (!editor) return;

    const handleUpdate = () => {
      sovereign.onKeystroke();
    };

    const handleSelectionUpdate = () => {
      if (suspendTypewriterRef.current) return;
      // Call directly — the rAF wrapper introduced a 1-frame delay that made
      // the typewriter feel sluggish and contributed to visible stutter.
      sovereign.onKeystroke();
    };

    editor.on('update', handleUpdate);
    editor.on('selectionUpdate', handleSelectionUpdate);

    return () => {
      editor.off('update', handleUpdate);
      editor.off('selectionUpdate', handleSelectionUpdate);
    };
  }, [editor, sovereign]);

  return { suspendTypewriterRef, jumpToPosition: sovereign.jumpToPosition };
}

/**
 * useGhostHighlight
 *
 * Finds target text in the editor and jumps to it via jumpToPosition
 * (no direct DOM scroll, avoiding conflict with the typewriter anchor).
 */
export function useGhostHighlight(
  editor: Editor | null,
  targetSearchText: string | null,
  onConsumed: () => void,
  jumpToPosition?: (pos: number) => void,
) {
  useEffect(() => {
    if (!editor || !targetSearchText) return;

    const id = window.setTimeout(() => {
      const exactMatch = targetSearchText.startsWith('#') ? targetSearchText : `#${targetSearchText}`;
      let targetSelection: { from: number; to: number } | null = null;

      editor.state.doc.descendants((node: unknown, pos: number) => {
        if (targetSelection !== null) return false;
        const n = node as { textContent?: string; isText?: boolean; text?: string; nodeSize?: number };

        if (n.textContent === targetSearchText || n.textContent === exactMatch) {
          targetSelection = { from: pos, to: pos + (n.nodeSize ?? 0) };
          return false;
        }

        if (n.isText) {
          const text = n.text ?? '';
          const found = text.indexOf(targetSearchText);
          if (found !== -1) {
            targetSelection = { from: pos + found, to: pos + found + targetSearchText.length };
            return false;
          }
          const foundHash = text.indexOf(exactMatch);
          if (foundHash !== -1) {
            targetSelection = { from: pos + foundHash, to: pos + foundHash + exactMatch.length };
            return false;
          }
        }

        return true;
      });

      if (targetSelection !== null) {
        const { from } = targetSelection;
        setTimeout(() => {
          editor.commands.focus();

          // Use the Scroll Sovereign's jumpToPosition for consistent scrolling
          if (jumpToPosition) {
            jumpToPosition(from);
          }

          try {
            const { node: domNode } = editor.view.domAtPos(from);
            const element = domNode instanceof Element ? domNode : domNode.parentElement;
            const blockElement = element?.closest('.ProseMirror > *');
            if (blockElement) {
              blockElement.classList.add('ghost-highlight');
              setTimeout(() => {
                blockElement.classList.remove('ghost-highlight');
              }, 1500);
            }
          } catch (e) {
            console.error('DOM定位失败:', e);
          }
        }, 150);
      } else {
        console.warn('未能找到目标文本:', exactMatch);
      }

      onConsumed();
    }, 50);

    return () => window.clearTimeout(id);
  }, [editor, targetSearchText, onConsumed, jumpToPosition]);
}
