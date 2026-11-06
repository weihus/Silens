import { createPortal } from 'react-dom';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { PeriodReflectionResult } from '../types';
import type { ReflectionEpilogue } from '../utils/reflectionAI';
import { useReflectionAI } from '../hooks/useReflectionAI';
import { useDialogFocus } from '../hooks/useDialogFocus';
import './reflectionAI.css';

export interface ReflectionAIDrawerProps {
  open: boolean;
  reflection: PeriodReflectionResult;
  contextKey: string;
  settingsRevision: number;
  disabled?: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onResult: (result: ReflectionEpilogue | null) => void;
  sidebarInteractive?: boolean;
}
function destination(endpoint: string): string {
  try { return new URL(endpoint).host; } catch { return '地址尚未配置'; }
}
export function ReflectionAIDrawer(props: ReflectionAIDrawerProps) {
  const ai = useReflectionAI(props);
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const copyEpoch = useRef(0);
  useLayoutEffect(() => {
    ++copyEpoch.current; setCopyStatus('');
    return () => { ++copyEpoch.current; };
  }, [props.open, props.contextKey, props.settingsRevision]);
  const close = () => { ai.cancel(); props.onClose(); };
  const dialog = useDialogFocus(props.open, close, heading);
  const copy = async () => {
    if (!ai.preview) return;
    const version = copyEpoch.current;
    try {
      await navigator.clipboard.writeText(ai.preview.previewJson);
      if (copyEpoch.current === version) setCopyStatus('已复制完整内容。');
    } catch {
      if (copyEpoch.current === version) setCopyStatus('暂时无法复制，可在下方选取完整内容。');
    }
  };
  if (!props.open) return null;
  return createPortal(<div className="reflection-ai-backdrop" data-sidebar={props.sidebarInteractive ? 'true' : 'false'} data-export-exclude onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialog} className="reflection-ai-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} data-export-exclude>
      <h2 ref={heading} id={titleId} tabIndex={-1}>为拾遗添一则 AI 按语</h2>
      <p>请先看看本次将发送的内容，再决定是否授权。</p>
      {ai.status === 'loading' && <p role="status">正在本机整理预览…</p>}
      {ai.config && !ai.configured && <div>
        <p>尚未启用 AI 拾遗伴侣，请先选择模型并保存设置。</p>
        <button type="button" disabled={props.disabled} onClick={() => { ai.cancel(); props.onOpenSettings(); }}>前往AI设置</button>
      </div>}
      {ai.configured && ai.config && <p className="reflection-ai-destination">
        {ai.config.mode === 'local' ? '本地模型 · Silens 仅向本机发送摘要' : '云端 API'} · {destination(ai.config.endpointUrl)}<br />
        模型：{ai.config.model}
      </p>}
      {ai.preview && <>
        <p>本次仅使用当前长卷的精简统计与摘录，不会向模型发送完整笔记库和文件路径。</p>
        <p>本次内容：{ai.preview.charCount} 个字符，{ai.preview.snippetCount} 则摘录。</p>
        <p>摘录仍可能包含你写下的个人信息，请核对下方内容。</p>
        <details className="reflection-ai-preview" open>
          <summary>查看完整发送内容（JSON）</summary>
          <textarea aria-label="完整发送内容" readOnly value={ai.preview.previewJson} spellCheck={false} />
          <button type="button" disabled={props.disabled} onClick={() => { void copy(); }}>复制完整内容</button>
          {copyStatus && <p role="status">{copyStatus}</p>}
        </details>
      </>}
      {ai.error && <p role="alert">{ai.error}</p>}
      {ai.status === 'generating' && <p role="status">正在为这段书写整理按语…</p>}
      {ai.status === 'success' && <p role="status">按语已生成，已添入本次拾遗。</p>}
      <div className="reflection-ai-actions">
        <button type="button" onClick={close}>取消AI按语授权</button>
        <button type="button" disabled={props.disabled || !ai.configured || ai.status !== 'ready'}
          onClick={() => { void ai.confirm(); }}>确认授权并生成按语</button>
      </div>
    </div>
  </div>, document.body);
}
