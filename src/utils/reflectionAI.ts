import { invoke } from '@tauri-apps/api/core';
import type { PeriodReflectionResult } from '../types';

export type AiEndpointMode = 'disabled' | 'local' | 'cloud';
export interface AiEndpointConfig {
  mode: AiEndpointMode;
  baseUrl: string;
  endpointUrl: string;
  model: string;
  revision: number;
  hasApiKey: boolean;
}
export interface AiEndpointSettingsInput {
  mode: AiEndpointMode;
  baseUrl: string;
  model: string;
  apiKey?: string | null;
}
export interface SanitizedReflectionPayload {
  period_label: string;
  perspective_label: string;
  rhythm_summary: {
    active_days: number;
    daily_blocks: number;
    titled_articles: number;
    untagged_blocks: number;
    favorite_time: string | null;
  };
  top_works: { name: string; days_span: number; effective_chars: number }[];
  brewed_articles: { title: string; span_days: number }[];
  sampled_snippets: string[];
}
export interface ReflectionPayloadPreview {
  payload: SanitizedReflectionPayload;
  previewJson: string;
  charCount: number;
  snippetCount: number;
}
export interface ReflectionEpilogue { poeticTitle: string; epilogue: string }
export const LOCAL_AI_URL = 'http://127.0.0.1:11434/v1/chat/completions';

export const getAiEndpointConfig = () => invoke<AiEndpointConfig>('get_ai_endpoint_config');
export const saveAiEndpointConfig = (input: AiEndpointSettingsInput) =>
  invoke<AiEndpointConfig>('save_ai_endpoint_config', { input });
export const prepareReflectionAIPayload = (result: PeriodReflectionResult) =>
  invoke<ReflectionPayloadPreview>('prepare_reflection_ai_payload', { result });
// Rust owns canonical serialization: the object is the unmodified native preview payload.
export const generateReflectionEpilogue = (payload: SanitizedReflectionPayload, config: AiEndpointConfig, requestId: string) =>
  invoke<ReflectionEpilogue>('generate_reflection_epilogue', { payload, config, requestId });
export const cancelReflectionEpilogue = (requestId: string) =>
  invoke<void>('cancel_reflection_epilogue', { requestId });

export function reflectionAIError(error: unknown): string {
  const safeMessages = new Set([
    '等待按语超过 30 秒，请稍后重新授权。',
    '无法连接本机模型，请检查本地服务和模型名称。',
    '未能完成云端请求，请检查服务地址与网络后重新授权。',
    '服务拒绝授权，请检查密钥与模型权限。',
    '服务暂时繁忙，请稍后重新授权。',
    '接口返回重定向，未转发摘要；请直接配置最终接口地址。',
    'AI 设置已改变，请重新查看预览并授权。',
    '系统凭据库中没有此服务的有效密钥，请重新保存密钥。',
    '无法访问系统凭据库，请解锁凭据库后重试；密钥未写入普通配置。',
    '无法访问系统凭据库，请检查 Secret Service 与 secret-tool 是否可用；密钥未写入普通配置。',
    '按语格式不符合要求，请重试。',
    '摘要内容不符合要求，请重新生成预览。',
    '摘要中可能含有当前凭据，请更换摘录后重新预览。',
    '模型响应可能含有凭据，已停止展示，请检查服务设置。',
    '服务地址不能包含用户名、密码、查询参数或片段。',
    '请填写模型名称，不要填写文件路径。',
    '请仅在密钥栏填写 API Key，不要放入服务地址或模型名称。',
    '更换服务地址后，请重新输入该服务的密钥。',
    '请输入有效的 OpenAI 兼容服务地址；本机模式仅允许回环地址，云端模式使用 HTTPS。',
  ]);
  return typeof error === 'string' && safeMessages.has(error)
    ? error : '暂时无法完成，请检查 AI 设置后重试。';
}
