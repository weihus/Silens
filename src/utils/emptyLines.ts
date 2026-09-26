import type { Editor } from '@tiptap/react';

/**
 * Empty-line preservation for TipTap Markdown serialization.
 *
 * TipTap's Markdown serializer collapses consecutive empty paragraphs.
 * We use ' ' (non-breaking space) as a sentinel: an empty paragraph
 * containing only ' ' serializes to a real empty paragraph in Markdown.
 * On load, we strip the sentinel and restore clean newlines.
 */

const SENTINEL = ' ';

/**
 * Encode: before saving to disk, strip sentinels and restore raw newlines.
 */
export function decodeEmptyLines(text: string): string {
  return text
    .replace(/\n (?=\n)/g, '')
    .replace(/^ (?=\n)/g, '\n')
    .replace(/\n $/g, '\n')
    .replace(/^ $/g, '\n\n\n');
}

/**
 * Encode: before feeding into TipTap, wrap triple+ newlines with sentinel
 * paragraphs so the Markdown serializer preserves them.
 */
export function encodeEmptyLines(raw: string): string {
  const text = raw.replace(/\r\n/g, '\n');
  return text.replace(/\n{3,}/g, (match) => {
    const emptyParaCount = match.length - 2;
    return '\n\n' + Array(emptyParaCount).fill(SENTINEL).join('\n\n') + '\n\n';
  });
}

/**
 * Apply encoded content to TipTap editor, cleaning up sentinel paragraphs.
 * When the document is empty, ensures cursor is at position 0 (not 1).
 */
export function applyEncodedContent(editor: Editor, encoded: string) {
  editor.commands.setContent(encoded);
  editor.commands.command(({ tr }: { tr: any }) => {
    cleanSentinelParagraphs(tr);
    return true;
  });

  // After content is set, if the editor is effectively empty,
  // move cursor to the very front (position 0) instead of position 1.
  const isEmpty = editor.state.doc.textContent.trim() === '';
  if (isEmpty) {
    editor.commands.focus();
    editor.commands.setTextSelection(0);
  }
}

/**
 * Clean TipTap doc: remove leftover sentinel paragraphs after loading.
 */
export function cleanSentinelParagraphs(tr: any): boolean {
  const ranges: { from: number; to: number }[] = [];
  tr.doc.descendants((node: any, pos: number) => {
    if (node.type.name === 'paragraph' && node.childCount === 1 && node.textContent === SENTINEL) {
      ranges.push({ from: pos + 1, to: pos + 2 });
    }
  });
  let modified = false;
  ranges.reverse().forEach(({ from, to }) => {
    tr.delete(from, to);
    modified = true;
  });
  return modified;
}
