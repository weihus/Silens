import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { Editor } from '@tiptap/core';
import type { PeriodReflectionResult, ReflectionQuery } from './types';
import type { AiEndpointConfig, ReflectionPayloadPreview } from './utils/reflectionAI';
import { LOCAL_AI_URL } from './utils/reflectionAI';
import App from './App';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock('./hooks/useAudio', () => ({ useAudio: vi.fn() }));
let config: AiEndpointConfig;
const payload = {
  period_label: '2026年11月', perspective_label: '全部文字',
  rhythm_summary: { active_days: 2, daily_blocks: 3, titled_articles: 0, untagged_blocks: 2, favorite_time: '深夜' },
  top_works: [], brewed_articles: [], sampled_snippets: ['一盏灯把夜色留在纸页之外。'],
};
const preview: ReflectionPayloadPreview = { payload, previewJson: JSON.stringify(payload, null, 2),
  charCount: [...JSON.stringify(payload, null, 2)].length, snippetCount: 1 };
const generated = { poeticTitle: '灯下缓缓翻过一页', epilogue: '夜色在窗边停下，纸页还留着白日的温度。'.repeat(9) };
function reflection(query: ReflectionQuery): PeriodReflectionResult {
  return { query: { startDate: query.startDate ?? null, endDate: query.endDate ?? null, perspective: query.perspective ?? { kind: 'all' }, pageSeed: query.pageSeed ?? 0 },
    overview: { activeDaysCount: 2, dailyBlocksCount: 3, titledArticlesCount: 0, favoriteTimeBucket: null, richestDay: null },
    themes: { topTags: [], untaggedBlocksCount: 2, totalDistinctWorksCount: 0, deepWorks: [] },
    articles: { longestBrewed: [], mostReferenced: [] },
    sampledQuotes: [{ blockId: 1, filename: 'private.md', date: '2026-11-01', content: '一盏灯把夜色留在纸页之外。', contextAnchor: null, slot: 'nightMonologue', tags: [] }] };
}
beforeEach(() => {
  localStorage.clear();
  config = { mode: 'local', baseUrl: LOCAL_AI_URL, endpointUrl: LOCAL_AI_URL, model: 'test-model', revision: 1, hasApiKey: false };
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation((async (command: string, args?: unknown) => {
    if (command === 'load_document') return '当前正在写的底稿。';
    if (command === 'save_document') return (args as { currentFilename: string }).currentFilename;
    if (command === 'get_period_reflection') return reflection((args as { query: ReflectionQuery }).query);
    if (command === 'get_ai_endpoint_config') return config;
    if (command === 'prepare_reflection_ai_payload') return preview;
    if (command === 'generate_reflection_epilogue') return generated;
    return [];
  }) as typeof invoke);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function ready() {
  render(<App />);
  await waitFor(() => expect(screen.queryByText('加载中')).not.toBeInTheDocument());
  return screen.getByRole('textbox', { name: '笔记正文' }) as HTMLElement & { editor: Editor };
}
async function openScroll() {
  fireEvent.click(screen.getByRole('button', { name: '搜索笔记' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: '搜索笔记' })).getByRole('button', { name: '时光拾遗（周期回顾）' }));
  const trigger = await screen.findByRole('button', { name: '请 AI 为这段时光撰写按语' });
  await waitFor(() => expect(trigger).toBeEnabled());
  return trigger;
}
const generationCalls = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === 'generate_reflection_epilogue');

it('does not generate on startup, save, scroll opening or preview, then submits exactly the approved payload once', async () => {
  const body = await ready();
  act(() => { body.editor.commands.insertContent('新的一句。'); });
  const content = body.editor.getJSON();
  const trigger = await openScroll();
  expect(generationCalls()).toHaveLength(0);
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === 'get_ai_endpoint_config')).toBe(false);
  const saves = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'save_document').length;
  fireEvent.click(trigger);
  const drawer = await screen.findByRole('dialog', { name: '为拾遗添一则 AI 按语' });
  await waitFor(() => expect(within(drawer).getByRole('textbox', { name: '完整发送内容' })).toHaveValue(preview.previewJson));
  expect(generationCalls()).toHaveLength(0);
  fireEvent.click(within(drawer).getByRole('button', { name: '确认授权并生成按语' }));
  await waitFor(() => expect(generationCalls()).toHaveLength(1));
  const input = generationCalls()[0][1] as { payload: unknown; config: unknown; requestId: string };
  expect(input.payload).toEqual(preview.payload);
  expect(input.config).toEqual(config);
  expect(input.requestId).toMatch(/^[a-z0-9-]+$/i);
  expect(JSON.stringify(input.payload)).not.toContain('private.md');
  await screen.findByText('按语已生成，已添入本次拾遗。');
  fireEvent.click(within(drawer).getByRole('button', { name: '取消AI按语授权' }));
  expect(await screen.findByRole('heading', { name: generated.poeticTitle })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'AI 时光按语' })).toHaveTextContent(generated.epilogue);
  expect(body.editor.getJSON()).toEqual(content);
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'save_document')).toHaveLength(saves);
}, 15000);

it('opens AI settings over the same scroll without resetting its seed or replacing the editor', async () => {
  config = { mode: 'disabled', baseUrl: '', endpointUrl: '', model: '', revision: 0, hasApiKey: false };
  const body = await ready();
  const trigger = await openScroll();
  fireEvent.click(screen.getByRole('button', { name: '换一束光' }));
  await waitFor(() => expect(vi.mocked(invoke).mock.calls.some(([command, args]) => command === 'get_period_reflection' && (args as {query:ReflectionQuery}).query.pageSeed === 1)).toBe(true));
  const letter = document.querySelector('[data-reflection-letter]');
  const content = body.editor.getJSON();
  const reads = vi.mocked(invoke).mock.calls.filter(([command]) => command === 'get_period_reflection').length;
  await waitFor(() => expect(trigger).toBeEnabled());
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('button', { name: '前往AI设置' }));
  const settings = await screen.findByRole('dialog', { name: '书写氛围' });
  await waitFor(() => expect(within(settings).getByText('AI 拾遗伴侣（可选）').closest('details')).toHaveAttribute('open'));
  expect(document.querySelector('[data-reflection-letter]')).toBe(letter);
  expect(document.querySelector('[aria-label="笔记正文"]')).toBe(body);
  expect(generationCalls()).toHaveLength(0);
  fireEvent.click(within(settings).getByRole('button', { name: '关闭书写氛围' }));
  expect(await screen.findByRole('dialog', { name: '时光拾遗' })).toBeInTheDocument();
  expect(document.querySelector('[data-reflection-letter]')).toBe(letter);
  expect(body.editor.getJSON()).toEqual(content);
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'get_period_reflection')).toHaveLength(reads);
}, 15000);

it('cancels pending AI work on focus mode and ignores a late response', async () => {
  let complete!: (value: typeof generated) => void;
  vi.mocked(invoke).mockImplementation((async (command: string, args?: unknown) => {
    if (command === 'load_document') return '原稿中的文字。';
    if (command === 'get_period_reflection') return reflection((args as {query:ReflectionQuery}).query);
    if (command === 'get_ai_endpoint_config') return config;
    if (command === 'prepare_reflection_ai_payload') return preview;
    if (command === 'generate_reflection_epilogue') return new Promise<typeof generated>(resolve => { complete = resolve; });
    return [];
  }) as typeof invoke);
  const body = await ready();
  const content = body.editor.getJSON();
  fireEvent.click(await openScroll());
  const confirm = await screen.findByRole('button', { name: '确认授权并生成按语' });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
  await waitFor(() => expect(complete).toBeTypeOf('function'));
  const request = (generationCalls()[0][1] as {requestId:string}).requestId;
  fireEvent.keyDown(document.body, { key: 'F', code: 'KeyF', metaKey: true, shiftKey: true });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('cancel_reflection_epilogue', {requestId:request}));
  await act(async () => { complete(generated); });
  expect(screen.queryByRole('dialog', { name: '为拾遗添一则 AI 按语' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: generated.poeticTitle })).not.toBeInTheDocument();
  expect(body.editor.getJSON()).toEqual(content);
}, 15000);
