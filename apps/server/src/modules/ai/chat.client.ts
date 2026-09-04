/**
 * OpenAI 兼容 Chat 客户端（DeepSeek / 通义等），基于 LangChain ChatOpenAI。
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { getAiChatConfig } from '../../config/ai.config';

import type { SimilarityHit } from './vector/vector-store';

export interface RagAnswerResult {
  answer: string;
  citations: RagCitation[];
}

export interface RagCitation {
  docId: string;
  title: string;
  chunkIndex: number;
  excerpt: string;
}

const CITATION_PATTERN = /\[#(\d+)\]/g;

/**
 * 只返回回答真正引用的来源，并把稀疏的原始编号压缩为连续编号。
 *
 * 例如模型只用了原候选 [#3]、[#1]，返回值会改写为 [#1]、[#2]，同时按该顺序
 * 返回两条 citations，保证回答编号与前端卡片一一对应。模型产生的越界编号会被移除。
 */
export function selectReferencedCitations(
  answer: string,
  citations: RagCitation[],
): RagAnswerResult {
  const remappedIndexes = new Map<number, number>();

  for (const match of answer.matchAll(CITATION_PATTERN)) {
    const sourceIndex = Number(match[1]);
    if (
      sourceIndex >= 1 &&
      sourceIndex <= citations.length &&
      !remappedIndexes.has(sourceIndex)
    ) {
      remappedIndexes.set(sourceIndex, remappedIndexes.size + 1);
    }
  }

  const remappedAnswer = answer.replace(
    CITATION_PATTERN,
    (_marker, rawIndex: string) => {
      const displayIndex = remappedIndexes.get(Number(rawIndex));
      return displayIndex ? `[#${displayIndex}]` : '';
    },
  );
  const referencedCitations = [...remappedIndexes.keys()].map(
    (sourceIndex) => citations[sourceIndex - 1]!,
  );

  return { answer: remappedAnswer, citations: referencedCitations };
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
3. 在回答中用 [#序号] 标注依据来源。
4. 只标注实际支持回答的片段，不得引用未使用或无关的来源。`;

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

      return selectReferencedCitations(answer, citations);
    } catch (error) {
      this.logger.error('调用生成模型失败', error);
      throw new ServiceUnavailableException('生成模型调用失败');
    }
  }
}
