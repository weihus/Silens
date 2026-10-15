import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const LINK_REGEX = /\[\[([^\][]*)\]\]/g;
const linkKey = new PluginKey<DecorationSet>('silens-link');

export const LinkExtension = Extension.create({
  name: 'silensLink',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: linkKey,
      state: {
        init: (_, state) => getLinkDecorations(state.doc),
        apply: (tr, value) => tr.docChanged ? getLinkDecorations(tr.doc) : value,
      },
      props: {
        decorations: state => linkKey.getState(state),
        handleClick: (view, pos, event) => {
          const target = event.target instanceof Element
            ? event.target.closest('[data-doc-name].silens-link') : null;
          if (!target || !view.dom.contains(target)) return false;
          const docName = target.getAttribute('data-doc-name');
          const match = linkKey.getState(view.state)?.find(pos, pos)
            .find(deco => deco.spec.docName === docName);
          if (!match || !docName) return false;
          event.preventDefault();
          window.dispatchEvent(new CustomEvent('silens-link-click', { detail: { docName } }));
          return true;
        },
      },
    })];
  },
});

function getLinkDecorations(doc: Node): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const match of node.text.matchAll(LINK_REGEX)) {
      const docName = match[1].trim();
      if (!docName) continue;
      const from = pos + match.index;
      decos.push(Decoration.inline(from, from + match[0].length, {
        nodeName: 'span',
        class: 'silens-link opacity-70 hover:opacity-100 transition-opacity duration-150 underline decoration-dotted underline-offset-2',
        'data-doc-name': docName,
        'aria-label': `打开笔记 ${docName}`,
        style: 'cursor: pointer;',
      }, { docName }));
    }
  });
  return DecorationSet.create(doc, decos);
}
