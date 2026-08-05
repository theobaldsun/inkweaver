/**
 * AI / RAG 相关环境配置。
 */

import { ConfigService } from '@nestjs/config';

/** bge-small-zh-v1.5 向量维度（换模型必须重建表） */
export const AI_EMBEDDING_DIMENSIONS = 512;

export interface AiChatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AiEmbedConfig {
  baseUrl: string;
  token: string;
  timeoutMs: number;
}

/**
 * 读取 Chat（OpenAI 兼容）配置。
 * 输入：ConfigService；输出：AiChatConfig | null（未配置时）
 */
export function getAiChatConfig(config?: ConfigService): AiChatConfig | null {
  const apiKey =
    config?.get<string>('AI_CHAT_API_KEY') ?? process.env.AI_CHAT_API_KEY ?? '';
  if (!apiKey.trim()) return null;

  return {
    baseUrl: (
      config?.get<string>('AI_CHAT_BASE_URL') ??
      process.env.AI_CHAT_BASE_URL ??
      ''
    ).replace(/\/$/, ''),
    apiKey: apiKey.trim(),
    model:
      config?.get<string>('AI_CHAT_MODEL') ??
      process.env.AI_CHAT_MODEL ??
      'deepseek-chat',
  };
}

/**
 * 读取嵌入服务配置（本机 FastAPI / 云端兼容 HTTP）。
 * 输入：ConfigService；输出：AiEmbedConfig | null
 */
export function getAiEmbedConfig(config?: ConfigService): AiEmbedConfig | null {
  const baseUrl = (
    config?.get<string>('AI_EMBED_BASE_URL') ??
    process.env.AI_EMBED_BASE_URL ??
    ''
  ).trim();
  if (!baseUrl) return null;

  const timeoutRaw =
    config?.get<string>('AI_EMBED_TIMEOUT_MS') ??
    process.env.AI_EMBED_TIMEOUT_MS ??
    '60000';

  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    token: (
      config?.get<string>('AI_EMBED_TOKEN') ??
      process.env.AI_EMBED_TOKEN ??
      ''
    ).trim(),
    timeoutMs: Number(timeoutRaw) || 60000,
  };
}
