/**
 * OpenAI 兼容 Chat 客户端（DeepSeek / 通义等），基于 LangChain ChatOpenAI。
 */

import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

import { getAiChatConfig } from '../../config/ai.config';
import type { SimilarityHit } from './vector/vector-store';

export interface RagAnswerResult {
  answer: string;
  citations: Array<{
    docId: string;
    title: string;
    chunkIndex: number;
    excerpt: string;
  }>;
}

@Injectable()
export class ChatClient {
  private readonly logger = new Logger(ChatClient.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * 是否已配置生成模型。
   */
  isConfigured(): boolean {
    return getAiChatConfig(this.configService) !== null;
  }

  /**
   * 基于检索片段生成回答。
   * 输入：question、hits；输出：answer + citations
   */
  async answerWithContext(
    question: string,
    hits: SimilarityHit[],
  ): Promise<RagAnswerResult> {
    const cfg = getAiChatConfig(this.configService);
    if (!cfg) {
      throw new ServiceUnavailableException(
        '生成模型未配置（缺少 AI_CHAT_API_KEY）',
      );
    }

    const citations = hits.map((hit) => ({
      docId: hit.docId,
      title: hit.title || '无标题文档',
      chunkIndex: hit.chunkIndex,
      excerpt: hit.content.slice(0, 240),
    }));

    if (hits.length === 0) {
      return {
        answer: '当前笔记库中没有找到与问题相关的内容。',
        citations: [],
      };
    }

    const context = hits
      .map(
        (hit, index) =>
          `[#${index + 1}] 文档「${hit.title || '无标题文档'}」(docId=${hit.docId})\n${hit.content}`,
      )
      .join('\n\n');

    const system = `你是 InkWeaver 笔记助手。仅依据提供的笔记片段回答用户问题。
规则：
1. 使用简体中文。
2. 若依据不足，明确说明不知道，不要编造。
3. 在回答中用 [#序号] 标注依据来源。`;

    const human = `笔记片段：\n${context}\n\n用户问题：${question}`;

    try {
      const model = new ChatOpenAI({
        apiKey: cfg.apiKey,
        model: cfg.model,
        temperature: 0.2,
        configuration: {
          baseURL: cfg.baseUrl,
        },
      });

      const response = await model.invoke([
        new SystemMessage(system),
        new HumanMessage(human),
      ]);

      const answer =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);

      return { answer, citations };
    } catch (error) {
      this.logger.error('调用生成模型失败', error);
      throw new ServiceUnavailableException('生成模型调用失败');
    }
  }
}
