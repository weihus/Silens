import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const pluginKey = new PluginKey('silens-focus-sentence');

type SentenceRange = {
  from: number;
  to: number;
};

function findSentenceRange(text: string, index: number): { start: number; end: number } {
  const i = Math.max(0, Math.min(index, text.length));
  const boundary = /[。.!?\n]/g;

  let start = 0;
  let end = text.length;

  for (let p = i - 1; p >= 0; p--) {
    boundary.lastIndex = 0;
    if (boundary.test(text[p])) {
      start = p + 1;
      break;
    }
  }

  for (let p = i; p < text.length; p++) {
    boundary.lastIndex = 0;
    if (boundary.test(text[p])) {
      end = p + 1;
      break;
    }
  }

  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;

  return { start, end };
}

function posAtTextOffset(doc: any, from: number, to: number, offset: number): number {
  if (offset <= 0) return from;

  let acc = 0;
  let found: number | null = null;

  doc.nodesBetween(from, to, (node: any, pos: number) => {
    if (!node.isText) return;
    const len = node.text?.length ?? 0;
    if (acc + len >= offset) {
      found = pos + (offset - acc);
      return false;
    }
    acc += len;
    return;
  });

  return found ?? to;
}

function computeActiveBlockAndSentence(state: any):
  | { blockFrom: number; blockTo: number; blockNodePos: number; sentence: SentenceRange | null }
  | null {
  const { selection } = state;
  if (!selection) return null;

  const $head = selection.$head;
  const depth = $head.depth;
  let textblockDepth = -1;

  for (let d = depth; d >= 0; d--) {
    const n = $head.node(d);
    if (n.isTextblock) {
      textblockDepth = d;
      break;
    }
  }

  if (textblockDepth === -1) return null;

  const blockFrom = $head.start(textblockDepth);
  const blockTo = $head.end(textblockDepth);
  const blockNodePos = $head.before(textblockDepth);

  const text = state.doc.textBetween(blockFrom, blockTo, '\n', '\n');
  const cursorIndex = state.doc.textBetween(blockFrom, $head.pos, '\n', '\n').length;

  const { start, end } = findSentenceRange(text, cursorIndex);
  if (start === end) {
    return { blockFrom, blockTo, blockNodePos, sentence: null };
  }

  const fromPos = posAtTextOffset(state.doc, blockFrom, blockTo, start);
  const toPos = posAtTextOffset(state.doc, blockFrom, blockTo, end);
  if (fromPos >= toPos) {
    return { blockFrom, blockTo, blockNodePos, sentence: null };
  }

  return {
    blockFrom,
    blockTo,
    blockNodePos,
    sentence: { from: fromPos, to: toPos },
  };
}

export const FocusSentenceExtension = Extension.create({
  name: 'focusSentence',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        state: {
          init: (_, state) => {
            const res = computeActiveBlockAndSentence(state);
            if (!res) return DecorationSet.empty;

            const decos: Decoration[] = [];
            const node = state.doc.nodeAt(res.blockNodePos);
            if (node) {
              decos.push(Decoration.node(res.blockNodePos, res.blockNodePos + node.nodeSize, { class: 'zen-active-block' }));
            }

            if (res.sentence) {
              decos.push(Decoration.inline(res.sentence.from, res.sentence.to, { class: 'zen-active-sentence' }));
              if (res.blockFrom < res.sentence.from) {
                decos.push(Decoration.inline(res.blockFrom, res.sentence.from, { class: 'zen-dim' }));
              }
              if (res.sentence.to < res.blockTo) {
                decos.push(Decoration.inline(res.sentence.to, res.blockTo, { class: 'zen-dim' }));
              }
            }

            return DecorationSet.create(state.doc, decos);
          },
          apply: (tr, old, _oldState, newState) => {
            if (!tr.docChanged && !tr.selectionSet) return old.map(tr.mapping, tr.doc);

            const res = computeActiveBlockAndSentence(newState);
            if (!res) return DecorationSet.empty;

            const decos: Decoration[] = [];
            const node = newState.doc.nodeAt(res.blockNodePos);
            if (node) {
              decos.push(Decoration.node(res.blockNodePos, res.blockNodePos + node.nodeSize, { class: 'zen-active-block' }));
            }

            if (res.sentence) {
              decos.push(Decoration.inline(res.sentence.from, res.sentence.to, { class: 'zen-active-sentence' }));
              if (res.blockFrom < res.sentence.from) {
                decos.push(Decoration.inline(res.blockFrom, res.sentence.from, { class: 'zen-dim' }));
              }
              if (res.sentence.to < res.blockTo) {
                decos.push(Decoration.inline(res.sentence.to, res.blockTo, { class: 'zen-dim' }));
              }
            }

            return DecorationSet.create(newState.doc, decos);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
