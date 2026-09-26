// src/extensions/TagExtension.ts
import { Node, mergeAttributes, InputRule } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    silensTag: {
      insertTag: (label: string) => ReturnType;
    };
  }
}

export type TagNodeAttrs = {
  label: string;
};

export const TAG_INPUT_REGEX = /(^|[ \t])#([^\s#，。！？；：、,.!?;:()（）【】\[\]{}<>"']{1,40})[ \t]$/um;

export function transformHashtagsToTagSpans(element: HTMLElement) {
  const skipTags = new Set(['A', 'CODE', 'PRE', 'SCRIPT', 'STYLE']);
  const regex = /(^|[ \t\u00A0])#([^\s#，。！？；：、,.!?;:()（）【】\[\]{}<>"']{1,40})/gu;

  const walk = (domNode: globalThis.Node) => {
    if (domNode.nodeType === globalThis.Node.TEXT_NODE) {
      const text = domNode.textContent || '';
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        const prefix = match[1];
        const label = match[2];
        const matchStart = match.index;
        const matchEnd = matchStart + match[0].length;

        if (matchStart > lastIndex) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex, matchStart)));
        }
        if (prefix) {
          fragment.appendChild(document.createTextNode(prefix));
        }

        const span = document.createElement('span');
        span.setAttribute('data-tag', label);
        span.className = 'silens-tag opacity-40 font-medium hover:opacity-60 transition-opacity duration-150 ease-in-out cursor-pointer';
        span.textContent = `#${label}`;
        fragment.appendChild(span);

        lastIndex = matchEnd;
      }

      if (lastIndex === 0) return;
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
      domNode.parentNode?.replaceChild(fragment, domNode);
      return;
    }

    if (domNode.nodeType !== globalThis.Node.ELEMENT_NODE) return;
    const elementNode = domNode as HTMLElement;
    if (skipTags.has(elementNode.tagName)) return;

    const children = Array.from(elementNode.childNodes);
    children.forEach(walk);
  };

  walk(element);
}

const TagExtensionKey = new PluginKey('silens-tag-extension');

export const TagExtension = Node.create({
  name: 'silensTag',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-tag') ?? '',
        renderHTML: (attributes) => ({
          'data-tag': attributes.label,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-tag]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'silens-tag opacity-40 font-medium hover:opacity-60 transition-opacity duration-150 ease-in-out cursor-pointer',
      }),
      `#${HTMLAttributes['data-tag']}`,
    ];
  },

  renderText({ node }) {
    return `#${(node.attrs as TagNodeAttrs).label}`;
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const label = node.attrs?.label ?? '';
          state.text(`#${label}`);
        },
        parse: {
          updateDOM(element: HTMLElement) {
            transformHashtagsToTagSpans(element);
          },
        },
      },
    };
  },

  addCommands() {
    return {
      insertTag:
        (label: string) =>
        ({ chain }: any) => {
          const safe = label.trim();
          if (!safe) return false;
          return chain()
            .insertContent({ type: this.name, attrs: { label: safe } })
            .insertContent(' ')
            .run();
        },
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: TAG_INPUT_REGEX,
        handler: ({ range, match, commands }) => {
          const label = match[2];
          if (!label) return null;

          const prefixLength = match[1]?.length ?? 0;
          const start = range.from + prefixLength;
          const end = range.to;

          commands.command(({ tr, dispatch }) => {
            if (!dispatch) return false;
            const node = this.type.create({ label });
            tr.replaceRangeWith(start, end, node);
            const after = start + node.nodeSize;
            tr.insertText(' ', after);
            tr.setSelection(TextSelection.create(tr.doc, after + 1));
            dispatch(tr.scrollIntoView());
            return true;
          });

          return null;
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: TagExtensionKey,
        props: {
          handleClick: (view, _pos, evt) => {
            const target = evt.target as HTMLElement | null;
            if (!target) return false;
            const el = target.closest('span[data-tag]') as HTMLElement | null;
            if (!el) return false;

            const at = view.posAtDOM(el, 0);
            const $pos = view.state.doc.resolve(at);
            const node = $pos.nodeAfter;
            if (!node || node.type.name !== 'silensTag') return false;

            const label = node.attrs?.label ?? '';
            // 点击即透视：抛出全局穿梭事件，呼出侧边栏并进入该标签的透视视图
            const tagClickEvent = new CustomEvent('silens-tag-click', { detail: { tag: label } });
            window.dispatchEvent(tagClickEvent);
            return true;
          },
        },
      }),
    ];
  },
});