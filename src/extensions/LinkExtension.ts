import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const LINK_REGEX = /\[\[([^\][]*)\]\]/g;

export const LinkExtension = Extension.create({
  name: 'silensLink',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('silens-link'),
        state: {
          init: (_, doc) => getLinkDecorations(doc),
          apply(tr, value) {
            if (!tr.docChanged) return value;
            return getLinkDecorations(tr.doc);
          },
        },
        props: {
          decorations(state) {
            return (this as any).getState(state);
          },
          handleClick: (view, pos) => {
            const { state } = view;
            const deco = (this as any).getState(state);
            const matches = deco.find(pos, pos);
            if (matches.length === 0) return false;
            const docName = matches[0].mark.attrs['data-doc-name'];
            if (!docName) return false;
            view.focus();
            window.dispatchEvent(new CustomEvent('silens-link-click', { detail: { docName } }));
            return true;
          },
        },
      }),
    ];
  },
});

function getLinkDecorations(doc: any): DecorationSet {
  const decos: Decoration[] = [];
  const collectTexts = (node: any): void => {
    if (node.isText && node.text) {
      for (const match of node.text.matchAll(LINK_REGEX)) {
        const from = node.from + match.index;
        const to = from + match[0].length;
        const docName = match[1].trim();
        decos.push(
          Decoration.inline(from, to, {
            nodeName: 'span',
            class:
              'silens-link opacity-70 hover:opacity-100 transition-opacity duration-150 ' +
              'underline decoration-dotted underline-offset-2',
            'data-doc-name': docName,
            style: 'cursor: pointer;',
          })
        );
      }
    }
    if (node.content && node.content.nodes) {
      node.content.nodes.forEach((child: any) => collectTexts(child));
    }
  };
  collectTexts(doc);
  return DecorationSet.create(doc, decos);
}
