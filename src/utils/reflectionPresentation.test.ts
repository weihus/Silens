import { describe, expect, it } from 'vitest';
import type { PeriodReflectionResult, ResolvedReflectionQuery } from '../types';
import { formatReflectionDate, reflectionHasContent, reflectionHeading, reflectionQuickRange, reflectionSlotLabel } from './reflectionPresentation';

const query: ResolvedReflectionQuery = { startDate: null, endDate: null, perspective: { kind: 'all' }, pageSeed: 0 };
const empty = (): PeriodReflectionResult => ({
  query,
  overview: { activeDaysCount: 0, dailyBlocksCount: 0, titledArticlesCount: 0, favoriteTimeBucket: null, richestDay: null },
  themes: { topTags: [], untaggedBlocksCount: 0, totalDistinctWorksCount: 0, deepWorks: [] },
  articles: { longestBrewed: [], mostReferenced: [] }, sampledQuotes: [],
});

describe('reflection local calendar ranges', () => {
  it.each([
    [new Date(2024, 2, 1, 0, 15), '2024-02-01', '2024-03-01'],
    [new Date(2026, 0, 1, 23, 55), '2025-12-03', '2026-01-01'],
    [new Date(2026, 2, 15, 0, 15), '2026-02-14', '2026-03-15'],
    [new Date(2026, 10, 5, 23, 55), '2026-10-07', '2026-11-05'],
  ])('includes today in thirty local days (%s)', (now, start, end) => {
    expect(reflectionQuickRange('month', now)).toEqual({ start, end });
  });
  it.each([
    [0, '2024-01-01', '2024-03-31'], [3, '2024-04-01', '2024-06-30'],
    [6, '2024-07-01', '2024-09-30'], [11, '2024-10-01', '2024-12-31'],
  ])('uses full natural quarter for month %s', (month, start, end) => {
    expect(reflectionQuickRange('quarter', new Date(2024, month, 15))).toEqual({ start, end });
  });
  it('returns full year, null for all, and leaves the input date intact', () => {
    const now = new Date(2024, 1, 29, 23, 59);
    const before = now.getTime();
    expect(reflectionQuickRange('year', now)).toEqual({ start: '2024-01-01', end: '2024-12-31' });
    expect(reflectionQuickRange('all', now)).toBeNull();
    expect(now.getTime()).toBe(before);
  });
});

describe('reflection headings and content', () => {
  it('names actual periods and keeps custom and open ranges accurate', () => {
    expect(reflectionHeading({ ...query, startDate: '2024-01-01', endDate: '2024-12-31' }).title).toContain('2024 年');
    expect(reflectionHeading({ ...query, startDate: '2024-04-01', endDate: '2024-06-30' }).title).toContain('第二季');
    expect(reflectionHeading({ ...query, startDate: '2024-04-12', endDate: '2024-06-30' }).title).toBe('时光拾遗 · 这段时光');
    expect(reflectionHeading({ ...query, startDate: '2024-04-12' }).subtitle).toContain('起');
    expect(reflectionHeading({ ...query, endDate: '2024-04-12' }).subtitle).toContain('截至');
    expect(reflectionHeading({ ...query, perspective: { kind: 'tag', tag: '读书' } }).title).toBe('时光拾遗 · #读书');
    expect(formatReflectionDate('2024-02-29')).toBe('2024 年 2 月 29 日');
    expect(formatReflectionDate('2024-02-30')).toBe('2024-02-30');
  });
  it('only calls the whole result empty when every selected data source is absent', () => {
    expect(reflectionHasContent(empty())).toBe(false);
    const modified = empty();
    modified.overview.richestDay = { date: '2026-11-05', tags: [], untaggedBlocksCount: 0, articles: [{ filename: 'old.md', title: '旧篇' }], preview: '', ...{ previewSource: null } };
    expect(reflectionHasContent(modified)).toBe(true);
    const article = empty();
    article.articles.longestBrewed = [{ filename: 'old.md', title: '旧篇', createdDate: '2020-01-01', modifiedDate: '2026-11-05', spanDays: 2500 }];
    expect(reflectionHasContent(article)).toBe(true);
    const works = empty();
    works.themes.totalDistinctWorksCount = 1;
    expect(reflectionHasContent(works)).toBe(true);
  });
  it('names all five quotation roles', () => {
    expect(['nightMonologue', 'untaggedMoment', 'connectedThought', 'distantEcho', 'generalHighlight'].map(slot => reflectionSlotLabel(slot as Parameters<typeof reflectionSlotLabel>[0])))
      .toEqual(['深夜独白', '未命名的瞬间', '思绪交汇', '远方回响', '偶然拾得']);
  });
});
