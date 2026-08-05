/**
 * AI 控制器：RAG 问答与健康探测。
 */

import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { getAiChatConfig, getAiEmbedConfig } from '../../config/ai.config';
import { getUserId } from '../../common/get-user-id';
import { AuthGuard } from '../auth/guard/auth.guard';
import { AskDto } from './dto/ask.dto';
import { EmbeddingClient } from './embedding.client';
import { RagService } from './rag.service';

import type { Request as ExpressRequest } from 'express';

@Controller('/api/ai')
export class AiController {
  constructor(
    private readonly ragService: RagService,
    private readonly embeddingClient: EmbeddingClient,
    private readonly configService: ConfigService,
  ) {}

  /**
   * AI 依赖健康检查（可匿名探测配置是否齐全；嵌入可达性需网络）。
   */
  @Get('/ping')
  async ping(): Promise<{
    ok: boolean;
    chatConfigured: boolean;
    embedConfigured: boolean;
    embedHealthy: boolean;
  }> {
    const chatConfigured = getAiChatConfig(this.configService) !== null;
    const embedConfigured = getAiEmbedConfig(this.configService) !== null;
    const embedHealthy = embedConfigured
      ? await this.embeddingClient.isHealthy()
      : false;

    return {
      ok: chatConfigured && embedConfigured && embedHealthy,
      chatConfigured,
      embedConfigured,
      embedHealthy,
    };
  }

  /**
   * 基于用户笔记的 RAG 问答。
   * 输入：AskDto；输出：answer + citations
   */
  @Post('/ask')
  @UseGuards(AuthGuard)
  async ask(
    @Body() dto: AskDto,
    @Request() req: ExpressRequest,
  ): Promise<{
    answer: string;
    citations: Array<{
      docId: string;
      title: string;
      chunkIndex: number;
      excerpt: string;
    }>;
  }> {
    const userId = getUserId(req.user as { sub?: string; id?: string });
    return this.ragService.ask(userId, dto.question.trim(), {
      docIds: dto.docIds,
    });
  }
}
