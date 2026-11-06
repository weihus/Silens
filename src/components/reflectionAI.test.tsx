// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PeriodReflectionResult } from '../types';
import { AISettingsSection } from './AISettingsSection';
import { ReflectionAIDrawer } from './ReflectionAIDrawer';
import { useReflectionAI, type UseReflectionAIOptions } from '../hooks/useReflectionAI';
import * as native from '../utils/reflectionAI';

vi.mock('../utils/reflectionAI', async importOriginal => ({
  ...await importOriginal<typeof import('../utils/reflectionAI')>(),
  getAiEndpointConfig: vi.fn(), saveAiEndpointConfig: vi.fn(), prepareReflectionAIPayload: vi.fn(),
  generateReflectionEpilogue: vi.fn(), cancelReflectionEpilogue: vi.fn(),
}));
const config: native.AiEndpointConfig = {
  mode: 'cloud', baseUrl: 'https://example.test/v1', endpointUrl: 'https://example.test/v1/chat/completions',
  model: 'my-model', revision: 1, hasApiKey: true,
};
const preview: native.ReflectionPayloadPreview = {
  payload: {
    period_label: '本周', perspective_label: '全部',
    rhythm_summary: { active_days: 2, daily_blocks: 3, titled_articles: 1, untagged_blocks: 0, favorite_time: null },
    top_works: [], brewed_articles: [], sampled_snippets: ['春🌱'],
  },
  previewJson: '{\n  "原生序列化": "春🌱"\n}', charCount: 2, snippetCount: 1,
};
const reflection = {} as PeriodReflectionResult; // Native preparation is mocked; the UI must forward this identity.
const result = { poeticTitle: '春来', epilogue: '字句慢慢生长。' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function options(patch: Partial<UseReflectionAIOptions> = {}): UseReflectionAIOptions {
  return { open: true, reflection, contextKey: 'week', settingsRevision: 1, onResult: vi.fn(), ...patch };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(native.getAiEndpointConfig).mockResolvedValue(config);
  vi.mocked(native.prepareReflectionAIPayload).mockResolvedValue(preview);
  vi.mocked(native.saveAiEndpointConfig).mockResolvedValue(config);
  vi.mocked(native.cancelReflectionEpilogue).mockResolvedValue(undefined);
  vi.mocked(native.generateReflectionEpilogue).mockResolvedValue(result);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('explicit reflection authorization', () => {
  it('does nothing while closed; opening prepares locally without generating', async () => {
    const initial = options({ open: false });
    const hook = renderHook(value => useReflectionAI(value), { initialProps: initial });
    expect(native.getAiEndpointConfig).not.toHaveBeenCalled();
    expect(native.prepareReflectionAIPayload).not.toHaveBeenCalled();
    hook.rerender({ ...initial, open: true });
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    expect(native.prepareReflectionAIPayload).toHaveBeenCalledWith(reflection);
    expect(native.generateReflectionEpilogue).not.toHaveBeenCalled();
  });
  it('forwards the exact native payload and synchronously locks double confirmation', async () => {
    const pending = deferred<native.ReflectionEpilogue>();
    vi.mocked(native.generateReflectionEpilogue).mockReturnValue(pending.promise);
    const props = options();
    const hook = renderHook(() => useReflectionAI(props));
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    act(() => { void hook.result.current.confirm(); void hook.result.current.confirm(); });
    expect(native.generateReflectionEpilogue).toHaveBeenCalledTimes(1);
    const [payload, endpoint, id] = vi.mocked(native.generateReflectionEpilogue).mock.calls[0];
    expect(payload).toBe(preview.payload); expect(endpoint).toBe(config);
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    await act(async () => { pending.resolve(result); });
    expect(props.onResult).toHaveBeenLastCalledWith(result);
    expect(hook.result.current.status).toBe('success');
  });
  it.each(['context', 'settings', 'close', 'cancel', 'unmount'] as const)('cancels and ignores stale results on %s', async change => {
    const pending = deferred<native.ReflectionEpilogue>();
    vi.mocked(native.generateReflectionEpilogue).mockReturnValue(pending.promise);
    const props = options();
    const hook = renderHook(value => useReflectionAI(value), { initialProps: props });
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    act(() => { void hook.result.current.confirm(); });
    const id = vi.mocked(native.generateReflectionEpilogue).mock.calls[0][2];
    if (change === 'unmount') hook.unmount();
    else if (change === 'cancel') act(() => hook.result.current.cancel());
    else hook.rerender({ ...props, contextKey: change === 'context' ? 'month' : props.contextKey,
      settingsRevision: change === 'settings' ? 2 : 1, open: change !== 'close' });
    expect(native.cancelReflectionEpilogue).toHaveBeenCalledWith(id);
    if (change === 'context' || change === 'settings') expect(props.onResult).toHaveBeenLastCalledWith(null);
    await act(async () => { pending.resolve(result); });
    expect(props.onResult).not.toHaveBeenCalledWith(result);
    expect(native.generateReflectionEpilogue).toHaveBeenCalledTimes(1);
  });
  it('an old finally cannot unlock or overwrite a new request', async () => {
    const old = deferred<native.ReflectionEpilogue>();
    const next = deferred<native.ReflectionEpilogue>();
    vi.mocked(native.generateReflectionEpilogue).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const props = options();
    const hook = renderHook(value => useReflectionAI(value), { initialProps: props });
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    act(() => { void hook.result.current.confirm(); });
    hook.rerender({ ...props, settingsRevision: 2 });
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    act(() => { void hook.result.current.confirm(); });
    await act(async () => { old.reject(new Error('private old failure')); });
    expect(hook.result.current.status).toBe('generating');
    act(() => { void hook.result.current.confirm(); });
    expect(native.generateReflectionEpilogue).toHaveBeenCalledTimes(2);
    await act(async () => { next.resolve(result); });
    expect(props.onResult).toHaveBeenLastCalledWith(result);
  });
  it('shows only sanitized config and generation errors', async () => {
    vi.mocked(native.getAiEndpointConfig).mockRejectedValueOnce('Bearer secret https://private.test');
    const first = renderHook(() => useReflectionAI(options()));
    await waitFor(() => expect(first.result.current.status).toBe('error'));
    expect(first.result.current.error).not.toMatch(/secret|private/);
    first.unmount();
    vi.mocked(native.generateReflectionEpilogue).mockRejectedValueOnce('api-key-secret private snippet');
    const props = options();
    const second = renderHook(() => useReflectionAI(props));
    await waitFor(() => expect(second.result.current.status).toBe('ready'));
    await act(async () => { await second.result.current.confirm(); });
    expect(second.result.current.error).not.toMatch(/secret|private/);
    expect(native.generateReflectionEpilogue).toHaveBeenCalledTimes(1);
  });
  it('displays and copies native JSON verbatim and stays open after success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const onClose = vi.fn();
    render(<ReflectionAIDrawer {...options()} onClose={onClose} onOpenSettings={vi.fn()} />);
    const text = await screen.findByLabelText('完整发送内容');
    expect((text as HTMLTextAreaElement).value).toBe(preview.previewJson);
    expect((text as HTMLTextAreaElement).readOnly).toBe(true);
    expect(text.closest('details')?.open).toBe(true);
    expect(screen.getByText('本次内容：2 个字符，1 则摘录。')).toBeTruthy();
    fireEvent.click(screen.getByText('复制完整内容'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(preview.previewJson));
    expect(native.generateReflectionEpilogue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('确认授权并生成按语'));
    await screen.findByText('按语已生成，已添入本次拾遗。');
    expect(onClose).not.toHaveBeenCalled(); expect(screen.getByRole('dialog')).toBeTruthy();
  });
  it('offers settings for disabled config without generating', async () => {
    vi.mocked(native.getAiEndpointConfig).mockResolvedValue({ ...config, mode: 'disabled', hasApiKey: false });
    const onOpenSettings = vi.fn();
    render(<ReflectionAIDrawer {...options()} onClose={vi.fn()} onOpenSettings={onOpenSettings} />);
    fireEvent.click(await screen.findByText('前往AI设置'));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(native.generateReflectionEpilogue).not.toHaveBeenCalled();
  });
});

describe('local-only settings and transient credentials', () => {
  it('loads only on expansion; explicit save never generates or prepares', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const storageRead = vi.spyOn(Storage.prototype, 'getItem');
    const onSaved = vi.fn();
    render(<AISettingsSection onSaved={onSaved} />);
    expect(native.getAiEndpointConfig).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('AI 拾遗伴侣（可选）'));
    await waitFor(() => expect((screen.getByLabelText('模型名称') as HTMLInputElement).value).toBe('my-model'));
    fireEvent.change(screen.getByLabelText('云端 API 密钥'), { target: { value: 'transient-secret' } });
    fireEvent.click(screen.getByText('保存 AI 设置'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(config));
    expect(native.saveAiEndpointConfig).toHaveBeenCalledWith({ mode: 'cloud', baseUrl: config.baseUrl, model: config.model, apiKey: 'transient-secret' });
    expect((screen.getByLabelText('云端 API 密钥') as HTMLInputElement).value).toBe('');
    expect(storage).not.toHaveBeenCalled();
    expect(storageRead).not.toHaveBeenCalled();
    expect(native.generateReflectionEpilogue).not.toHaveBeenCalled();
    expect(native.prepareReflectionAIPayload).not.toHaveBeenCalled();
  });
  it('clears secrets on endpoint/mode/collapse and requires a new endpoint key', async () => {
    render(<AISettingsSection openRequested={1} />);
    await waitFor(() => expect((screen.getByLabelText('模型名称') as HTMLInputElement).value).toBe('my-model'));
    expect(document.activeElement).toBe(screen.getByText('AI 拾遗伴侣（可选）'));
    const enter = () => fireEvent.change(screen.getByLabelText('云端 API 密钥'), { target: { value: 'draft-secret' } });
    enter();
    fireEvent.change(screen.getByLabelText('服务地址'), { target: { value: 'https://another.test/v1' } });
    expect((screen.getByLabelText('云端 API 密钥') as HTMLInputElement).value).toBe('');
    expect((screen.getByText('保存 AI 设置') as HTMLButtonElement).disabled).toBe(true);
    enter(); fireEvent.change(screen.getByLabelText('使用方式'), { target: { value: 'local' } });
    expect(screen.queryByLabelText('云端 API 密钥')).toBeNull();
    expect((screen.getByLabelText('服务地址') as HTMLInputElement).value).toBe(native.LOCAL_AI_URL);
    fireEvent.change(screen.getByLabelText('使用方式'), { target: { value: 'cloud' } });
    expect((screen.getByLabelText('服务地址') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('云端 API 密钥') as HTMLInputElement).value).toBe('');
    enter(); fireEvent.change(screen.getByLabelText('使用方式'), { target: { value: 'disabled' } });
    expect(screen.queryByLabelText('云端 API 密钥')).toBeNull();
    fireEvent.change(screen.getByLabelText('使用方式'), { target: { value: 'cloud' } });
    enter(); fireEvent.click(screen.getByText('AI 拾遗伴侣（可选）'));
    expect(screen.queryByLabelText('云端 API 密钥')).toBeNull();
    fireEvent.click(screen.getByText('AI 拾遗伴侣（可选）'));
    await waitFor(() => expect((screen.getByLabelText('模型名称') as HTMLInputElement).value).toBe('my-model'));
    expect((screen.getByLabelText('云端 API 密钥') as HTMLInputElement).value).toBe('');
  });
  it('sanitizes failed native saves and clears the submitted password', async () => {
    vi.mocked(native.saveAiEndpointConfig).mockRejectedValue(new Error('secret-password https://private.test'));
    render(<AISettingsSection openRequested={1} />);
    await waitFor(() => expect((screen.getByLabelText('模型名称') as HTMLInputElement).value).toBe('my-model'));
    fireEvent.change(screen.getByLabelText('云端 API 密钥'), { target: { value: 'secret-password' } });
    fireEvent.click(screen.getByText('保存 AI 设置'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/secret-password|private/);
    expect((screen.getByLabelText('云端 API 密钥') as HTMLInputElement).value).toBe('');
    expect(native.generateReflectionEpilogue).not.toHaveBeenCalled();
  });
});
