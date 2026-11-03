import { describe, expect, it } from 'vitest';
import type { Document } from '../types';
import { documentDate, withinRange } from './recall';

describe('creation-based recall', () => {
  it('keeps an old article in its creation period after a recent edit', () => {
    const article = { filename: 'article-old.md', created_date: '2025-04-12', created: 1744416000, modified: 1793658000 } as Document;
    expect(documentDate(article)).toBe('2025-04-12');
    expect(withinRange(documentDate(article), { start: '2026-11-01', end: '2026-11-30' })).toBe(false);
    expect(withinRange(documentDate(article), { start: '2025-04-01', end: '2025-04-30' })).toBe(true);
  });

  it('keeps dated legacy journals on their original writing day', () => {
    const journal = { filename: '2020-03-14_补记.md', created_date: '2020-03-14', created: 1584115200, modified: 1793658000 } as Document;
    expect(documentDate(journal)).toBe('2020-03-14');
    expect(withinRange(documentDate(journal), { start: '2020-03-14', end: '2020-03-14' })).toBe(true);
    expect(withinRange(documentDate(journal), { end: '2020-03-13' })).toBe(false);
    expect(withinRange(documentDate(journal), null)).toBe(true);
  });
});
