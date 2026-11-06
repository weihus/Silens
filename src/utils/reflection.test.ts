import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { PeriodReflectionResult, ReflectionQuery } from '../types';
import { getPeriodReflection } from './reflection';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

beforeEach(() => { vi.mocked(invoke).mockReset(); });

const emptyResult: PeriodReflectionResult = {
  query: { startDate: null, endDate: null, perspective: { kind: 'all' }, pageSeed: 0 },
  overview: {
    activeDaysCount: 0, dailyBlocksCount: 0, titledArticlesCount: 0,
    favoriteTimeBucket: null, richestDay: null,
  },
  themes: { topTags: [], untaggedBlocksCount: 0, totalDistinctWorksCount: 0, deepWorks: [] },
  articles: { longestBrewed: [], mostReferenced: [] },
  sampledQuotes: [],
};

it('calls the native command with a query envelope and preserves the response', async () => {
  vi.mocked(invoke).mockResolvedValue(emptyResult);
  const query: ReflectionQuery = {
    startDate: '2026-11-01', endDate: '2026-11-30',
    perspective: { kind: 'tag', tag: '读书' }, pageSeed: 1,
  };
  expect(await getPeriodReflection(query)).toBe(emptyResult);
  expect(invoke).toHaveBeenCalledExactlyOnceWith('get_period_reflection', { query });
});

it('lets Rust resolve missing bounds, perspective and seed defaults', async () => {
  vi.mocked(invoke).mockResolvedValue(emptyResult);
  expect(await getPeriodReflection({})).toEqual(emptyResult);
  expect(invoke).toHaveBeenCalledWith('get_period_reflection', { query: {} });
});

it.each(['all', 'untagged', 'articlesOnly'] as const)('preserves the %s discriminant and open bounds', async (kind) => {
  vi.mocked(invoke).mockResolvedValue(emptyResult);
  const query: ReflectionQuery = { startDate: null, endDate: '2026-11-30', perspective: { kind }, pageSeed: 0 };
  await getPeriodReflection(query);
  expect(invoke).toHaveBeenCalledWith('get_period_reflection', { query });
});

it('propagates native validation and workspace errors', async () => {
  vi.mocked(invoke).mockRejectedValue('startDate must not exceed endDate');
  await expect(getPeriodReflection({ startDate: '2026-12-01', endDate: '2026-11-01' }))
    .rejects.toBe('startDate must not exceed endDate');
});
