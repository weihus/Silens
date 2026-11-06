import { useLayoutEffect, useRef, useState } from 'react';
import type { PeriodReflectionResult, RecallRange, ReflectionPerspective, ReflectionQuery } from '../types';
import { getPeriodReflection } from '../utils/reflection';

export interface UsePeriodReflectionOptions {
  enabled: boolean;
  range: RecallRange | null;
  perspective: ReflectionPerspective;
  revision: number;
}

/** Cache lifetime is one enabled session; seed changes only replace the quotes. */
export function usePeriodReflection({ enabled, range, perspective, revision }: UsePeriodReflectionOptions) {
  const dateKey = JSON.stringify([range?.start ?? null, range?.end ?? null, revision]);
  const scope = JSON.stringify([dateKey, perspective.kind, perspective.kind === 'tag' ? perspective.tag : null]);
  const [seedState, setSeed] = useState({ scope, value: 0 });
  const pageSeed = seedState.scope === scope ? seedState.value : 0;
  if (seedState.scope !== scope) setSeed({ scope, value: 0 });
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([scope, pageSeed, attempt]);
  const [state, setState] = useState<{
    result: PeriodReflectionResult | null; scope: string; key: string;
    loading: boolean; error: string | null;
  }>({ result: null, scope: '', key: '', loading: false, error: null });
  const [allState, setAllState] = useState<{
    key: string; result: PeriodReflectionResult | null; loading: boolean; error: string | null;
  }>({ key: '', result: null, loading: false, error: null });
  const cache = useRef(new Map<string, Promise<PeriodReflectionResult>>());
  const generation = useRef(0);
  const cachedRevision = useRef(revision);

  useLayoutEffect(() => {
    const current = ++generation.current;
    if (cachedRevision.current !== revision) {
      cache.current.clear();
      cachedRevision.current = revision;
    }
    if (!enabled) {
      cache.current.clear();
      setState({ result: null, scope: '', key: '', loading: false, error: null });
      setAllState({ key: '', result: null, loading: false, error: null });
      setSeed({ scope, value: 0 });
      return;
    }
    const query: ReflectionQuery = {
      startDate: range?.start ?? null, endDate: range?.end ?? null,
      perspective, pageSeed,
    };
    const read = (q: ReflectionQuery) => {
      const cacheKey = JSON.stringify([dateKey, q.perspective, q.pageSeed]);
      const existing = cache.current.get(cacheKey);
      if (existing) return existing;
      const pending = getPeriodReflection(q);
      cache.current.set(cacheKey, pending);
      void pending.catch(() => {
        if (cache.current.get(cacheKey) === pending) cache.current.delete(cacheKey);
      });
      return pending;
    };
    setState(previous => ({ ...previous, key, loading: true, error: null }));
    const all = read({ ...query, perspective: { kind: 'all' }, pageSeed: 0 });
    const main = perspective.kind === 'all' && pageSeed === 0 ? all : read(query);
    setAllState(previous => previous.key === dateKey && previous.result
      ? previous : { key: dateKey, result: null, loading: true, error: null });
    void all.then(result => {
      if (generation.current === current) setAllState({ key: dateKey, result, loading: false, error: null });
    }, error => {
      if (generation.current === current) setAllState({
        key: dateKey, result: null, loading: false, error: error instanceof Error ? error.message : String(error),
      });
    });
    void main.then(result => {
      if (generation.current !== current) return;
      setState(previous => ({
        result: previous.result && previous.scope === scope && pageSeed !== previous.result.query.pageSeed
          ? { ...previous.result, query: result.query, sampledQuotes: result.sampledQuotes }
          : result,
        scope, key, loading: false, error: null,
      }));
    }, error => {
      if (generation.current === current) setState(previous => ({
        ...previous, key, loading: false, error: error instanceof Error ? error.message : String(error),
      }));
    });
    return () => { ++generation.current; };
    // Scalar keys intentionally represent the controlled range and perspective.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, dateKey]);

  return {
    result: enabled ? state.result : null,
    loading: enabled && (state.key !== key || state.loading),
    error: enabled && state.key === key ? state.error : null,
    topTags: enabled && allState.key === dateKey ? allState.result?.themes.topTags ?? [] : [],
    allResult: enabled && allState.key === dateKey ? allState.result : null,
    allLoading: enabled && (allState.key !== dateKey || allState.loading),
    allError: enabled && allState.key === dateKey ? allState.error : null,
    pageSeed,
    shuffle: () => setSeed({ scope, value: pageSeed + 1 }),
    retry: () => setAttempt(value => value + 1),
  };
}
