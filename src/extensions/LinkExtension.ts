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
        decorations: state => {
          const links = linkKey.getState(state);
          if (!links || !state.selection.empty) return links;
          const pos = state.selection.from;
          const editing = links.find(pos, pos, spec => spec.syntax)
            .filter(range => range.from < pos && pos < range.to);
          return links.add(state.doc, editing.map(range => Decoration.inline(range.from, range.to, { class: 'silens-link-editing' })));
        },
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
    if (node.type.spec.code) return false;
    if (!node.isText || !node.text || node.marks.some(mark => mark.type.spec.code)) return;
    for (const match of node.text.matchAll(LINK_REGEX)) {
      const docName = match[1].split('|')[0].trim();
      if (!docName) continue;
      const from = pos + match.index;
      const end = from + match[0].length;
      const separator = match[1].indexOf('|');
      const alias = separator >= 0 ? match[1].slice(separator + 1).trim() : '';
      const labelStart = alias ? from + 3 + separator : from;
      const labelEnd = alias ? end - 2 : end;
      if (alias) {
        for (const [start, finish] of [[from, labelStart], [labelEnd, end]]) {
          decos.push(Decoration.inline(start, finish, { class: 'silens-link-syntax' }, { syntax: true }));
        }
      }
      decos.push(Decoration.inline(labelStart, labelEnd, {
        nodeName: 'span',
        class: 'silens-link opacity-70 hover:opacity-100 transition-opacity duration-150 underline decoration-dotted underline-offset-2',
        'data-doc-name': docName,
        'aria-label': `打开笔记 ${alias || docName}`,
        style: 'cursor: pointer;',
      }, { docName }));
    }
  });
  return DecorationSet.create(doc, decos);
}
