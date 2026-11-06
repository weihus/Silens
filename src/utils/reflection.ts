import { invoke } from '@tauri-apps/api/core';
import type { PeriodReflectionResult, ReflectionQuery } from '../types';

export function getPeriodReflection(query: ReflectionQuery): Promise<PeriodReflectionResult> {
  return invoke<PeriodReflectionResult>('get_period_reflection', { query });
}
