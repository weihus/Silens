import type { Document, RecallRange } from '../types';
import { documentKind } from './documents';

export function calendarDate(timestamp: number) {
  const date = new Date(timestamp * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function documentDate(document: Pick<Document, 'filename' | 'created' | 'created_date'>) {
  if (documentKind(document.filename) === 'journal') return document.filename.slice(0, 10);
  return document.created_date || calendarDate(document.created);
}

export function withinRange(date: string, range?: RecallRange | null) {
  return (!range?.start || date >= range.start) && (!range?.end || date <= range.end);
}

export function exactTime(timestamp: number) {
  return `${calendarDate(timestamp)} ${new Date(timestamp * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}
