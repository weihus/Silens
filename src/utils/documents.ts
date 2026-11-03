import type { DocumentKind } from '../types';

export function documentKind(filename: string): DocumentKind {
  const date = filename.match(/^(\d{4}-\d{2}-\d{2})(?:_|\.md$)/)?.[1];
  if (!date) return 'article';
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? 'journal' : 'article';
}

export function parseDocument(filename: string, content: string) {
  const kind = documentKind(filename);
  const heading = kind === 'article' ? content.match(/^ {0,3}#(?:[\t ]+([^\r\n]*)|(?=\r?$))(?:\r?\n|$)/) : null;
  if (!heading) return { kind, title: '', body: content };
  const rawTitle = (heading[1] ?? '').replace(/[\t ]+#+[\t ]*$/, '').trim();
  const title = (/^#+$/.test(rawTitle) ? '' : rawTitle).replace(/\\([\\#])/g, '$1');
  const body = content.slice(heading[0].length).replace(/^\r?\n/, '');
  return { kind, title, body };
}

export function serializeDocument(kind: DocumentKind, title: string, body: string) {
  if (kind === 'journal') return body;
  const heading = title.trim().replace(/\\/g, '\\\\').replace(/#/g, '\\#');
  return `# ${heading}${body ? `\n\n${body}` : ''}`;
}

export function displayTitle(filename: string, title: string) {
  return title || (filename.startsWith('article-') ? '未命名笔记' : filename.replace(/\.md$/, ''));
}
