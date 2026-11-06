import { StrictMode, type PropsWithChildren } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PeriodReflectionResult, ReflectionQuery } from '../types';
import { getPeriodReflection } from '../utils/reflection';
import { usePeriodReflection, type UsePeriodReflectionOptions } from './usePeriodReflection';

vi.mock('../utils/reflection', () => ({ getPeriodReflection: vi.fn() }));
const get = vi.mocked(getPeriodReflection);
function fixture(query: ReflectionQuery): PeriodReflectionResult {
  return {
    query: { startDate: query.startDate ?? null, endDate: query.endDate ?? null, perspective: query.perspective ?? { kind: 'all' }, pageSeed: query.pageSeed ?? 0 },
    overview: { activeDaysCount: 1, dailyBlocksCount: 1, titledArticlesCount: 0, favoriteTimeBucket: null, richestDay: null },
    themes: { topTags: [{ tag: query.perspective?.kind === 'all' ? '周期标签' : '筛选标签', count: 2 }], untaggedBlocksCount: 0, totalDistinctWorksCount: 0, deepWorks: [] },
    articles: { longestBrewed: [], mostReferenced: [] },
    sampledQuotes: [{ blockId: query.pageSeed ?? 0, filename: 'real.md', date: '2026-05-01', content: `quote ${query.pageSeed ?? 0}`, contextAnchor: null, slot: 'generalHighlight', tags: [] }],
  };
}
const base: UsePeriodReflectionOptions = { enabled: true, range: { start: '2026-05-01', end: '2026-05-31' }, perspective: { kind: 'all' }, revision: 1 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => { get.mockReset(); get.mockImplementation(async query => fixture(query)); });
afterEach(cleanup);

it('gates IPC, deduplicates All and pending StrictMode requests, and rereads after close', async () => {
  const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
  const { result, rerender } = renderHook(usePeriodReflection, { initialProps: { ...base, enabled: false }, wrapper });
  expect(get).not.toHaveBeenCalled();
  rerender(base);
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(get).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledWith({ startDate: '2026-05-01', endDate: '2026-05-31', perspective: { kind: 'all' }, pageSeed: 0 });
  rerender({ ...base, enabled: false });
  expect(result.current.result).toBeNull();
  rerender(base);
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
});

it('uses All tags for filtered views; seed updates only quotes and resets atomically on scope/revision changes', async () => {
  const { result, rerender } = renderHook(usePeriodReflection, { initialProps: base });
  await waitFor(() => expect(result.current.loading).toBe(false));
  const previous = result.current.result!;
  act(() => result.current.shuffle());
  await waitFor(() => expect(result.current.result?.query.pageSeed).toBe(1));
  expect(result.current.result?.overview).toBe(previous.overview);
  expect(result.current.result?.themes).toBe(previous.themes);
  expect(result.current.result?.articles).toBe(previous.articles);
  expect(result.current.result?.sampledQuotes[0].content).toBe('quote 1');
  expect(get).toHaveBeenCalledTimes(2);
  rerender({ ...base, perspective: { kind: 'tag', tag: '书' } });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ perspective: { kind: 'tag', tag: '书' }, pageSeed: 0 }));
  expect(result.current.topTags[0].tag).toBe('周期标签');
  expect(get).toHaveBeenCalledTimes(3);
  act(() => result.current.shuffle());
  await waitFor(() => expect(result.current.loading).toBe(false));
  rerender({ ...base, range: { end: '2026-06-30' }, revision: 2 });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(get).toHaveBeenLastCalledWith({ startDate: null, endDate: '2026-06-30', perspective: { kind: 'all' }, pageSeed: 0 });
});

it('keeps the old query with old content while loading and ignores stale success and failure including close', async () => {
  const { result, rerender } = renderHook(usePeriodReflection, { initialProps: base });
  await waitFor(() => expect(result.current.loading).toBe(false));
  const old = result.current.result;
  const pending = deferred<PeriodReflectionResult>();
  get.mockReturnValueOnce(pending.promise);
  rerender({ ...base, revision: 2 });
  expect(result.current.result).toBe(old);
  expect(result.current.loading).toBe(true);
  rerender({ ...base, revision: 3 });
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => pending.reject(new Error('obsolete')));
  expect(result.current.error).toBeNull();
  const late = deferred<PeriodReflectionResult>();
  get.mockReturnValueOnce(late.promise);
  rerender({ ...base, revision: 4 });
  rerender({ ...base, enabled: false });
  await act(async () => late.resolve(fixture({ pageSeed: 99 })));
  expect(result.current.result).toBeNull();
  expect(result.current.error).toBeNull();
});

it('deduplicates an initially enabled StrictMode mount and shares the pending All request across perspectives', async () => {
  const all = deferred<PeriodReflectionResult>();
  get.mockImplementation(query => query.perspective?.kind === 'all' ? all.promise : Promise.resolve(fixture(query)));
  const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
  const { result, rerender } = renderHook(usePeriodReflection, { initialProps: base, wrapper });
  expect(get).toHaveBeenCalledTimes(1);
  rerender({ ...base, perspective: { kind: 'untagged' } });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(get).toHaveBeenCalledTimes(2);
  expect(result.current.topTags).toEqual([]);
  await act(async () => all.resolve(fixture({ perspective: { kind: 'all' } })));
  expect(result.current.topTags).toEqual([{ tag: '周期标签', count: 2 }]);
  expect(result.current.result?.query.perspective).toEqual({ kind: 'untagged' });
});

it('invalidates old revision cache entries even if an earlier revision value is reused', async () => {
  const { result, rerender } = renderHook(usePeriodReflection, { initialProps: base });
  await waitFor(() => expect(result.current.loading).toBe(false));
  rerender({ ...base, revision: 2 });
  await waitFor(() => expect(result.current.loading).toBe(false));
  rerender(base);
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(get).toHaveBeenCalledTimes(3);
});

it('resets seed independently on date, perspective and revision changes without an intermediate nonzero query', async () => {
  const { result, rerender } = renderHook(usePeriodReflection, { initialProps: base });
  await waitFor(() => expect(result.current.loading).toBe(false));
  for (const next of [
    { ...base, range: { start: '2026-06-01' } },
    { ...base, perspective: { kind: 'articlesOnly' as const } },
    { ...base, perspective: { kind: 'articlesOnly' as const }, revision: 2 },
  ]) {
    act(() => result.current.shuffle());
    await waitFor(() => expect(result.current.result?.query.pageSeed).toBe(1));
    const count = get.mock.calls.length;
    rerender(next);
    expect(result.current.pageSeed).toBe(0);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(get.mock.calls.slice(count).every(([query]) => query.pageSeed === 0)).toBe(true);
    expect(result.current.result?.query.pageSeed).toBe(0);
  }
});

it('ignores a pending shuffle after scope changes, including its non-quote sections', async () => {
  const { result, rerender } = renderHook(usePeriodReflection, { initialProps: base });
  await waitFor(() => expect(result.current.loading).toBe(false));
  const pending = deferred<PeriodReflectionResult>();
  get.mockReturnValueOnce(pending.promise);
  act(() => result.current.shuffle());
  rerender({ ...base, perspective: { kind: 'tag', tag: '新的视角' } });
  await waitFor(() => expect(result.current.loading).toBe(false));
  const latest = result.current.result;
  await act(async () => pending.resolve(fixture({ pageSeed: 1 })));
  expect(result.current.result).toBe(latest);
  expect(result.current.result?.query.perspective).toEqual({ kind: 'tag', tag: '新的视角' });
  expect(result.current.error).toBeNull();
});

it('keeps filtered content usable when the separate All-tag request fails and retries that request later', async () => {
  get.mockRejectedValueOnce(new Error('tag lookup failed'));
  const { result } = renderHook(usePeriodReflection, { initialProps: { ...base, perspective: { kind: 'tag' as const, tag: '书' } } });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.result?.query.perspective).toEqual({ kind: 'tag', tag: '书' });
  expect(result.current.error).toBeNull();
  expect(result.current.topTags).toEqual([]);
  expect(result.current.allResult).toBeNull();
  expect(result.current.allError).toBe('tag lookup failed');
  act(() => result.current.shuffle());
  await waitFor(() => expect(result.current.result?.query.pageSeed).toBe(1));
  expect(result.current.topTags).toEqual([{ tag: '周期标签', count: 2 }]);
  expect(get.mock.calls.filter(([query]) => query.perspective?.kind === 'all')).toHaveLength(2);
});

it('discards late success after unmount', async () => {
  const pending = deferred<PeriodReflectionResult>();
  get.mockReturnValueOnce(pending.promise);
  const { result, unmount } = renderHook(usePeriodReflection, { initialProps: base });
  unmount();
  await act(async () => pending.resolve(fixture({ pageSeed: 99 })));
  expect(result.current.result).toBeNull();
});

it('retries a failed query without caching its rejection', async () => {
  get.mockRejectedValueOnce(new Error('offline'));
  const { result } = renderHook(usePeriodReflection, { initialProps: base });
  await waitFor(() => expect(result.current.error).toBe('offline'));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.result).not.toBeNull());
  expect(result.current.error).toBeNull();
});
