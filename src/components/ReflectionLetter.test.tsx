import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PeriodReflectionResult, ReflectionExcerpt, ReflectionQuoteSlot } from '../types';
import { ReflectionLetter } from './ReflectionLetter';

afterEach(cleanup);
const excerpt: ReflectionExcerpt = { blockId: 7, filename: '2026-11-05_补记.md', date: '2026-11-05', content: '<img src=x onerror=alert(1)>\n[[远方]] **原样**', contextAnchor: { text: '完整原文锚点', occurrence: 2 } };
function fixture(): PeriodReflectionResult {
  return {
    query: { startDate: '2026-11-01', endDate: '2026-11-30', perspective: { kind: 'all' }, pageSeed: 0 },
    overview: { activeDaysCount: 0, dailyBlocksCount: 0, titledArticlesCount: 0, favoriteTimeBucket: null, richestDay: null },
    themes: { topTags: [], untaggedBlocksCount: 0, totalDistinctWorksCount: 0, deepWorks: [] },
    articles: { longestBrewed: [], mostReferenced: [] }, sampledQuotes: [],
  };
}
function mount(result = fixture(), disabled = false) {
  const onNavigate = vi.fn();
  const onPerspectiveChange = vi.fn();
  const onShuffle = vi.fn();
  const letterRef = createRef<HTMLDivElement>();
  return { ...render(<ReflectionLetter {...{ result, disabled, onNavigate, onPerspectiveChange, onShuffle, letterRef }} />), onNavigate, onPerspectiveChange, onShuffle, letterRef };
}

describe('ReflectionLetter', () => {
  it('shows one empty message and an exportable seal, without empty chapters or shuffle', () => {
    const { container, letterRef } = mount();
    expect(screen.getByText('这段时光留白如纸，尚无落笔痕迹')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(letterRef.current).toBe(container.querySelector('[data-reflection-letter]'));
    expect(letterRef.current?.querySelector('[data-reflection-ai-slot]')?.textContent).toBe('');
    expect(letterRef.current?.textContent).toContain('Silens');
  });

  it('keeps modified-only days and navigates to the actual article fallback', () => {
    const result = fixture();
    result.overview.richestDay = { date: '2026-11-05', tags: [], untaggedBlocksCount: 0, articles: [{ filename: 'article-old.md', title: '旧篇新写' }], preview: '', ...{ previewSource: null } };
    const { onNavigate, container } = mount(result);
    expect(screen.queryByText('这段时光留白如纸，尚无落笔痕迹')).toBeNull();
    expect(container.textContent).not.toMatch(/0 (个|篇|则|天|次)/);
    fireEvent.click(screen.getByRole('button', { name: '回到 2026-11-05' }));
    expect(onNavigate).toHaveBeenCalledWith('article-old.md', undefined);
  });

  it('prefers the richest-day source and keeps unsourced days as plain content', () => {
    const result = fixture();
    result.overview.richestDay = { date: '2026-11-05', tags: ['读书'], untaggedBlocksCount: 1, articles: [{ filename: 'old.md', title: '旧篇' }], preview: '丰盈的一天', ...{ previewSource: excerpt } };
    const { onNavigate } = mount(result);
    fireEvent.click(screen.getByRole('button', { name: '回到 2026-11-05' }));
    expect(onNavigate).toHaveBeenCalledWith(excerpt.filename, excerpt.contextAnchor);
    cleanup();
    result.overview.richestDay = { date: '2026-11-05', tags: [], untaggedBlocksCount: 0, articles: [], preview: '只读片段', ...{ previewSource: null } };
    mount(result);
    expect(screen.getByText('只读片段')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '回到 2026-11-05' })).toBeNull();
  });

  it('renders all quotation roles as escaped literal text and navigates with exact anchors', () => {
    const result = fixture();
    const slots: ReflectionQuoteSlot[] = ['nightMonologue', 'untaggedMoment', 'connectedThought', 'distantEcho', 'generalHighlight'];
    result.sampledQuotes = slots.map((slot, i) => ({ ...excerpt, blockId: i, slot, tags: ['读书'] }));
    const { container, onNavigate, onShuffle } = mount(result);
    for (const role of ['深夜独白', '未命名的瞬间', '思绪交汇', '远方回响', '偶然拾得']) {
      fireEvent.click(screen.getByRole('button', { name: `回到${role} · 2026-11-05` }));
    }
    expect(onNavigate).toHaveBeenCalledTimes(5);
    expect(onNavigate).toHaveBeenLastCalledWith(excerpt.filename, excerpt.contextAnchor);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('button button')).toBeNull();
    expect(container.textContent).toContain(excerpt.content);
    const shuffle = screen.getByRole('button', { name: '换一束光' });
    expect(shuffle.hasAttribute('data-export-exclude')).toBe(true);
    fireEvent.click(shuffle);
    expect(onShuffle).toHaveBeenCalledOnce();
  });

  it('uses positive attention prose only for all and offers the untagged perspective', () => {
    const result = fixture();
    result.overview.activeDaysCount = 3;
    result.themes.topTags = [{ tag: '阅读', count: 4 }, { tag: '隐藏', count: 0 }];
    result.themes.untaggedBlocksCount = 2;
    const { onPerspectiveChange, container } = mount(result);
    expect(container.textContent).toContain('在 3 个日子落笔');
    expect(container.textContent).not.toContain('#隐藏');
    expect(screen.queryByText('字里行间的回响')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '拾起未命名的瞬间' }));
    expect(onPerspectiveChange).toHaveBeenCalledWith({ kind: 'untagged' });
    cleanup();
    result.query.perspective = { kind: 'tag', tag: '阅读' };
    mount(result);
    expect(screen.queryByRole('button', { name: '拾起未命名的瞬间' })).toBeNull();
  });

  it('opens deep works, brewed articles and references with their own targets', () => {
    const result = fixture();
    result.themes.totalDistinctWorksCount = 5;
    result.themes.deepWorks = [{ workName: '远方', mentionCount: 3, distinctDaysCount: 2, effectiveChars: 12345, filenames: [excerpt.filename], representativeQuote: excerpt }];
    result.articles.longestBrewed = [{ filename: 'brew.md', title: '慢慢写', createdDate: '2025-01-01', modifiedDate: '2026-11-05', spanDays: 673 }];
    result.articles.mostReferenced = [{ filename: 'target.md', title: '被想起', referenceCount: 2, sourceCount: 1, sources: [{ filename: 'source-article.md', title: '另一篇文章', referenceCount: 2, preview: '回望原文', contextAnchor: excerpt.contextAnchor }] }];
    const { onNavigate, container } = mount(result);
    expect(container.textContent).toContain('5 部作品');
    expect(container.textContent).toContain('约 1.2 万字');
    expect(container.textContent).toContain('其他文字回望');
    fireEvent.click(screen.getByRole('button', { name: '回到作品 · 远方' }));
    expect(onNavigate).toHaveBeenLastCalledWith(excerpt.filename, excerpt.contextAnchor);
    fireEvent.click(screen.getByRole('button', { name: '打开篇目 · 慢慢写' }));
    expect(onNavigate).toHaveBeenLastCalledWith('brew.md', undefined);
    fireEvent.click(screen.getByRole('button', { name: '打开篇目 · 被想起' }));
    expect(onNavigate).toHaveBeenLastCalledWith('target.md', undefined);
    fireEvent.click(screen.getByRole('button', { name: '回到回望来源 · 另一篇文章' }));
    expect(onNavigate).toHaveBeenLastCalledWith('source-article.md', excerpt.contextAnchor);
  });

  it('hides the absent long-form subsection independently and gates every action when disabled', () => {
    const result = fixture();
    result.articles.longestBrewed = [{ filename: 'old.md', title: '旧篇', createdDate: '2025-01-01', modifiedDate: '2026-11-05', spanDays: 1 }];
    result.themes.untaggedBlocksCount = 1;
    result.sampledQuotes = [{ ...excerpt, slot: 'generalHighlight', tags: [] }];
    const { onNavigate, onPerspectiveChange, onShuffle } = mount(result, true);
    expect(screen.queryByText('被你再次想起')).toBeNull();
    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onPerspectiveChange).not.toHaveBeenCalled();
    expect(onShuffle).not.toHaveBeenCalled();
  });
});
