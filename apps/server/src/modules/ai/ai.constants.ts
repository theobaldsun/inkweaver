/**
 * AI 索引队列常量。
 */

export const AI_INDEX_QUEUE = 'ai-document-index';

export interface AiIndexJobPayload {
  docId: string;
  userId: string;
  title: string;
  content: string;
}
