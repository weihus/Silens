import type { Document, RecallRange } from '../types';
import { documentKind } from './documents';

export function calendarDate(timestamp: number) {
  const date = new Date(timestamp * 1000);
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function documentDate(document: Pick<Document, 'filename' | 'created' | 'created_date'>) {
  if (documentKind(document.filename) === 'journal') return document.filename.slice(0, 10);
  return document.created_date || calendarDate(document.created);
}

export function withinRange(date: string, range?: RecallRange | null) {
  return (!range?.start || date >= range.start) && (!range?.end || date <= range.end);
}

export type RecallUnit = 'week' | 'month' | 'year';
export interface RecallPeriod {
  unit: RecallUnit;
  anchor: string;
}

function localDate(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return date;
}

function dateKey(date: Date) {
  return calendarDate(date.getTime() / 1000);
}

export function periodRange({ unit, anchor }: RecallPeriod): Required<RecallRange> {
  const start = localDate(anchor);
  if (unit === 'week') start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  else {
    start.setDate(1);
    if (unit === 'year') start.setMonth(0);
  }
  const end = new Date(start);
  if (unit === 'week') end.setDate(end.getDate() + 6);
  else {
    end.setMonth(end.getMonth() + (unit === 'year' ? 12 : 1));
    end.setDate(0);
  }
  return { start: dateKey(start), end: dateKey(end) };
}

export function shiftPeriod(period: RecallPeriod, direction: number): RecallPeriod {
  const date = localDate(periodRange(period).start);
  if (period.unit === 'week') date.setDate(date.getDate() + direction * 7);
  else if (period.unit === 'month') date.setMonth(date.getMonth() + direction);
  else date.setFullYear(date.getFullYear() + direction);
  return { unit: period.unit, anchor: dateKey(date) };
}

export function periodLabel(period: RecallPeriod) {
  const range = periodRange(period);
  const [year, month] = range.start.split('-').map(Number);
  if (period.unit === 'year') return `${year} 年`;
  if (period.unit === 'month') return `${year} 年 ${month} 月`;
  return `${range.start} — ${range.end}`;
}

export function exactTime(timestamp: number) {
  return `${calendarDate(timestamp)} ${new Date(timestamp * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}
