/**
 * AI 业务服务：封装 RAG 问答 API。
 */

import { aiApi, type AiAskResponse, type AiPingResponse } from '@inkweaver/api';

export const aiService = {
  /**
   * 探测 AI 依赖。
   * 输入：无；输出：AiPingResponse
   */
  async ping(): Promise<AiPingResponse> {
    return aiApi.ping();
  },

  /**
   * 对当前用户笔记提问。
   * 输入：question、可选 docIds；输出：AiAskResponse
   */
  async ask(question: string, docIds?: string[]): Promise<AiAskResponse> {
    return aiApi.ask(question, docIds);
  },
};
