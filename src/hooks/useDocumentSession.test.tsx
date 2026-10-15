// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { invoke } from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyEncodedContent, encodeEmptyLines } from '../utils/emptyLines';
import { useDocumentSession } from './useDocumentSession';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../utils/emptyLines', async (importOriginal) => ({
  ...await importOriginal<typeof import('../utils/emptyLines')>(),
  applyEncodedContent: vi.fn(),
}));

const historical = '2024-01-02.md';
const destination = '2026-10-15.md';
const invokeMock = vi.mocked(invoke);
const applyMock = vi.mocked(applyEncodedContent);

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup() {
  // Content application is the only editor boundary used by this hook.
  const editor = {} as Editor;
  const onSaved = vi.fn();
  const hook = renderHook(() => useDocumentSession(editor, onSaved));
  return { ...hook, editor, onSaved };
}

async function advanceSaveTimer() {
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  // Unexpected I/O must fail rather than silently returning undefined.
  invokeMock.mockRejectedValue(new Error('Unexpected invoke'));
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('useDocumentSession', () => {
  it('preserves a conflicted draft before reloading the same document', async () => {
    invokeMock.mockResolvedValueOnce('original');
    const { result } = setup();
    await act(async () => { await result.current.open(historical); });
    act(() => result.current.change('my draft'));
    invokeMock.mockResolvedValueOnce(undefined).mockResolvedValueOnce('external edit');
    await act(async () => { expect(await result.current.open(historical, true, 'preserve')).toBe(true); });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'save_file_as', {
      filename: expect.stringMatching(/^2024-01-02_副本_\d+\.md$/), content: 'my draft',
    });
    expect(result.current.text).toBe('external edit');
    act(() => result.current.change('merged'));
    invokeMock.mockResolvedValueOnce(historical);
    await advanceSaveTimer();
    expect(invokeMock).toHaveBeenLastCalledWith('save_document', {
      content: 'merged', currentFilename: historical, expectedContent: 'external edit',
    });
  });

  it('refreshes an empty new note after moving to a workspace containing that note', async () => {
    invokeMock.mockRejectedValueOnce('DOCUMENT_NOT_FOUND');
    const { result } = setup();
    await act(async () => { await result.current.open(destination, true); });
    invokeMock.mockResolvedValueOnce('destination content');
    await act(async () => { await result.current.open(destination, true, 'reload'); });
    expect(result.current.text).toBe('destination content');
  });
  it('debounces edits and saves decoded text back to the historical filename', async () => {
    invokeMock.mockResolvedValueOnce('original').mockResolvedValueOnce(historical);
    const { result, editor, onSaved } = setup();
    await act(async () => { expect(await result.current.open(historical)).toBe(true); });
    expect(applyMock).toHaveBeenCalledWith(editor, 'original');
    onSaved.mockClear();

    act(() => result.current.change('first edit'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    const raw = 'new paragraph\n\n\nlast paragraph';
    act(() => result.current.change(encodeEmptyLines(raw)));
    await act(async () => { await vi.advanceTimersByTimeAsync(1499); });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('pending');
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });

    expect(invokeMock).toHaveBeenLastCalledWith('save_document', {
      content: raw, currentFilename: historical, expectedContent: 'original',
    });
    expect(result.current.filename).toBe(historical);
    expect(result.current.text).toBe(encodeEmptyLines(raw));
    expect(result.current.status).toBe('saved');
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(historical, raw);
  });

  it('persists deletion of all text from an existing document', async () => {
    invokeMock.mockResolvedValueOnce('delete me').mockResolvedValueOnce(historical);
    const { result, onSaved } = setup();
    await act(async () => { await result.current.open(historical); });
    onSaved.mockClear();
    act(() => result.current.change(''));
    await advanceSaveTimer();
    expect(invokeMock).toHaveBeenLastCalledWith('save_document', {
      content: '', currentFilename: historical, expectedContent: 'delete me',
    });
    expect(result.current.text).toBe('');
    expect(result.current.status).toBe('saved');
    expect(onSaved).toHaveBeenCalledExactlyOnceWith(historical, '');
  });

  it('finishes the pending save before loading or displaying the next page', async () => {
    const save = deferred<string>();
    invokeMock.mockResolvedValueOnce('old').mockReturnValueOnce(save.promise)
      .mockResolvedValueOnce('next page');
    const { result, editor } = setup();
    await act(async () => { await result.current.open(historical); });
    act(() => result.current.change('edited'));
    let navigation!: Promise<boolean>;
    await act(async () => { navigation = result.current.open(destination); });
    expect(invokeMock.mock.calls).toEqual([
      ['load_document', { filename: historical }],
      ['save_document', { content: 'edited', currentFilename: historical, expectedContent: 'old' }],
    ]);
    expect(result.current.filename).toBe(historical);
    expect(result.current.text).toBe('edited');
    expect(result.current.loading).toBe(true);
    expect(applyMock).toHaveBeenCalledTimes(1);

    await act(async () => { save.resolve(historical); expect(await navigation).toBe(true); });
    expect(invokeMock).toHaveBeenLastCalledWith('load_document', { filename: destination });
    expect(applyMock).toHaveBeenLastCalledWith(editor, 'next page');
    expect(result.current.filename).toBe(destination);
    expect(result.current.loading).toBe(false);
    await advanceSaveTimer();
    expect(invokeMock).toHaveBeenCalledTimes(3);
  });

  it('queues the newest contents behind an active save with the updated expected content', async () => {
    const firstSave = deferred<string>();
    invokeMock.mockResolvedValueOnce('disk version').mockReturnValueOnce(firstSave.promise)
      .mockResolvedValueOnce(historical);
    const { result, onSaved } = setup();
    await act(async () => { await result.current.open(historical); });
    onSaved.mockClear();
    act(() => result.current.change('first version'));
    await advanceSaveTimer();
    expect(result.current.status).toBe('saving');
    act(() => result.current.change('intermediate version'));
    await advanceSaveTimer();
    // The second flush is queued, but has not captured content yet.
    act(() => result.current.change('newest version'));
    expect(invokeMock).toHaveBeenCalledTimes(2);
    await act(async () => { firstSave.resolve(historical); await result.current.flush(); });
    expect(invokeMock.mock.calls.slice(1)).toEqual([
      ['save_document', { content: 'first version', currentFilename: historical, expectedContent: 'disk version' }],
      ['save_document', { content: 'newest version', currentFilename: historical, expectedContent: 'first version' }],
    ]);
    expect(onSaved.mock.calls).toEqual([[historical, 'first version'], [historical, 'newest version']]);
    expect(result.current.text).toBe('newest version');
    expect(result.current.status).toBe('saved');
    await advanceSaveTimer();
    expect(invokeMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['DOCUMENT_NOT_FOUND', false, null],
    ['permission denied', false, '无法读取笔记，请检查文件夹是否可用。'],
    ['permission denied', true, '无法读取笔记，请检查文件夹是否可用。'],
  ])('preserves the page on load failure %s (allowMissing=%s)', async (cause, allowMissing, message) => {
    invokeMock.mockResolvedValueOnce('current page').mockRejectedValueOnce(cause);
    const { result, onSaved } = setup();
    await act(async () => { await result.current.open(historical); });
    onSaved.mockClear();
    await act(async () => { expect(await result.current.open(destination, allowMissing)).toBe(false); });
    expect(result.current.filename).toBe(historical);
    expect(result.current.text).toBe('current page');
    expect(result.current.error).toBe(message);
    if (cause === 'DOCUMENT_NOT_FOUND') expect(result.current.notice?.message).toBe('这一天还没有笔记');
    expect(result.current.loading).toBe(false);
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    await advanceSaveTimer();
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('allows an explicitly missing page without saving an empty file, then creates it on edit', async () => {
    invokeMock.mockRejectedValueOnce('DOCUMENT_NOT_FOUND').mockResolvedValueOnce(destination);
    const { result, editor } = setup();
    await act(async () => { expect(await result.current.open(destination, true)).toBe(true); });
    expect(result.current.filename).toBe(destination);
    expect(result.current.error).toBeNull();
    expect(applyMock).toHaveBeenCalledWith(editor, '');
    act(() => result.current.change(''));
    await advanceSaveTimer();
    await act(async () => { await result.current.flush(); });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    act(() => result.current.change('new note'));
    await advanceSaveTimer();
    expect(invokeMock).toHaveBeenLastCalledWith('save_document', {
      content: 'new note', currentFilename: destination, expectedContent: null,
    });
  });

  it('preserves unsaved text and the current page and stops navigation on conflict', async () => {
    const save = deferred<string>();
    invokeMock.mockResolvedValueOnce('disk version').mockReturnValueOnce(save.promise);
    const { result, onSaved } = setup();
    await act(async () => { await result.current.open(historical); });
    onSaved.mockClear();
    act(() => result.current.change('precious local edits'));
    let navigation!: Promise<boolean>;
    await act(async () => { navigation = result.current.open(destination); });
    await act(async () => {
      save.reject('DOCUMENT_CONFLICT');
      expect(await navigation).toBe(false);
    });
    expect(result.current.filename).toBe(historical);
    expect(result.current.text).toBe('precious local edits');
    expect(result.current.status).toBe('error');
    expect(result.current.error).toContain('已在其他地方修改');
    expect(result.current.loading).toBe(false);
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    await advanceSaveTimer();
    expect(invokeMock.mock.calls).toEqual([
      ['load_document', { filename: historical }],
      ['save_document', { content: 'precious local edits', currentFilename: historical, expectedContent: 'disk version' }],
    ]);
  });

  it('does not save startup editor updates before or during the initial load', async () => {
    const load = deferred<string>();
    invokeMock.mockReturnValueOnce(load.promise);
    const { result, editor } = setup();
    act(() => result.current.change('initial editor placeholder'));
    await advanceSaveTimer();
    await act(async () => { await result.current.flush(); });
    expect(invokeMock).not.toHaveBeenCalled();
    let opening!: Promise<boolean>;
    await act(async () => { opening = result.current.open(historical); });
    act(() => result.current.change('update while loading'));
    await advanceSaveTimer();
    expect(invokeMock.mock.calls).toEqual([['load_document', { filename: historical }]]);
    expect(result.current.filename).toBeNull();
    // TipTap setContent can synchronously emit an editor update.
    applyMock.mockImplementationOnce(() => result.current.change('programmatic update'));
    await act(async () => { load.resolve('loaded from disk'); expect(await opening).toBe(true); });
    expect(applyMock).toHaveBeenCalledWith(editor, 'loaded from disk');
    expect(result.current.text).toBe('loaded from disk');
    expect(result.current.status).toBe('saved');
    await advanceSaveTimer();
    await act(async () => { await result.current.flush(); });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});
