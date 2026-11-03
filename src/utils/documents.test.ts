import { describe, expect, it } from 'vitest';
import { documentKind, parseDocument, serializeDocument } from './documents';

describe('document boundaries', () => {
  it('keeps dated legacy files as journals regardless of headings', () => {
    for (const filename of ['2026-11-02.md', '2026-11-02_想法.md']) {
      expect(documentKind(filename)).toBe('journal');
      expect(parseDocument(filename, '# 一段记录\n\n正文').body).toBe('# 一段记录\n\n正文');
    }
    expect(documentKind('article-123.md')).toBe('article');
    expect(documentKind('研究方法.md')).toBe('article');
    expect(documentKind('2026-02-30.md')).toBe('article');
    expect(documentKind('2026-99-99_记录.md')).toBe('article');
  });

  it('extracts only a leading level-one title and preserves body headings', () => {
    expect(parseDocument('article-123.md', '# 一个问题 ###\r\n\r\n正文\r\n\r\n## 分析')).toEqual({
      kind: 'article', title: '一个问题', body: '正文\r\n\r\n## 分析',
    });
    expect(parseDocument('研究.md', '## 章节\n\n正文')).toEqual({ kind: 'article', title: '', body: '## 章节\n\n正文' });
  });

  it('round trips titled, untitled and title-only articles as ordinary Markdown', () => {
    for (const [title, body] of [['问题', '段落\n\n\n\n另一段'], ['关于 C# #', '正文'], ['###', '正文'], ['路径\\与#', '正文'], ['', '正文'], ['问题', ''], ['', '']]) {
      const markdown = serializeDocument('article', title, body);
      expect(parseDocument('article-123.md', markdown)).toEqual({ kind: 'article', title, body });
    }
    expect(serializeDocument('journal', '', '# 日常\n\n内容')).toBe('# 日常\n\n内容');
  });
});
