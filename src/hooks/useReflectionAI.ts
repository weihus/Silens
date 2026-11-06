import { useLayoutEffect, useRef, useState } from 'react';
import type { PeriodReflectionResult } from '../types';
import {
  cancelReflectionEpilogue, generateReflectionEpilogue, getAiEndpointConfig,
  prepareReflectionAIPayload, reflectionAIError,
  type AiEndpointConfig, type ReflectionEpilogue, type ReflectionPayloadPreview,
} from '../utils/reflectionAI';

export interface UseReflectionAIOptions {
  open: boolean;
  reflection: PeriodReflectionResult;
  contextKey: string;
  settingsRevision: number;
  disabled?: boolean;
  onResult: (result: ReflectionEpilogue | null) => void;
}
type Status = 'idle' | 'loading' | 'ready' | 'generating' | 'success' | 'error';
interface State {
  status: Status;
  config: AiEndpointConfig | null;
  preview: ReflectionPayloadPreview | null;
  error: string;
}
const empty: State = { status: 'idle', config: null, preview: null, error: '' };

export function useReflectionAI(options: UseReflectionAIOptions) {
  const { open, reflection, contextKey, settingsRevision } = options;
  const [state, setState] = useState<State>(empty);
  const current = useRef(options);
  const epoch = useRef(0);
  const active = useRef<string | null>(null);
  const ready = useRef<State>(empty);
  const callback = useRef(options.onResult);
  useLayoutEffect(() => { current.current = options; callback.current = options.onResult; });

  const abortNative = () => {
    const id = active.current;
    active.current = null;
    if (id) void cancelReflectionEpilogue(id).catch(() => { /* cancellation is best effort */ });
  };
  useLayoutEffect(() => {
    callback.current(null);
  }, [contextKey, settingsRevision]);

  useLayoutEffect(() => {
    const version = ++epoch.current;
    ready.current = empty;
    setState(open ? { ...empty, status: 'loading' } : empty);
    if (open) {
      // These commands only read local configuration and construct a local preview.
      void Promise.all([getAiEndpointConfig(), prepareReflectionAIPayload(reflection)])
        .then(([config, preview]) => {
          if (epoch.current !== version) return;
          const next: State = { status: 'ready', config, preview, error: '' };
          ready.current = next;
          setState(next);
        }).catch(error => {
          if (epoch.current !== version) return;
          setState({ ...empty, status: 'error', error: reflectionAIError(error) });
        });
    }
    return () => {
      ++epoch.current;
      ready.current = empty;
      abortNative();
    };
  }, [open, reflection, contextKey, settingsRevision]);

  const cancel = () => {
    ++epoch.current;
    ready.current = empty;
    abortNative();
    setState(empty);
  };
  const confirm = async () => {
    const snapshot = ready.current;
    const { config, preview } = snapshot;
    if (!current.current.open || current.current.disabled || active.current ||
        snapshot.status !== 'ready' || !config || !preview || config.mode === 'disabled' ||
        !config.model.trim() || !config.endpointUrl || (config.mode === 'cloud' && !config.hasApiKey)) return;
    const version = epoch.current;
    const requestId = crypto.randomUUID();
    // Acquire synchronously, before invoking native code or yielding to React.
    active.current = requestId;
    ready.current = { ...snapshot, status: 'generating' };
    setState(ready.current);
    try {
      const result = await generateReflectionEpilogue(preview.payload, config, requestId);
      if (epoch.current !== version || active.current !== requestId) return;
      ready.current = { ...snapshot, status: 'success' };
      setState(ready.current);
      callback.current(result);
    } catch (error) {
      if (epoch.current !== version || active.current !== requestId) return;
      ready.current = snapshot;
      setState({ ...snapshot, error: reflectionAIError(error) });
    } finally {
      if (epoch.current === version && active.current === requestId) active.current = null;
    }
  };
  const configured = !!state.config && state.config.mode !== 'disabled' &&
    !!state.config.model.trim() && !!state.config.endpointUrl &&
    (state.config.mode !== 'cloud' || state.config.hasApiKey);
  return { ...state, configured, confirm, cancel };
}
