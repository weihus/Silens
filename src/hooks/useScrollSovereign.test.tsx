import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useScrollSovereign } from './useScrollSovereign';
import { useGhostHighlight, useTypewriterScroll } from './useTypewriterScroll';

const animations = vi.hoisted(() => [] as { onUpdate: (value: number) => void; onComplete: () => void; stop: ReturnType<typeof vi.fn> }[]);
vi.mock('framer-motion', () => ({ animate: vi.fn((_from, _to, options) => {
  const animation = { ...options, stop: vi.fn() };
  animations.push(animation);
  return animation;
}) }));

let editor: Editor;
let container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  animations.length = 0;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  container = document.createElement('div');
  container.id = 'silens-scroll-container';
  document.body.appendChild(container);
  editor = new Editor({ extensions: [StarterKit], content: '<p>first paragraph with enough words to be far from the end</p><p>target</p>' });
  container.appendChild(editor.view.dom);
  vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ top: 1200, bottom: 1220, left: 0, right: 0 });
});
afterEach(() => {
  cleanup();
  editor.destroy();
  container.remove();
  vi.useRealTimers();
});

it('writes animation frames, ignores its own scroll events and lets wheel interrupt', () => {
  const change = vi.fn();
  const { result } = renderHook(() => useScrollSovereign(editor, change));
  act(() => { result.current.onKeystroke(); vi.advanceTimersByTime(20); });
  expect(animations).toHaveLength(1);
  act(() => animations[0].onUpdate(150));
  expect(container.scrollTop).toBe(150);
  fireEvent.scroll(container);
  expect(result.current.allowNativeScroll()).toBe(false);
  fireEvent.wheel(container, { deltaY: 20 });
  expect(animations[0].stop).toHaveBeenCalled();
  expect(change).toHaveBeenLastCalledWith('navigating');
});

it('protects direct writes and respects reduced motion', () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
  const { result } = renderHook(() => useScrollSovereign(editor));
  act(() => { result.current.onKeystroke(); vi.advanceTimersByTime(20); });
  expect(container.scrollTop).toBeGreaterThan(0);
  expect(animations).toHaveLength(0);
  fireEvent.scroll(container);
  expect(result.current.allowNativeScroll()).toBe(false);
  act(() => result.current.jumpToPosition(2));
  expect(result.current.allowNativeScroll()).toBe(true);
  expect(animations).toHaveLength(0);
});

it('stays navigating after a jump until typing, reading selection.from at the document end', () => {
  const change = vi.fn();
  const { result } = renderHook(() => useScrollSovereign(editor, change));
  act(() => result.current.jumpToPosition(2));
  act(() => { animations[0].onUpdate(200); animations[0].onComplete(); vi.advanceTimersByTime(1000); });
  fireEvent.scroll(container);
  expect(change).toHaveBeenLastCalledWith('navigating');
  act(() => editor.commands.setTextSelection(editor.state.doc.content.size - 1));
  expect(change).toHaveBeenLastCalledWith('navigating');
  act(() => result.current.onKeystroke());
  expect(change).toHaveBeenLastCalledWith('writing');
});

it('does not treat IME Enter as writing or interrupt the candidate session', () => {
  const change = vi.fn();
  const { result } = renderHook(() => useScrollSovereign(editor, change));
  act(() => result.current.suspendForNavigation());
  fireEvent.keyDown(editor.view.dom, { key: 'Enter', isComposing: true });
  expect(change).toHaveBeenLastCalledWith('navigating');
  fireEvent.keyDown(editor.view.dom, { key: 'Enter', keyCode: 229 });
  expect(change).toHaveBeenLastCalledWith('navigating');
  fireEvent.compositionStart(editor.view.dom);
  fireEvent.keyDown(editor.view.dom, { key: 'Enter' });
  act(() => result.current.onKeystroke());
  expect(change).toHaveBeenLastCalledWith('edge_case');
  expect(animations).toHaveLength(0);
});

it('does not classify programmatic content or selection changes as typing', () => {
  const { result } = renderHook(() => useTypewriterScroll(editor));
  fireEvent.wheel(container);
  act(() => { editor.commands.setContent('<p>replacement</p>'); editor.commands.setTextSelection(3); });
  expect(result.current.suspendTypewriterRef.current).toBe(true);
  act(() => fireEvent.input(editor.view.dom, { inputType: 'insertText', data: 'a' }));
  expect(result.current.suspendTypewriterRef.current).toBe(false);
});

it('skips earlier code examples when navigating to a backlink occurrence', () => {
  editor.commands.setContent('<pre><code>[[note]]</code></pre><p>Escaped [[note]]</p><p>Real [[note]] here</p>');
  const consumed = vi.fn();
  renderHook(() => useGhostHighlight(editor, { text: '[[note]]', occurrence: 2 }, consumed));
  act(() => vi.advanceTimersByTime(50));
  expect(editor.state.selection.$from.parent.textContent).toBe('Real [[note]] here');
  expect(editor.state.selection.$from.parentOffset).toBe(5);
  expect(consumed).toHaveBeenCalledOnce();
});

it('moves selection to the search target without native scrolling and keeps its highlight after consumption', () => {
  const consumed = vi.fn();
  const jump = vi.fn();
  const focus = vi.spyOn(editor.view.dom, 'focus');
  const { rerender } = renderHook(({ text }) => useGhostHighlight(editor, text, consumed, jump), {
    initialProps: { text: 'target' as string | null },
  });
  act(() => vi.advanceTimersByTime(50));
  expect(editor.state.selection.$from.parent.textContent).toBe('target');
  expect(editor.state.selection.$from.parentOffset).toBe(0);
  expect(jump).toHaveBeenCalledWith(editor.state.selection.from);
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(consumed).toHaveBeenCalledOnce();
  rerender({ text: null });
  const highlighted = editor.view.dom.querySelector('.ghost-highlight');
  expect(highlighted?.textContent).toBe('target');
  act(() => editor.commands.setTextSelection(2));
  expect(editor.view.dom.querySelector('.ghost-highlight')).toBe(highlighted);
  act(() => vi.advanceTimersByTime(1500));
  expect(editor.view.dom.querySelector('.ghost-highlight')).toBeNull();
});
