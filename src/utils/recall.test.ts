import { describe, expect, it } from 'vitest';
import type { Document } from '../types';
import { documentDate, withinRange, periodRange, shiftPeriod, periodLabel } from './recall';

describe('calendar recall periods', () => {
  it.each([
    ['2026-11-04', '2026-11-02', '2026-11-08'],
    ['2026-11-08', '2026-11-02', '2026-11-08'],
    ['2026-11-09', '2026-11-09', '2026-11-15'],
    ['2027-01-01', '2026-12-28', '2027-01-03'],
    ['2026-03-08', '2026-03-02', '2026-03-08'],
  ])('uses a full Monday-to-Sunday week for %s', (anchor, start, end) => {
    expect(periodRange({ unit: 'week', anchor })).toEqual({ start, end });
  });

  it('handles leap months, full years and month shifts from the last day', () => {
    expect(periodRange({ unit: 'month', anchor: '2024-02-29' })).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(periodRange({ unit: 'year', anchor: '2024-02-29' })).toEqual({ start: '2024-01-01', end: '2024-12-31' });
    expect(shiftPeriod({ unit: 'month', anchor: '2026-01-31' }, 1)).toEqual({ unit: 'month', anchor: '2026-02-01' });
    expect(shiftPeriod({ unit: 'month', anchor: '2026-01-31' }, -1)).toEqual({ unit: 'month', anchor: '2025-12-01' });
    expect(shiftPeriod({ unit: 'week', anchor: '2027-01-01' }, 1)).toEqual({ unit: 'week', anchor: '2027-01-04' });
    expect(shiftPeriod({ unit: 'year', anchor: '2024-02-29' }, 1)).toEqual({ unit: 'year', anchor: '2025-01-01' });
    expect(periodLabel({ unit: 'month', anchor: '2026-11-04' })).toBe('2026 年 11 月');
    expect(periodRange({ unit: 'year', anchor: '0099-06-01' })).toEqual({ start: '0099-01-01', end: '0099-12-31' });
  });
});

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
