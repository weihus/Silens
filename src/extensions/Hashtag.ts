import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const Hashtag = Extension.create({
  name: 'hashtag',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('hashtag'),
        state: {
          init(_, { doc }) {
            return getHashtagDecorations(doc);
          },
          apply(tr, value) {
            if (!tr.docChanged) return value;
            return getHashtagDecorations(tr.doc);
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

function getHashtagDecorations(doc: any) {
  const decorations: Decoration[] = [];
  const hashtagRegex = /#([^#\s，。！？；：、,.!?;:()（）【】\[\]{}<>"']+)/g;

  doc.descendants((node: any, pos: number) => {
    // 仅提供极简文本级“幽灵标签”装饰 (Ghost Tag Inline Decoration)
    if (node.isText) {
      const text = node.text || '';
      for (const match of text.matchAll(hashtagRegex)) {
        const start = pos + (match.index || 0);
        const end = start + match[0].length;
        
        decorations.push(
          Decoration.inline(start, end, {
            nodeName: 'span',
            class: 'font-medium text-neutral-500 dark:text-neutral-400 opacity-80 tracking-widest pr-1',
          })
        );
      }
    }
  });

  return DecorationSet.create(doc, decorations);
}