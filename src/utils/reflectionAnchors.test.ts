// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Paragraph from '@tiptap/extension-paragraph';
import { Markdown } from 'tiptap-markdown';
import { Hashtag } from '../extensions/Hashtag';
import { LinkExtension } from '../extensions/LinkExtension';

// Same paragraph storage and Markdown configuration as MarkdownEditor, without
// mounting its React view or fetching documents through Tauri.
const CustomParagraph = Paragraph.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: {
          write: (text: string) => void;
          closeBlock: (node: Node) => void;
          renderInline: (node: Node) => void;
        }, node: Node) {
          if (node.childCount === 0) {
            state.write(' ');
            state.closeBlock(node);
          } else {
            state.renderInline(node);
            state.closeBlock(node);
          }
        },
        parse: {
          setup(markdownit: { block: { ruler: { enable: (name: string) => void } } }) {
            markdownit.block.ruler.enable('paragraph');
          },
        },
      },
    };
  },
});

function textblocks(content: string): string[] {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ paragraph: false }),
      CustomParagraph,
      Hashtag,
      LinkExtension,
      Markdown.configure({ html: false, tightLists: true, tightListClass: 'tight' }),
    ],
    enableInputRules: ['bold', 'italic', 'bulletList', 'orderedList'],
    content,
  });
  try {
    const blocks: string[] = [];
    editor.state.doc.descendants(node => {
      if (!node.isTextblock) return;
      blocks.push(node.textBetween(0, node.content.size, '', '￼'));
      return false;
    });
    return blocks;
  } finally {
    editor.destroy();
  }
}

interface Anchor { text: string; occurrence: number }

// These are the outputs asserted by text_features.rs's Rust regression tests.
// Keeping literal fixtures here makes this a cross-parser contract, rather than
// comparing two copies of a JavaScript Markdown projection.
const fixtures: { name: string; raw: string; anchors: Anchor[]; targetBlocks: number[] }[] = [
  {
    name: 'code before bold, repeated prose, Wiki alias and escapes',
    raw: '```\n相同正文\n```\r\n\r\n**相同正文**\r\n\r\n相同正文\r\n\r\n#标签 [[目标|别名]] \\*文字\\*',
    anchors: [
      { text: '相同正文', occurrence: 1 },
      { text: '相同正文', occurrence: 2 },
      { text: '#标签 [[目标|别名]] *文字*', occurrence: 0 },
    ],
    targetBlocks: [1, 2, 3],
  },
  {
    name: 'soft and hard breaks',
    raw: '前行\n后行  \n末行',
    anchors: [{ text: '前行 后行￼末行', occurrence: 0 }],
    targetBlocks: [0],
  },
  {
    name: 'marks, entities and escaped punctuation',
    raw: '**粗体** 和 &amp; \\*星号\\*',
    anchors: [{ text: '粗体 和 & *星号*', occurrence: 0 }],
    targetBlocks: [0],
  },
  {
    name: 'nonoverlapping matches stay inside textblocks',
    raw: '`哈哈哈`\n\n**哈哈**\n\n哈\n\n哈\n\n哈哈',
    anchors: [{ text: '哈哈', occurrence: 1 }, { text: '哈哈', occurrence: 2 }],
    targetBlocks: [1, 4],
  },
  {
    name: 'HTML-looking code still contributes to occurrence',
    raw: '`<div>粗体</div>`\n\n**粗体**',
    anchors: [{ text: '粗体', occurrence: 1 }],
    targetBlocks: [1],
  },
];

function matchingBlocks(blocks: string[], anchor: Anchor): number[] {
  const matches: number[] = [];
  blocks.forEach((text, block) => {
    let cursor = 0;
    while (cursor < text.length) {
      const at = text.indexOf(anchor.text, cursor);
      if (at < 0) break;
      matches.push(block);
      cursor = at + anchor.text.length;
    }
  });
  return matches;
}

describe('Rust reflection anchors against the actual TipTap Markdown configuration', () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const blocks = textblocks(fixture.raw);
      fixture.anchors.forEach((anchor, index) => {
        const target = fixture.targetBlocks[index];
        expect(blocks[target]).toContain(anchor.text);
        expect(matchingBlocks(blocks, anchor)[anchor.occurrence]).toBe(target);
      });
    });
  }

  for (const html of ['<div>**粗体**</div>', '前 <span>**粗体**</span> 后', '<!-- 注释 -->\n**粗体**']) {
    it(`requires Rust's null fallback for HTML: ${html}`, () => {
      // html_projections_never_produce_false_anchors asserts [None; 3] for
      // this exact source. Nulling the entire projection also protects the
      // final duplicate from an occurrence count based on invalid HTML blocks.
      const blocks = textblocks(`粗体\n\n${html}\n\n粗体`);
      expect(blocks).toHaveLength(3);
      expect(blocks[1]).toContain('粗体');
      expect(blocks[1]).not.toContain('**粗体**');
      expect(matchingBlocks(blocks, { text: '粗体', occurrence: 2 })).toEqual([0, 1, 2]);
      if (html.startsWith('<div>')) expect(blocks[1]).toBe('<div>粗体</div>');
      if (html.startsWith('前 ')) expect(blocks[1]).toBe('前 <span>粗体</span> 后');
    });
  }
});
