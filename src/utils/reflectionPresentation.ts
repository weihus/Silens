import type { PeriodReflectionResult, RecallRange, ReflectionQuoteSlot, ResolvedReflectionQuery } from '../types';

export type ReflectionQuickRange = 'month' | 'quarter' | 'year' | 'all';

function dateKey(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return dateKey(date) === value ? date : null;
}

export function reflectionQuickRange(preset: ReflectionQuickRange, now = new Date()): RecallRange | null {
  if (preset === 'all') return null;
  const start = new Date(now);
  start.setHours(12, 0, 0, 0);
  const end = new Date(start);
  if (preset === 'month') start.setDate(start.getDate() - 29);
  else {
    start.setDate(1);
    start.setMonth(preset === 'year' ? 0 : Math.floor(start.getMonth() / 3) * 3);
    end.setTime(start.getTime());
    end.setMonth(end.getMonth() + (preset === 'year' ? 12 : 3));
    end.setDate(0);
  }
  return { start: dateKey(start), end: dateKey(end) };
}

export function formatReflectionDate(value: string): string {
  const date = parseDate(value);
  return date ? `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日` : value;
}

export function reflectionHeading(query: ResolvedReflectionQuery): { title: string; subtitle: string } {
  const { startDate, endDate, perspective } = query;
  const start = startDate ? parseDate(startDate) : null;
  let period = !startDate && !endDate ? '全部时光' : '这段时光';
  if (start && endDate) {
    const yearRange = reflectionQuickRange('year', start);
    const quarterRange = reflectionQuickRange('quarter', start);
    if (startDate === yearRange?.start && endDate === yearRange.end) period = `${start.getFullYear()} 年`;
    else if (startDate === quarterRange?.start && endDate === quarterRange.end) {
      period = `${start.getFullYear()} 年 · 第${['一', '二', '三', '四'][Math.floor(start.getMonth() / 3)]}季`;
    } else {
      const monthEnd = new Date(start);
      monthEnd.setMonth(monthEnd.getMonth() + 1, 0);
      if (start.getDate() === 1 && endDate === dateKey(monthEnd)) period = `${start.getFullYear()} 年 ${start.getMonth() + 1} 月`;
    }
  }
  const dates = startDate && endDate
    ? startDate === endDate ? formatReflectionDate(startDate) : `${formatReflectionDate(startDate)} — ${formatReflectionDate(endDate)}`
    : startDate ? `${formatReflectionDate(startDate)} 起` : endDate ? `截至 ${formatReflectionDate(endDate)}` : '你留下的所有时光';
  const label = perspective.kind === 'tag' ? `#${perspective.tag}`
    : perspective.kind === 'untagged' ? '未命名的瞬间' : perspective.kind === 'articlesOnly' ? '独立篇目' : '全部文字';
  return {
    title: `时光拾遗 · ${perspective.kind === 'tag' ? label : period}`,
    subtitle: `${dates} · ${label}`,
  };
}

export function reflectionHasContent(result: PeriodReflectionResult): boolean {
  const { overview, themes, articles, sampledQuotes } = result;
  return overview.activeDaysCount > 0 || overview.dailyBlocksCount > 0 || overview.titledArticlesCount > 0
    || (overview.favoriteTimeBucket?.sampleCount ?? 0) > 0 || overview.richestDay !== null
    || themes.topTags.some(tag => tag.count > 0) || themes.untaggedBlocksCount > 0
    || themes.totalDistinctWorksCount > 0 || themes.deepWorks.length > 0
    || articles.longestBrewed.length > 0 || articles.mostReferenced.length > 0 || sampledQuotes.length > 0;
}

export function reflectionSlotLabel(slot: ReflectionQuoteSlot): string {
  const labels: Record<ReflectionQuoteSlot, string> = {
    nightMonologue: '深夜独白', untaggedMoment: '未命名的瞬间', connectedThought: '思绪交汇',
    distantEcho: '远方回响', generalHighlight: '偶然拾得',
  };
  return labels[slot];
}
