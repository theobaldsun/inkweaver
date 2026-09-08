/**
 * AI 控制器：RAG 问答与健康探测。
 */

import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { AskDto } from './dto/ask.dto';
import { EmbeddingClient } from './embedding.client';
import { RagService } from './rag.service';
import { getUserId } from '../../common/get-user-id';
import { getAiChatConfig, getAiEmbedConfig } from '../../config/ai.config';
import { AuthGuard } from '../auth/guard/auth.guard';

import type { Request as ExpressRequest } from 'express';

@Controller('/api/ai')
export class AiController {
  /** 依赖健康缓存，避免每次页面访问都穿透 FRP 调用本机 Embedding 服务。 */
  private healthCache: { expiresAt: number; value: AiHealthResponse } | null = null;

  constructor(
    private readonly ragService: RagService,
    private readonly embeddingClient: EmbeddingClient,
    private readonly configService: ConfigService,
  ) {}

  /**
   * AI 依赖健康检查（要求登录，并对外部 Embedding 探测限流、短缓存）。
   */
  @Get('/ping')
  @UseGuards(AuthGuard, ThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async ping(): Promise<AiHealthResponse> {
    if (this.healthCache && this.healthCache.expiresAt > Date.now()) {
      return this.healthCache.value;
    }
    const chatConfigured = getAiChatConfig(this.configService) !== null;
    const embedConfigured = getAiEmbedConfig(this.configService) !== null;
    const embedHealthy = embedConfigured
      ? await this.embeddingClient.isHealthy()
      : false;

    const value = {
      ok: chatConfigured && embedConfigured && embedHealthy,
      serviceHealthy: true as const,
      chatConfigured,
      embedConfigured,
      embedHealthy,
    };
    this.healthCache = { value, expiresAt: Date.now() + 30_000 };
    return value;
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

interface AiHealthResponse {
  /** Nest API 进程已响应；不代表外部依赖可用。 */
  serviceHealthy: true;
  /** AI Chat 与 Embedding 依赖是否全部就绪。 */
  ok: boolean;
  chatConfigured: boolean;
  embedConfigured: boolean;
  embedHealthy: boolean;
}
