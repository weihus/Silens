import { useId, useLayoutEffect, useRef, useState } from 'react';
import {
  getAiEndpointConfig, saveAiEndpointConfig, LOCAL_AI_URL, reflectionAIError,
  type AiEndpointConfig, type AiEndpointMode,
} from '../utils/reflectionAI';
import './reflectionAI.css';

export interface AISettingsSectionProps {
  openRequested?: number;
  onSaved?: (config: AiEndpointConfig) => void;
  disabled?: boolean;
}
export function AISettingsSection({ openRequested, onSaved, disabled = false }: AISettingsSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [config, setConfig] = useState<AiEndpointConfig | null>(null);
  const [mode, setMode] = useState<AiEndpointMode>('disabled');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [keyInvalidated, setKeyInvalidated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const summary = useRef<HTMLElement>(null);
  const life = useRef(0);
  const saveLock = useRef(false);
  const savedCallback = useRef(onSaved);
  const id = useId();
  useLayoutEffect(() => { savedCallback.current = onSaved; });
  useLayoutEffect(() => {
    if (!openRequested) return;
    setExpanded(true);
    summary.current?.focus();
  }, [openRequested]);
  useLayoutEffect(() => { if (disabled) setKey(''); }, [disabled]);
  useLayoutEffect(() => {
    const version = ++life.current;
    setKey(''); setError(''); setStatus(''); setConfig(null);
    if (expanded) {
      setLoading(true);
      void getAiEndpointConfig().then(value => {
        if (life.current !== version) return;
        setConfig(value); setMode(value.mode); setModel(value.model);
        setBaseUrl(value.baseUrl || (value.mode === 'local' ? LOCAL_AI_URL : ''));
        setKeyInvalidated(false);
      }).catch(reason => {
        if (life.current === version) setError(reflectionAIError(reason));
      }).finally(() => {
        if (life.current === version) setLoading(false);
      });
    }
    return () => { ++life.current; };
  }, [expanded]);
  const close = () => { setKey(''); setExpanded(false); };
  const changeMode = (next: AiEndpointMode) => {
    setMode(next); setKey(''); setKeyInvalidated(true); setStatus('');
    setBaseUrl(next === 'local' ? LOCAL_AI_URL : '');
  };
  const storedKey = !!config?.hasApiKey && !keyInvalidated && mode === 'cloud' && baseUrl === config.baseUrl;
  const valid = mode === 'disabled' || (!!model.trim() && !!baseUrl.trim() &&
    (mode !== 'cloud' || !!key.trim() || storedKey));
  const save = async () => {
    if (disabled || loading || saveLock.current || !config || !valid) return;
    saveLock.current = true;
    setSaving(true); setError(''); setStatus('');
    const version = life.current;
    const input = {
      mode, baseUrl: baseUrl || (mode === 'local' ? LOCAL_AI_URL : ''), model,
      apiKey: mode !== 'cloud' ? null : key || (storedKey ? undefined : null),
    };
    setKey('');
    try {
      const value = await saveAiEndpointConfig(input);
      savedCallback.current?.(value);
      if (life.current !== version) return;
      setConfig(value); setMode(value.mode); setBaseUrl(value.baseUrl); setModel(value.model);
      setKeyInvalidated(false); setStatus('设置已保存。生成按语前仍会请你确认。');
    } catch (reason) {
      if (life.current === version) setError(reflectionAIError(reason));
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };
  return <details className="reflection-ai-settings" open={expanded} data-export-exclude>
    <summary ref={summary} onClick={event => {
      event.preventDefault();
      if (expanded) close(); else { setSaving(saveLock.current); setExpanded(true); }
    }}>AI 拾遗伴侣（可选）</summary>
    {expanded && <div className="reflection-ai-form">
      <p>为这段书写添一则按语。保存设置只写入本机，不会连接模型。</p>
      {loading && <p role="status">正在读取本机设置…</p>}
      <fieldset disabled={disabled || loading || saving || !config}>
        <label htmlFor={`${id}-mode`}>使用方式</label>
        <select id={`${id}-mode`} value={mode} onChange={event => changeMode(event.target.value as AiEndpointMode)}>
          <option value="disabled">暂不启用</option><option value="local">本机模型</option><option value="cloud">云端模型</option>
        </select>
        <label htmlFor={`${id}-model`}>模型名称</label>
        <input id={`${id}-model`} value={model} disabled={mode === 'disabled'} onChange={event => { setModel(event.target.value); setStatus(''); }} />
        <label htmlFor={`${id}-url`}>服务地址</label>
        <input id={`${id}-url`} type="url" value={baseUrl} disabled={mode === 'disabled'}
          autoComplete="off" spellCheck={false} onChange={event => {
            setBaseUrl(event.target.value); setKey(''); setKeyInvalidated(true); setStatus('');
          }} />
        {mode === 'local' && <p>Silens 仅连接本机回环接口，不向外网发送本次摘要；无需 API Key。</p>}
        {mode === 'cloud' && <>
          <label htmlFor={`${id}-key`}>云端 API 密钥</label>
          <input id={`${id}-key`} type="password" value={key} autoComplete="new-password" spellCheck={false}
            onChange={event => setKey(event.target.value)} />
          <p>{storedKey ? '已保存密钥；留空可继续使用。' : '请输入新密钥。更换服务地址后需要重新输入。'}</p>
          <p>密钥交由本机安全存储保管，关闭此设置会清空未保存的密钥。</p>
        </>}
        <button type="button" disabled={!valid} onClick={() => { void save(); }}>{saving ? '正在保存…' : '保存 AI 设置'}</button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
    </div>}
  </details>;
}
