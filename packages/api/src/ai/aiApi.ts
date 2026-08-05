/**
 * AI / RAG API 客户端。
 */

import { apiClient } from '../client';

export interface AiCitation {
  docId: string;
  title: string;
  chunkIndex: number;
  excerpt: string;
}

export interface AiAskResponse {
  answer: string;
  citations: AiCitation[];
}

export interface AiPingResponse {
  ok: boolean;
  chatConfigured: boolean;
  embedConfigured: boolean;
  embedHealthy: boolean;
}

export const aiApi = {
  /**
   * 探测 AI 依赖是否就绪。
   * 输入：无；输出：AiPingResponse
   */
  async ping(): Promise<AiPingResponse> {
    return apiClient.get('/ai/ping');
  },

  /**
   * RAG 问答。
   * 输入：question、可选 docIds；输出：答案与引用
   */
  async ask(question: string, docIds?: string[]): Promise<AiAskResponse> {
    return apiClient.post('/ai/ask', { question, docIds });
  },
};
