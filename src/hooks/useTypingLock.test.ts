import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTypingLock } from './useTypingLock';

afterEach(() => { cleanup(); vi.useRealTimers(); });

it('keeps the interface quiet across short pauses and resumes after a sustained pause', () => {
  vi.useFakeTimers();
  const { result } = renderHook(useTypingLock);
  act(() => result.current.handleTyping());
  act(() => vi.advanceTimersByTime(1500));
  expect(result.current.isIdle).toBe(false);
  act(() => result.current.handleTyping());
  act(() => vi.advanceTimersByTime(2199));
  expect(result.current.isIdle).toBe(false);
  act(() => vi.advanceTimersByTime(1));
  expect(result.current.isIdle).toBe(true);
});

it('cleans up the pending reveal when unmounted', () => {
  vi.useFakeTimers();
  const { result, unmount } = renderHook(useTypingLock);
  act(() => result.current.handleTyping());
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
